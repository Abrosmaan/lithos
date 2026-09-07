// T1.2: нормализация на сохранённых ответах Macrostrat (без сети), кэш с TTL, retry, деградация.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WANDERER_MECHANISMS, type GeoContext } from '@lithos/shared';

// ---- мок БД: in-memory lithos.geo_cache с fetched_at ------------------------------
interface FakeRow { expected_rocks: unknown; wanderers: unknown; age_range: unknown; setting: unknown; fetched_at: number }
const cache = new Map<string, FakeRow>();
const DAY = 86_400_000;
const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  const cell = params[0] as string;
  if (/^\s*select/i.test(sql)) {
    const row = cache.get(cell);
    if (!row) return { rows: [] };
    if (/make_interval/.test(sql) && row.fetched_at <= Date.now() - (params[1] as number) * DAY) return { rows: [] };
    return { rows: [row] };
  }
  if (/^\s*insert/i.test(sql)) {
    const [, macrostrat_json, expected_rocks, wanderers, age_range, setting] = params as string[];
    JSON.parse(macrostrat_json!);
    cache.set(cell, {
      expected_rocks: JSON.parse(expected_rocks!), wanderers: JSON.parse(wanderers!), age_range, setting, fetched_at: Date.now(),
    });
    return { rows: [] };
  }
  if (/^\s*delete/i.test(sql)) { cache.delete(cell); return { rows: [] }; }
  throw new Error(`unexpected sql: ${sql}`);
});
vi.mock('./db.js', () => ({ pool: { query }, closeDb: async () => {} }));

// ---- фикстуры: центр + 4 пробы (units + elevation), сняты в центроидах geohash-6 ----
interface Fixture {
  lat: number; lng: number; probe_km: number; center: unknown;
  probes: Record<string, { lat: number; lng: number; response: unknown; elevation: unknown }>;
}
const NAMES = ['gonio', 'dorset', 'arizona', 'baikal', 'iceland'] as const;
const FIXTURES: Record<string, Fixture> = Object.fromEntries(
  NAMES.map((n) => [n, JSON.parse(readFileSync(new URL(`../test/fixtures/geo/${n}.json`, import.meta.url), 'utf8'))]),
);

/** fetch из фикстур по (endpoint, lat, lng) с допуском 0.01° (~1 км; пробы отстоят на 4 км). Незнакомая точка — ошибка. */
function fixtureFetch() {
  return vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    const isUnits = url.pathname.endsWith('/geologic_units/map');
    const isElev = url.pathname.endsWith('/mobile/map_query_v2');
    for (const f of Object.values(FIXTURES)) {
      if (isUnits && near(f.lat, lat) && near(f.lng, lng)) return json(f.center);
      for (const p of Object.values(f.probes)) {
        if (near(p.lat, lat) && near(p.lng, lng)) {
          if (isUnits) return json(p.response);
          if (isElev) return json(p.elevation);
        }
      }
    }
    throw new Error(`no fixture for ${url.pathname} ${lat},${lng}`);
  });
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const empty = () => json({ success: { data: [] } });

const { getGeoContext, cellIdFor, normalize, resetGeoMemory } = await import('./geo.js');
const { retryPolicy, probePoints } = await import('./geo/macrostrat.js');
retryPolicy.backoffBaseMs = 0;

beforeEach(() => { cache.clear(); query.mockClear(); resetGeoMemory(); });
afterEach(() => { vi.unstubAllGlobals(); });

const shareSum = (ctx: GeoContext) => ctx.expected_rocks.reduce((s, r) => s + r.share, 0);
const classes = (ctx: GeoContext) => ctx.expected_rocks.map((r) => r.rock_class);

describe('getGeoContext: нормализация Macrostrat на 5 контрольных точках', () => {
  beforeEach(() => vi.stubGlobal('fetch', fixtureFetch()));

  it('Гонио — известняк + андезит/туф, Eocene, побережье → drift_pumice', async () => {
    const ctx = await getGeoContext(41.57, 41.57);
    expect(ctx.source).toBe('macrostrat');
    expect(ctx.cell_id).toBe(cellIdFor(41.57, 41.57));
    expect(ctx.cell_id).toHaveLength(6);
    expect(ctx.expected_rocks).toEqual([
      { rock_class: 'limestone', share: 0.7 }, { rock_class: 'andesite', share: 0.15 }, { rock_class: 'tuff', share: 0.15 },
    ]);
    expect(ctx.age_range).toBe('Eocene');
    expect(ctx.setting).toBe('coast');
    expect(ctx.wanderers).toEqual(['drift_pumice']);
  });

  it('Дорсет — мел/глины/песчаник, Late Jurassic–Eocene, побережье + эрратики (>45°)', async () => {
    const ctx = await getGeoContext(50.62, -2.27);
    expect(classes(ctx)).toEqual(['chalk', 'claystone', 'sandstone', 'limestone', 'conglomerate']);
    expect(ctx.expected_rocks[0]!.share).toBeCloseTo(0.5, 2);
    expect(ctx.expected_rocks[1]!.share).toBeCloseTo(0.319, 2);
    expect(shareSum(ctx)).toBeCloseTo(1, 2);
    expect(ctx.age_range).toBe('Late Jurassic–Eocene');
    expect(ctx.setting).toBe('coast');
    expect(ctx.wanderers).toEqual(['drift_pumice', 'glacial_erratic']);
  });

  it('Аризона — осадочный палеозой, inland, странников нет; generic- и эвапоритовые литологии отброшены', async () => {
    const ctx = await getGeoContext(36.06, -112.14);
    expect(ctx.expected_rocks.slice(0, 3)).toEqual([
      { rock_class: 'sandstone', share: 0.341 }, { rock_class: 'limestone', share: 0.208 }, { rock_class: 'shale', share: 0.141 },
    ]);
    expect(classes(ctx)).not.toContain('unknown_sedimentary');
    expect(shareSum(ctx)).toBeCloseTo(1, 2);
    expect(ctx.age_range).toBe('Early Cambrian–Roadian');
    expect(ctx.setting).toBe('inland');
    expect(ctx.wanderers).toEqual([]);
  });

  it('Байкал — центр в озере (пустой юнит): породы с берега, setting=lake, без drift_pumice', async () => {
    const ctx = await getGeoContext(51.86, 104.86);
    expect(ctx.source).toBe('macrostrat');
    expect(ctx.expected_rocks).toEqual([{ rock_class: 'unknown_sedimentary', share: 1 }]);
    expect(ctx.setting).toBe('lake');
    expect(ctx.wanderers).toEqual(['glacial_erratic']);
  });

  it('Исландия — базальт 1.0, Quaternary, побережье (высота проб < 0)', async () => {
    const ctx = await getGeoContext(64.13, -21.9);
    expect(ctx.expected_rocks).toEqual([{ rock_class: 'basalt', share: 1 }]);
    expect(ctx.age_range).toBe('Quaternary');
    expect(ctx.setting).toBe('coast');
    expect(ctx.wanderers).toEqual(['drift_pumice', 'glacial_erratic']);
  });

  it('wanderers упорядочен как WANDERER_MECHANISMS и никогда не содержит human_imported по умолчанию', async () => {
    for (const f of Object.values(FIXTURES)) {
      const ctx = await getGeoContext(f.lat, f.lng);
      expect(ctx.wanderers).not.toContain('human_imported');
      const idx = ctx.wanderers.map((w) => WANDERER_MECHANISMS.indexOf(w));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });
});

describe('getGeoContext: кэш', () => {
  it('повторный вызов той же ячейки не ходит в API (source=cache)', async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal('fetch', fetchMock);
    const first = await getGeoContext(41.57, 41.57);
    expect(first.source).toBe('macrostrat');
    expect(fetchMock.mock.calls.length).toBe(1 + 4 * 2); // центр + 4 пробы × (units + elevation)
    expect(cache.has(first.cell_id)).toBe(true);

    const second = await getGeoContext(41.5701, 41.5701); // та же ячейка geohash-6
    expect(second.cell_id).toBe(first.cell_id);
    expect(second.source).toBe('cache');
    expect(fetchMock.mock.calls.length).toBe(9);
    expect(second).toEqual({ ...first, source: 'cache' });
  });

  it('строка старше 30 дней → повторный поход в API и обновление', async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal('fetch', fetchMock);
    const cell = cellIdFor(41.57, 41.57);
    cache.set(cell, { expected_rocks: [{ rock_class: 'granite', share: 1 }], wanderers: [], age_range: 'X', setting: 'inland', fetched_at: Date.now() - 31 * DAY });
    const ctx = await getGeoContext(41.57, 41.57);
    expect(ctx.source).toBe('macrostrat');
    expect(ctx.expected_rocks[0]!.rock_class).toBe('limestone');
    expect(cache.get(cell)!.fetched_at).toBeGreaterThan(Date.now() - 1000);
  });

  it('API недоступен, но есть просроченная строка → source=cache (предварительно), не none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const cell = cellIdFor(41.57, 41.57);
    cache.set(cell, { expected_rocks: [{ rock_class: 'granite', share: 1 }], wanderers: ['river_transport'], age_range: 'X', setting: 'river', fetched_at: Date.now() - 40 * DAY });
    const ctx = await getGeoContext(41.57, 41.57);
    expect(ctx.source).toBe('cache');
    expect(ctx.expected_rocks).toEqual([{ rock_class: 'granite', share: 1 }]);
    expect(ctx.setting).toBe('river');
  });

  it('значения вне актуальных enum в строке кэша отбрасываются', async () => {
    vi.stubGlobal('fetch', fixtureFetch());
    const cell = cellIdFor(41.57, 41.57);
    cache.set(cell, { expected_rocks: [{ rock_class: 'granite', share: 0.6 }, { rock_class: 'kryptonite', share: 0.4 }], wanderers: ['teleport', 'drift_pumice'], age_range: null, setting: 'coast', fetched_at: Date.now() });
    const ctx = await getGeoContext(41.57, 41.57);
    expect(ctx.expected_rocks).toEqual([{ rock_class: 'granite', share: 0.6 }]);
    expect(ctx.wanderers).toEqual(['drift_pumice']);
  });

  it('параллельные промахи одной ячейки дедуплицируются (один набор запросов)', async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal('fetch', fetchMock);
    const [a, b, c] = await Promise.all([getGeoContext(41.57, 41.57), getGeoContext(41.5702, 41.5702), getGeoContext(41.57, 41.57)]);
    expect(fetchMock.mock.calls.length).toBe(9);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('сбой БД при чтении кэша не ломает ответ', async () => {
    vi.stubGlobal('fetch', fixtureFetch());
    query.mockRejectedValueOnce(new Error('db down'));
    const ctx = await getGeoContext(41.57, 41.57);
    expect(ctx.source).toBe('macrostrat');
    expect(ctx.expected_rocks.length).toBe(3);
  });
});

describe('getGeoContext: отказы и деградация', () => {
  it('временный сбой → retry → успех', async () => {
    const good = fixtureFetch();
    let failures = 2;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (failures > 0) { failures--; throw new TypeError('fetch failed'); }
      return good(input, init);
    }));
    const ctx = await getGeoContext(36.06, -112.14);
    expect(ctx.source).toBe('macrostrat');
    expect(ctx.expected_rocks.length).toBeGreaterThan(0);
  });

  it('полный отказ API → source=none без исключения; кэш не пишется; негативный кэш гасит повторные запросы', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    vi.stubGlobal('fetch', fetchMock);
    const ctx = await getGeoContext(50.62, -2.27);
    expect(ctx.source).toBe('none');
    expect(ctx.expected_rocks).toEqual([]);
    expect(ctx.setting).toBeNull();
    expect(ctx.age_range).toBeNull();
    expect(ctx.wanderers).toEqual(['glacial_erratic']); // широта > 45° — без сети
    expect(fetchMock.mock.calls.length).toBe(3); // 3 попытки на центр, пробы не запрашиваются
    expect(cache.size).toBe(0);

    const again = await getGeoContext(50.62, -2.27);
    expect(again.source).toBe('none');
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('HTTP 503 ретраится, HTTP 404 — нет', async () => {
    const good = fixtureFetch();
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (first) { first = false; return new Response('oops', { status: 503 }); }
      return good(input, init);
    }));
    expect((await getGeoContext(64.13, -21.9)).source).toBe('macrostrat');

    resetGeoMemory();
    const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', notFound);
    expect((await getGeoContext(36.06, -112.14)).source).toBe('none');
    expect(notFound.mock.calls.length).toBe(1);
  });

  it('Macrostrat не покрывает точку (центр без юнитов) → source=none, не lake/coast, кэш не пишется', async () => {
    const fetchMock = vi.fn(async () => empty());
    vi.stubGlobal('fetch', fetchMock);
    const ctx = await getGeoContext(5.0, 20.0);
    expect(ctx.source).toBe('none');
    expect(ctx.setting).toBeNull();
    expect(ctx.wanderers).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('невалидные координаты → source=none без запросов', async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal('fetch', fetchMock);
    for (const [lat, lng] of [[NaN, 10], [10, Infinity], [91, 0], [0, 181]]) {
      const ctx = await getGeoContext(lat!, lng!);
      expect(ctx.source).toBe('none');
    }
    expect(fetchMock.mock.calls.length).toBe(0);
    expect(query.mock.calls.length).toBe(0);
  });
});

describe('normalize: эвристики setting/wanderers на синтетических юнитах', () => {
  const base = (center: object[], elev = 300, probeUnits: object[] | null = center) => ({
    lat: 40, lng: 10, fetched_at: '', probe_km: 4,
    center: center as never,
    probes: (['n', 's', 'e', 'w'] as const).map((dir) => ({ dir, lat: 40, lng: 10, units: probeUnits as never, elevation: elev })),
  });
  const granite = { map_id: 1, name: 'Pluton', lith: 'granite', liths: [53] };

  it('аллювий → river + river_transport', () => {
    const ctx = normalize(base([{ map_id: 1, name: 'Holocene alluvium', lith: 'alluvium', liths: [154] }]))!;
    expect(ctx.setting).toBe('river');
    expect(ctx.wanderers).toEqual(['river_transport']);
  });

  it('тилл/морена → glacial + glacial_erratic даже южнее 45°', () => {
    const ctx = normalize(base([{ map_id: 1, name: 'Moraine deposits', lith: 'till', liths: [97] }]))!;
    expect(ctx.setting).toBe('glacial');
    expect(ctx.wanderers).toEqual(['glacial_erratic']);
  });

  it('доминирующие вулканиты → volcanic; плутонические — inland без странников', () => {
    expect(normalize(base([{ map_id: 1, name: 'Lavas', lith: 'basalt, andesite', liths: [70, 69] }]))!.setting).toBe('volcanic');
    const ctx = normalize(base([granite]))!;
    expect(ctx.setting).toBe('inland');
    expect(ctx.wanderers).toEqual([]);
  });

  it('доли: центр 0.5, сухопутные пробы делят 0.5; сумма = 1', () => {
    const basalt = { map_id: 2, name: 'Lavas', lith: 'basalt', liths: [70] };
    const ctx = normalize(base([granite], 300, [basalt]))!;
    expect(ctx.expected_rocks).toEqual([{ rock_class: 'basalt', share: 0.5 }, { rock_class: 'granite', share: 0.5 }]);
  });

  it('generic-литологии: отбрасываются при наличии конкретных где угодно, иначе unknown_* по классу', () => {
    const generic = { map_id: 1, name: 'Metamorphic rocks', lith: 'metamorphic rocks', liths: [78] };
    const gneiss = { map_id: 2, name: 'B', lith: '', liths: [79] };
    expect(normalize(base([generic], 300, [gneiss]))!.expected_rocks).toEqual([{ rock_class: 'gneiss', share: 1 }]);
    expect(normalize(base([generic], 300, [generic]))!.expected_rocks).toEqual([{ rock_class: 'unknown_metamorphic', share: 1 }]);
  });

  it('пробы без юнитов и без отрицательной высоты — не море и не озеро (пустая карта ≠ вода)', () => {
    const ctx = normalize(base([granite], 5, []))!;
    expect(ctx.setting).toBe('inland');
    expect(ctx.wanderers).toEqual([]);
    expect(normalize(base([granite], 0, []))!.setting).toBe('coast'); // высота 0 при центре на суше — уровень моря
  });

  it('проба с высотой < 0 → coast; проба с пустым юнитом и высотой > 0 → lake', () => {
    const emptyUnit = { map_id: 9, name: '', lith: '', liths: [] };
    expect(normalize(base([granite], -3, []))!.setting).toBe('coast');
    expect(normalize(base([granite], 450, [emptyUnit]))!.setting).toBe('lake');
  });

  it('возраст из чисел, если нет имён интервалов', () => {
    const ctx = normalize(base([{ ...granite, b_age: 300, t_age: 250 }]))!;
    expect(ctx.age_range).toBe('300–250 Ma');
  });

  it('probePoints: широта клампится, долгота заворачивается', () => {
    const pole = probePoints(89.99, 0);
    expect(pole.every((p) => Math.abs(p.lat) <= 90)).toBe(true);
    const anti = probePoints(0, 179.999);
    expect(anti.every((p) => p.lng >= -180 && p.lng <= 180)).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PublicFindRow } from './publish';

// public-map.ts тянет ./supabase и ./auth через lib/publish.ts (сеть, react-native) — тот же приём, что в
// publish.test.ts: подменяем сетевой слой, тестируем чистую логику (otherFindPoints/shouldReloadOthers) и
// то, какие фильтры собирает fetchPublicFindsInBounds, без реальной сети.
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('./auth', () => ({ ensureUser: async () => ({ userId: 'test-user', deviceId: 'test-device' }) }));

const { supabase } = await import('./supabase');
const { fetchPublicFindsInBounds, otherFindPoints, shouldReloadOthers } = await import('./public-map');

/**Thenable-стаб запроса supabase: каждый метод возвращает себя (цепочка), кроме `then` — резолвит result. */
function makeQueryStub(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {
    then: (onFulfilled: (v: typeof result) => unknown) => Promise.resolve(result).then(onFulfilled),
  };
  for (const method of ['select', 'gte', 'lte', 'order', 'limit', 'abortSignal', 'or']) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  }
  return { builder, calls };
}

function row(overrides: Partial<PublicFindRow> = {}): PublicFindRow {
  return {
    id: 'find-1',
    rock_class: 'granite',
    tier: 'common',
    score: 12,
    lore: null,
    name: null,
    user_name: null,
    cell_id: 'szrv5f',
    created_at: '2026-09-01T00:00:00Z',
    published_at: '2026-09-01T00:00:00Z',
    author_name: null,
    center: { latitude: 41.674, longitude: 44.823 },
    lat: 41.674,
    lng: 44.823,
    ...overrides,
  };
}

describe('otherFindPoints', () => {
  it('пусто на входе — пусто на выходе', () => {
    expect(otherFindPoints([], new Set())).toEqual([]);
  });

  it('сохраняет точные координаты находки как есть — не центр ячейки (решение 2026-10-03)', () => {
    const [p] = otherFindPoints([row({ lat: 41.67401, lng: 44.82298 })], new Set());
    expect(p).toMatchObject({ id: 'find-1', lat: 41.67401, lng: 44.82298 });
  });

  it('отсеивает находки без гео (lat/lng = null)', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', lat: null, lng: null })];
    expect(otherFindPoints(rows, new Set()).map((p) => p.id)).toEqual(['a']);
  });

  it('отсеивает собственные публикации по id карточки — не задваивает их как «чужие»', () => {
    const rows = [row({ id: 'mine' }), row({ id: 'theirs' })];
    expect(otherFindPoints(rows, new Set(['mine'])).map((p) => p.id)).toEqual(['theirs']);
  });

  it('две находки с разными точными координатами остаются разными точками (не слипаются по ячейке)', () => {
    const rows = [row({ id: 'a', lat: 41.6701, lng: 44.8231 }), row({ id: 'b', lat: 41.9, lng: 45.1 })];
    const points = otherFindPoints(rows, new Set());
    expect(points[0]!.lat).not.toBe(points[1]!.lat);
  });
});

describe('shouldReloadOthers', () => {
  const region = (latitude: number, longitude: number, latitudeDelta = 1, longitudeDelta = 1) => ({ latitude, longitude, latitudeDelta, longitudeDelta });

  it('первая загрузка (prev = null) — всегда да', () => {
    expect(shouldReloadOthers(null, region(10, 20))).toBe(true);
  });

  it('мелкий сдвиг в пределах порога — не перезапрашиваем', () => {
    const prev = region(10, 20, 1, 1);
    const next = region(10.05, 20.05, 1, 1); // 5% от охвата
    expect(shouldReloadOthers(prev, next)).toBe(false);
  });

  it('заметный сдвиг центра — перезапрашиваем', () => {
    const prev = region(10, 20, 1, 1);
    const next = region(10.4, 20, 1, 1); // 40% от охвата
    expect(shouldReloadOthers(prev, next)).toBe(true);
  });

  it('заметное изменение масштаба — перезапрашиваем, даже без сдвига центра', () => {
    const prev = region(10, 20, 1, 1);
    const next = region(10, 20, 0.5, 0.5);
    expect(shouldReloadOthers(prev, next)).toBe(true);
  });
});

describe('fetchPublicFindsInBounds', () => {
  it('без антимеридиана — простой диапазон по lat и lng, без or()', async () => {
    const { builder, calls } = makeQueryStub({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(builder as never);
    await fetchPublicFindsInBounds({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('gte');
    expect(methods).toContain('lte');
    expect(calls.filter((c) => c.method === 'or')).toHaveLength(0);
  });

  it('антимеридиан (minLng > maxLng) — диапазон долготы собирается через or()', async () => {
    const { builder, calls } = makeQueryStub({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue(builder as never);
    await fetchPublicFindsInBounds({ minLat: 1, maxLat: 2, minLng: 170, maxLng: -170 });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall).toBeDefined();
    expect(String(orCall!.args[0])).toContain('lng.gte.170');
    expect(String(orCall!.args[0])).toContain('lng.lte.-170');
  });

  it('парсит вернувшиеся строки через parsePublicFindRow', async () => {
    const { builder } = makeQueryStub({ data: [row({ id: 'x' })], error: null });
    vi.mocked(supabase.from).mockReturnValue(builder as never);
    const rows = await fetchPublicFindsInBounds({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 });
    expect(rows.map((r) => r.id)).toEqual(['x']);
  });

  it('ошибка запроса — бросает, не возвращает молча пустой список', async () => {
    const { builder } = makeQueryStub({ data: null, error: { message: 'boom' } });
    vi.mocked(supabase.from).mockReturnValue(builder as never);
    await expect(fetchPublicFindsInBounds({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 })).rejects.toThrow();
  });
});

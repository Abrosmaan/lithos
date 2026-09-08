// Геоконтекст точки (dev-plan T1.2): geohash-6 → lithos.geo_cache (30 дней) → Macrostrat → нормализация → кэш.
// При отказе Macrostrat: просроченная строка кэша (source='cache', «предварительно») или source='none' —
// без исключения, воркер продолжает работу. Параллельные промахи одной ячейки дедуплицируются.
import ngeohash from 'ngeohash';
import { GEOHASH_PRECISION, ROCK_CLASSES, WANDERER_MECHANISMS } from '@lithos/shared';
import type { ExpectedRock, GeoContext, RockClass, WandererMechanism } from '@lithos/shared';
import { pool } from './db.js';
import { log } from './log.js';
import { fetchRaw, type MacrostratRaw } from './geo/macrostrat.js';
import { normalize, wanderersFor, GLACIAL_LATITUDE, type Normalized } from './geo/normalize.js';

export { normalize } from './geo/normalize.js';

// GEOHASH_PRECISION — из @lithos/shared (общий контракт с клиентом).
export { GEOHASH_PRECISION };
export const CACHE_TTL_DAYS = 30;
/** После отказа Macrostrat / отсутствия данных ячейка не опрашивается повторно это время. */
export const NEGATIVE_TTL_MS = 60_000;
const TABLE = 'lithos.geo_cache';

type CacheRow = Normalized;

const inflight = new Map<string, Promise<GeoContext>>();
const negative = new Map<string, number>();

/** Сброс in-memory состояния (in-flight, негативный кэш) — для тестов. */
export function resetGeoMemory(): void {
  inflight.clear();
  negative.clear();
}

export function cellIdFor(lat: number, lng: number): string {
  return ngeohash.encode(lat, lng, GEOHASH_PRECISION);
}

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Строка кэша могла быть записана под старым enum — чужие значения отбрасываем. */
function sanitizeRow(row: Record<string, unknown>): CacheRow {
  const rocks = Array.isArray(row.expected_rocks) ? (row.expected_rocks as ExpectedRock[]) : [];
  const wanderers = Array.isArray(row.wanderers) ? (row.wanderers as WandererMechanism[]) : [];
  return {
    expected_rocks: rocks.filter(
      (r) => r && typeof r.share === 'number' && (ROCK_CLASSES as readonly string[]).includes(r.rock_class as RockClass),
    ),
    wanderers: wanderers.filter((w) => (WANDERER_MECHANISMS as readonly string[]).includes(w)),
    age_range: typeof row.age_range === 'string' ? row.age_range : null,
    setting: typeof row.setting === 'string' ? row.setting : null,
  };
}

/** ttlDays=null — вернуть строку любой давности (fallback при отказе API). */
export async function readCache(cell_id: string, ttlDays: number | null = CACHE_TTL_DAYS): Promise<CacheRow | null> {
  const { rows } = ttlDays == null
    ? await pool.query(`select expected_rocks, wanderers, age_range, setting from ${TABLE} where cell_id = $1`, [cell_id])
    : await pool.query(
        `select expected_rocks, wanderers, age_range, setting from ${TABLE}
          where cell_id = $1 and fetched_at > now() - make_interval(days => $2::int)`,
        [cell_id, ttlDays],
      );
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? sanitizeRow(row) : null;
}

export async function writeCache(cell_id: string, raw: MacrostratRaw, ctx: CacheRow): Promise<void> {
  await pool.query(
    `insert into ${TABLE} (cell_id, macrostrat_json, expected_rocks, wanderers, age_range, setting, fetched_at)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, now())
     on conflict (cell_id) do update set
       macrostrat_json = excluded.macrostrat_json,
       expected_rocks  = excluded.expected_rocks,
       wanderers       = excluded.wanderers,
       age_range       = excluded.age_range,
       setting         = excluded.setting,
       fetched_at      = excluded.fetched_at`,
    [cell_id, JSON.stringify(raw), JSON.stringify(ctx.expected_rocks), JSON.stringify(ctx.wanderers), ctx.age_range, ctx.setting],
  );
}

export async function deleteCache(cell_id: string): Promise<void> {
  await pool.query(`delete from ${TABLE} where cell_id = $1`, [cell_id]);
}

function none(cell_id: string, lat: number): GeoContext {
  return {
    cell_id,
    expected_rocks: [],
    age_range: null,
    setting: null,
    wanderers: wanderersFor({ coast: false, river: false, glacial: Math.abs(lat) > GLACIAL_LATITUDE }),
    source: 'none',
  };
}

export async function getGeoContext(lat: number, lng: number): Promise<GeoContext> {
  if (!isValidCoord(lat, lng)) {
    log.warn('geo: invalid coordinates', { lat, lng });
    return none('', 0);
  }
  const cell_id = cellIdFor(lat, lng);
  const existing = inflight.get(cell_id);
  if (existing) return existing;
  const p = resolveCell(cell_id, lat).finally(() => inflight.delete(cell_id));
  inflight.set(cell_id, p);
  return p;
}

async function resolveCell(cell_id: string, lat: number): Promise<GeoContext> {
  let cached: CacheRow | null = null;
  try {
    cached = await readCache(cell_id);
  } catch (e) {
    log.warn('geo_cache read failed', { cell_id, error: String(e) });
  }
  if (cached) return { cell_id, ...cached, source: 'cache' };

  if ((negative.get(cell_id) ?? 0) > Date.now()) return staleOrNone(cell_id, lat);

  // Запрашиваем центроид ячейки: результат соответствует ключу кэша, а не первому скану в ячейке.
  const c = ngeohash.decode(cell_id);
  let raw: MacrostratRaw;
  try {
    raw = await fetchRaw(c.latitude, c.longitude);
  } catch (e) {
    log.error('macrostrat unavailable, geo context degraded', { cell_id, error: String(e) });
    negative.set(cell_id, Date.now() + NEGATIVE_TTL_MS);
    return staleOrNone(cell_id, lat);
  }

  const ctx = normalize(raw);
  if (!ctx) {
    log.warn('macrostrat has no units for cell', { cell_id });
    negative.set(cell_id, Date.now() + NEGATIVE_TTL_MS);
    return none(cell_id, lat);
  }
  try {
    await writeCache(cell_id, raw, ctx);
  } catch (e) {
    log.warn('geo_cache write failed', { cell_id, error: String(e) });
  }
  log.info('geo context fetched', { cell_id, setting: ctx.setting, rocks: ctx.expected_rocks.length });
  return { cell_id, ...ctx, source: 'macrostrat' };
}

async function staleOrNone(cell_id: string, lat: number): Promise<GeoContext> {
  try {
    const stale = await readCache(cell_id, null);
    if (stale) {
      log.warn('geo context from stale cache', { cell_id });
      return { cell_id, ...stale, source: 'cache' };
    }
  } catch (e) {
    log.warn('geo_cache stale read failed', { cell_id, error: String(e) });
  }
  return none(cell_id, lat);
}

// HTTP-клиент Macrostrat (T1.2). Центр: таймаут 10 с, 3 попытки, backoff 500·2ⁿ мс + jitter.
// Пробы (best effort): таймаут 5 с, 2 попытки. Общий бюджет на сбор геоконтекста — TOTAL_BUDGET_MS.
// Ретраим только сеть/таймаут/429/5xx; 4xx — сразу ошибка (битые координаты, 404).
// База — MACROSTRAT_BASE (или MACROSTRAT_API, как в .env), дефолт https://macrostrat.org/api/v2.
import { log } from '../log.js';

export function macrostratBase(): string {
  return process.env.MACROSTRAT_BASE ?? process.env.MACROSTRAT_API ?? 'https://macrostrat.org/api/v2';
}

export const CENTER_TIMEOUT_MS = 10_000;
export const CENTER_ATTEMPTS = 3;
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_ATTEMPTS = 2;
/** Общий дедлайн fetchRaw: центр + пробы. Цепочка скана — 90 с (dev-plan T2.1), гео не должно съедать её. */
export const TOTAL_BUDGET_MS = 30_000;
/** Базовая задержка backoff; тесты ставят 0, чтобы не ждать. */
export const retryPolicy = { backoffBaseMs: 500 };
export const PROBE_KM = 4;

/** Юнит из /geologic_units/map — только используемые поля (в geo_cache.macrostrat_json кладём их же). */
export interface MacrostratUnit {
  map_id: number;
  source_id?: number;
  name?: string | null;
  strat_name?: string | null;
  /** Свободная строка: «Major:{carbonates}, Minor{tuff group,andesite}» или «mudstone, sandstone and limestone». */
  lith?: string | null;
  /** id литологий из /defs/lithologies. */
  liths?: number[] | null;
  b_age?: number | null;
  t_age?: number | null;
  b_int_name?: string | null;
  t_int_name?: string | null;
}

export interface Probe {
  dir: 'n' | 's' | 'e' | 'w';
  lat: number;
  lng: number;
  /** null — запрос не удался (не фатально для геоконтекста). */
  units: MacrostratUnit[] | null;
  /** Высота, м (map_query_v2). null — нет данных. */
  elevation: number | null;
}

/** Что кладём в geo_cache.macrostrat_json. */
export interface MacrostratRaw {
  lat: number;
  lng: number;
  fetched_at: string;
  probe_km: number;
  center: MacrostratUnit[];
  probes: Probe[];
}

export class MacrostratError extends Error {}
export class HttpError extends MacrostratError {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

interface ReqOpts {
  attempts: number;
  timeoutMs: number;
  deadline: AbortSignal;
  /** Для лога: что и где запрашивали, без полного URL и точных координат пользователя. */
  label: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status >= 500;
  return true; // сеть, таймаут, невалидный JSON
}

async function getJson(url: string, o: ReqOpts): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    if (o.deadline.aborted) throw new MacrostratError('geo budget exhausted');
    try {
      const res = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(o.timeoutMs), o.deadline]),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new HttpError(res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      log.warn('macrostrat request failed', { req: o.label, attempt, error: String(e) });
      if (!isRetryable(e) || o.deadline.aborted) break;
      if (attempt < o.attempts) {
        const backoff = retryPolicy.backoffBaseMs * 2 ** (attempt - 1);
        await sleep(backoff + Math.random() * backoff * 0.5, o.deadline);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new MacrostratError(String(lastErr));
}

const coarse = (x: number) => Math.round(x * 100) / 100;

function slimUnit(u: Record<string, unknown>): MacrostratUnit {
  return {
    map_id: u.map_id as number,
    source_id: u.source_id as number | undefined,
    name: (u.name as string | null) ?? null,
    strat_name: (u.strat_name as string | null) ?? null,
    lith: (u.lith as string | null) ?? null,
    liths: Array.isArray(u.liths) ? (u.liths as number[]) : null,
    b_age: (u.b_age as number | null) ?? null,
    t_age: (u.t_age as number | null) ?? null,
    b_int_name: (u.b_int_name as string | null) ?? null,
    t_int_name: (u.t_int_name as string | null) ?? null,
  };
}

export async function fetchUnits(lat: number, lng: number, o: ReqOpts): Promise<MacrostratUnit[]> {
  const url = `${macrostratBase()}/geologic_units/map?lat=${lat}&lng=${lng}&format=json`;
  const body = (await getJson(url, o)) as { success?: { data?: unknown } };
  const data = body?.success?.data;
  if (!Array.isArray(data)) throw new MacrostratError('unexpected response shape');
  return data.map((u) => slimUnit(u as Record<string, unknown>));
}

export async function fetchElevation(lat: number, lng: number, o: ReqOpts): Promise<number | null> {
  const url = `${macrostratBase()}/mobile/map_query_v2?lat=${lat}&lng=${lng}&z=10`;
  const body = (await getJson(url, o)) as { success?: { data?: { elevation?: unknown } } };
  const e = body?.success?.data?.elevation;
  return typeof e === 'number' ? e : null;
}

/** Координаты 4 проб на расстоянии km по сторонам света; широта клампится, долгота заворачивается,
 *  сдвиг по долготе у полюсов ограничен 1°. Округление до 1e-5 (≈1 м), чтобы URL были воспроизводимы. */
export function probePoints(lat: number, lng: number, km = PROBE_KM): Array<Pick<Probe, 'dir' | 'lat' | 'lng'>> {
  const dlat = km / 111.32;
  const dlng = Math.min(1, km / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6)));
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  const clampLat = (x: number) => Math.max(-90, Math.min(90, x));
  const wrapLng = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return [
    { dir: 'n', lat: r(clampLat(lat + dlat)), lng: r(lng) },
    { dir: 's', lat: r(clampLat(lat - dlat)), lng: r(lng) },
    { dir: 'e', lat: r(lat), lng: r(wrapLng(lng + dlng)) },
    { dir: 'w', lat: r(lat), lng: r(wrapLng(lng - dlng)) },
  ];
}

/** Центр — обязателен (ошибка наружу). Пробы — best effort: отказ пробы даёт units/elevation = null. */
export async function fetchRaw(lat: number, lng: number): Promise<MacrostratRaw> {
  const deadline = AbortSignal.timeout(TOTAL_BUDGET_MS);
  const where = `${coarse(lat)},${coarse(lng)}`;
  const center = await fetchUnits(lat, lng, {
    attempts: CENTER_ATTEMPTS, timeoutMs: CENTER_TIMEOUT_MS, deadline, label: `units center ${where}`,
  });
  const probes = await Promise.all(
    probePoints(lat, lng).map(async (p): Promise<Probe> => {
      const o = { attempts: PROBE_ATTEMPTS, timeoutMs: PROBE_TIMEOUT_MS, deadline };
      const [units, elevation] = await Promise.all([
        fetchUnits(p.lat, p.lng, { ...o, label: `units probe ${p.dir} ${where}` }).catch(() => null),
        fetchElevation(p.lat, p.lng, { ...o, label: `elevation probe ${p.dir} ${where}` }).catch(() => null),
      ]);
      return { ...p, units, elevation };
    }),
  );
  return { lat, lng, fetched_at: new Date().toISOString(), probe_km: PROBE_KM, center, probes };
}

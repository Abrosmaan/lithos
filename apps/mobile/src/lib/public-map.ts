// Чужие находки на карте (T6.1-E2 → T7.3-C). Решение владельца (2026-10-03, отменяет прежнее): находка
// ставится по своим точным lat/lng (как в iNaturalist), не по центру ячейки geohash-6. Свои же опубликованные
// находки не должны задваиваться на карте как «чужие» (T6.0-fixes-and-social.md §2.2, п.4) — исключаем их
// по id карточки, как и раньше.
//
// T7.3-C: карта теперь грузит чужие находки по видимой области, а не целиком постранично — lib/publish.ts
// (listPublicFinds) фильтра по области не умеет и его трогать нельзя (вне границ этой задачи), хотя
// представление lithos.public_finds уже отдаёт lat/lng (T7.3-A) и фильтровать по диапазону можно прямо
// запросом. fetchPublicFindsInBounds ниже — такой запрос, в этом модуле, не в publish.ts: он переиспользует
// оттуда parsePublicFindRow и список колонок PUBLIC_FIND_COLUMNS — чтобы контракт со схемой оставался
// в одном месте, а не в двух.
import { ensureUser } from './auth';
import { MSG, UserError } from './errors';
import type { Region, RegionBounds } from './geo-math';
import { parsePublicFindRow, PUBLIC_FIND_COLUMNS, type PublicFindRow } from './publish';
import { withRetry } from './retry';
import { supabase } from './supabase';

/** Находка из public_finds с точными координатами — только такие можно поставить на карту. */
export type OtherFindPoint = PublicFindRow & { lat: number; lng: number };

const hasGeo = (r: PublicFindRow): r is OtherFindPoint => typeof r.lat === 'number' && typeof r.lng === 'number';

/**
 * Точки чужих находок для карты. Находки без гео (`lat`/`lng` = null — валидны, просто не на карте)
 * отсеиваются молча. Свои же публикации (id совпадает с одной из собственных карточек) тоже отсеиваются —
 * иначе своя находка нарисовалась бы дважды: своим маркером и «чужим».
 */
export function otherFindPoints(rows: readonly PublicFindRow[], ownCardIds: ReadonlySet<string>): OtherFindPoint[] {
  return rows.filter(hasGeo).filter((r) => !ownCardIds.has(r.id));
}

// ---------------------------------------------------------------------------
// Подгрузка по видимой области (T7.3-C, п.5).
// ---------------------------------------------------------------------------

/** Инженерный потолок одной подгрузки области — не балансовое число (CLAUDE.md — про score/тиры). */
export const REGION_FIND_LIMIT = 200;

/**
 * Чужие находки в прямоугольнике видимой области карты — прямой запрос к lithos.public_finds по lat/lng.
 * Антимеридиан (bounds.minLng > bounds.maxLng, см. geo-math.ts#regionBounds) — область разбивается на два
 * диапазона через `.or()`, иначе половина находок у разрыва координат потерялась бы.
 */
export async function fetchPublicFindsInBounds(bounds: RegionBounds, limit: number = REGION_FIND_LIMIT): Promise<PublicFindRow[]> {
  await ensureUser();
  return withRetry(async (signal) => {
    let q = supabase
      .from('public_finds')
      .select(PUBLIC_FIND_COLUMNS)
      .gte('lat', bounds.minLat)
      .lte('lat', bounds.maxLat)
      .order('published_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    q = bounds.minLng <= bounds.maxLng
      ? q.gte('lng', bounds.minLng).lte('lng', bounds.maxLng)
      : q.or(`lng.gte.${bounds.minLng},lng.lte.${bounds.maxLng}`);
    const r = await q;
    if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
    return (r.data ?? []).map(parsePublicFindRow).filter((x): x is PublicFindRow => x !== null);
  }, { label: 'public_finds.bounds' });
}

/** Доли сдвига/изменения зума региона, после которых область «ушла» достаточно далеко для повторного
 *  запроса — иначе запрос летел бы на каждый мелкий сдвиг карты (T7.3-C, п.5). Не балансовые числа. */
export const REGION_RELOAD_MOVE_FRACTION = 0.25;
export const REGION_RELOAD_ZOOM_FRACTION = 0.2;

/**
 * Стоит ли перезапрашивать чужие находки для нового региона карты. `prev === null` (первая загрузка) —
 * всегда да; иначе сравниваем сдвиг центра и изменение масштаба с охватом предыдущего запроса.
 */
export function shouldReloadOthers(prev: Region | null, next: Region): boolean {
  if (!prev) return true;
  const span = Math.max(prev.latitudeDelta, prev.longitudeDelta, Number.EPSILON);
  const movedLat = Math.abs(next.latitude - prev.latitude) / span;
  const movedLng = Math.abs(next.longitude - prev.longitude) / span;
  const zoomedLat = Math.abs(next.latitudeDelta - prev.latitudeDelta) / span;
  const zoomedLng = Math.abs(next.longitudeDelta - prev.longitudeDelta) / span;
  return movedLat > REGION_RELOAD_MOVE_FRACTION
    || movedLng > REGION_RELOAD_MOVE_FRACTION
    || zoomedLat > REGION_RELOAD_ZOOM_FRACTION
    || zoomedLng > REGION_RELOAD_ZOOM_FRACTION;
}

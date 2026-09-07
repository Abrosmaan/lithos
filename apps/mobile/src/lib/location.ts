// Гео: foreground, accuracy balanced, таймаут; отказ — не ошибка, карточка будет без редкости.
import * as Location from 'expo-location';
import { withTimeout } from './retry';

export const GEO_TIMEOUT_MS = 10_000;
export const GEO_LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;
export const GEO_CACHE_TTL_MS = 2 * 60_000;

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

export type GeoStatus = 'granted' | 'denied' | 'unavailable';

export interface GeoResult {
  fix: GeoFix | null;
  status: GeoStatus;
}

let inflight: Promise<GeoResult> | null = null;
let cached: { result: GeoResult; at: number } | null = null;

function toFix(pos: Location.LocationObject): GeoFix {
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
}

async function fetchGeo(): Promise<GeoResult> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { fix: null, status: 'denied' };
  try {
    const pos = await withTimeout(
      () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      GEO_TIMEOUT_MS,
      'geo',
    );
    return { fix: toFix(pos), status: 'granted' };
  } catch {
    const last = await Location.getLastKnownPositionAsync({ maxAge: GEO_LAST_KNOWN_MAX_AGE_MS }).catch(() => null);
    return last ? { fix: toFix(last), status: 'granted' } : { fix: null, status: 'unavailable' };
  }
}

/** Свежая позиция (кэш 2 мин, один запрос за раз). Никогда не бросает. */
export function requestGeoFix(): Promise<GeoResult> {
  if (cached && cached.result.fix && Date.now() - cached.at < GEO_CACHE_TTL_MS) return Promise.resolve(cached.result);
  if (inflight) return inflight;
  inflight = fetchGeo()
    .catch((): GeoResult => ({ fix: null, status: 'unavailable' }))
    .then((result) => {
      cached = { result, at: Date.now() };
      inflight = null;
      return result;
    });
  return inflight;
}

/** Прогрев: запросить разрешение и позицию заранее, пока пользователь снимает. */
export function prefetchGeo(): void {
  void requestGeoFix();
}

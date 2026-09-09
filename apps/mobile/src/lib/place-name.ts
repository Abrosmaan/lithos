// Топоним ячейки дневника (T6.0 §4a): «Ваке, Тбилиси» вместо «Ячейка szrv5f».
// Обратное геокодирование центра ячейки через expo-location. У Apple жёсткий рейт-лимит, поэтому:
// вечный кэш в AsyncStorage по cell_id (топоним не меняется), дедупликация параллельных вызовов,
// молчаливый fallback «Ячейка <cellId>» при отказе гео/сети/пустом ответе.
// Долгосрочная альтернатива (бэклог): топоним считает воркер и кладёт в lithos.geo_cache.
//
// Сборка имени — чистые функции (placeNameFromAddress/pickPlaceName), геокодер и хранилище —
// инжектируемые зависимости: тесты не ходят в сеть и не тянут нативные модули.
import { cellCenter, type LatLng } from './geohash';

/** Поля Location.LocationGeocodedAddress, которые нам нужны (структурная совместимость). */
export interface GeocodedAddress {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
}

export type ReverseGeocoder = (point: LatLng) => Promise<readonly GeocodedAddress[]>;

export interface PlaceStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface PlaceNameDeps {
  geocode?: ReverseGeocoder;
  store?: PlaceStore;
}

export const placeCacheKey = (cellId: string): string => `lithos.place.${cellId}`;

/** Что показываем, если топоним неизвестен: технический, но честный. */
export const fallbackPlaceName = (cellId: string): string => `Ячейка ${cellId}`;

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/**
 * Имя места из одного ответа геокодера по приоритету:
 * district + city → city → district → subregion → region. Пустой/бессмысленный ответ → null.
 */
export function placeNameFromAddress(addr: GeocodedAddress | null | undefined): string | null {
  if (!addr) return null;
  const district = clean(addr.district);
  const city = clean(addr.city);
  const subregion = clean(addr.subregion);
  const region = clean(addr.region);
  if (district && city) return district === city ? city : `${district}, ${city}`;
  return city ?? district ?? subregion ?? region ?? null;
}

/** Первый ответ геокодера, из которого получается осмысленное имя. */
export function pickPlaceName(addresses: readonly (GeocodedAddress | null | undefined)[] | null | undefined): string | null {
  if (!addresses) return null;
  for (const a of addresses) {
    const name = placeNameFromAddress(a);
    if (name) return name;
  }
  return null;
}

async function defaultGeocode(point: LatLng): Promise<readonly GeocodedAddress[]> {
  const Location = await import('expo-location');
  return Location.reverseGeocodeAsync(point);
}

async function defaultStore(): Promise<PlaceStore> {
  const mod = await import('@react-native-async-storage/async-storage');
  const AsyncStorage = mod.default;
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  };
}

const mem = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** Только для тестов: сбросить память процесса (кэш AsyncStorage не трогает). */
export function resetPlaceNameCache(): void {
  mem.clear();
  inflight.clear();
}

async function resolve(cellId: string, center: LatLng, deps: PlaceNameDeps): Promise<string> {
  const key = placeCacheKey(cellId);
  const store = deps.store ?? (await defaultStore().catch(() => null));
  if (store) {
    const cached = await store.getItem(key).catch(() => null);
    const name = clean(cached);
    if (name) {
      mem.set(cellId, name);
      return name;
    }
  }
  const geocode = deps.geocode ?? defaultGeocode;
  const name = pickPlaceName(await geocode(center));
  if (!name) return fallbackPlaceName(cellId); // море, безлюдная местность — fallback не кэшируем
  mem.set(cellId, name);
  if (store) await store.setItem(key, name).catch(() => undefined);
  return name;
}

/**
 * Название места для ячейки geohash. Никогда не бросает и никогда не показывает ошибку:
 * нет разрешения на гео, нет сети, пустой ответ — вернётся «Ячейка <cellId>».
 * Успешный топоним кэшируется навсегда; параллельные вызовы по одной ячейке дедуплицируются.
 */
export function placeNameForCell(cellId: string, deps: PlaceNameDeps = {}): Promise<string> {
  const cached = mem.get(cellId);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(cellId);
  if (running) return running;
  const center = cellCenter(cellId);
  if (!center) return Promise.resolve(fallbackPlaceName(cellId));
  const p = resolve(cellId, center, deps)
    .catch(() => fallbackPlaceName(cellId))
    .finally(() => inflight.delete(cellId));
  inflight.set(cellId, p);
  return p;
}

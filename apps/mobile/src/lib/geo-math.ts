// Расстояния по сфере (haversine) и «самая далёкая находка» — считается локально по карточкам.

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Located {
  id: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface FarthestFind<T extends Located> {
  /** Точка отсчёта — первая (самая ранняя) находка с координатами. */
  origin: T;
  /** Самая далёкая от origin карточка. */
  card: T;
  km: number;
}

const hasGeo = <T extends Located>(c: T): c is T & { lat: number; lng: number } => c.lat !== null && c.lng !== null;

/**
 * Самая далёкая находка (spec §8): максимум расстояния от первой находки с координатами до остальных.
 * Меньше двух карточек с гео → null.
 */
export function farthestFind<T extends Located>(cards: readonly T[]): FarthestFind<T> | null {
  const located = cards.filter(hasGeo).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const origin = located[0];
  if (!origin || located.length < 2) return null;
  let best: FarthestFind<T> | null = null;
  for (const c of located.slice(1)) {
    const km = haversineKm(origin.lat, origin.lng, c.lat, c.lng);
    if (!best || km > best.km) best = { origin, card: c, km };
  }
  return best;
}

/** «12 км», «850 м», «0 м». */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} м`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} км`;
  return `${Math.round(km)} км`;
}

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Потолки дельт региона: шире — карта (Mercator) ломается у полюсов. */
export const MAX_LAT_DELTA = 150;
export const MAX_LNG_DELTA = 360;

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Габариты набора точек — общая основа `boundingRegion` и `fitSpan` (раньше каждая считала их сама, и
 * обработка антимеридиана была продублирована). Антимеридиан: если разброс долгот > 180°, точки с
 * отрицательной долготой сдвигаются на +360 и берётся тот вариант, где обхват уже — Чукотка и Аляска
 * соседи, а не половина глобуса. Из-за сдвига `maxLng` может выйти за 180°: центр нормализует вызывающий.
 */
function bounds(points: readonly { lat: number; lng: number }[]): Bounds | null {
  const first = points[0];
  if (!first) return null;
  let minLat = first.lat, maxLat = first.lat, minLng = first.lng, maxLng = first.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  if (maxLng - minLng > 180) {
    const shifted = points.map((p) => (p.lng < 0 ? p.lng + 360 : p.lng));
    const sMin = Math.min(...shifted), sMax = Math.max(...shifted);
    if (sMax - sMin < maxLng - minLng) { minLng = sMin; maxLng = sMax; }
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Регион карты, вмещающий все точки с запасом; одна точка — окно ~2 км; нет точек — null.
 */
export function boundingRegion(points: readonly { lat: number; lng: number }[], paddingFactor = 1.4, minDelta = 0.02): Region | null {
  const b = bounds(points);
  if (!b) return null;
  let longitude = (b.minLng + b.maxLng) / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (b.minLat + b.maxLat) / 2,
    longitude,
    latitudeDelta: Math.min(MAX_LAT_DELTA, Math.max(minDelta, (b.maxLat - b.minLat) * paddingFactor)),
    longitudeDelta: Math.min(MAX_LNG_DELTA, Math.max(minDelta, (b.maxLng - b.minLng) * paddingFactor)),
  };
}

/**
 * Порог охвата (T6.1-B, дефект 3a): ниже него `fitToCoordinates` подгоняет карту под бокс без запаса
 * (в отличие от `boundingRegion`, у него нет `minDelta`) и уводит зум туда, где Apple Maps не отдаёт тайлы —
 * пустой серый экран. ≈ 400 м на средних широтах.
 */
export const MIN_FIT_SPAN = 0.004;

/**
 * Наибольший разброс координат набора точек (широта или долгота) — мера того, стоит ли вызывать
 * `fitToCoordinates` или лучше свести к `boundingRegion` (одна точка / несколько точек в одном месте).
 * Меньше двух точек → 0.
 */
export function fitSpan(points: readonly { lat: number; lng: number }[]): number {
  if (points.length < 2) return 0;
  const b = bounds(points)!;
  return Math.max(b.maxLat - b.minLat, b.maxLng - b.minLng);
}

/** Знаков после запятой при группировке маркеров: 5 ≈ 1 м, ближе точки на карте физически неразличимы. */
export const GROUP_PRECISION = 5;

/**
 * Группировка точек с (почти) совпадающими координатами в один маркер (T6.1-B, дефект 3c): два скана
 * одного камня приходят с разницей в единицы миллиметров и иначе рисуются как один кружок, второй
 * недостижим. Порядок групп — по первому вхождению, внутри группы — исходный порядок: список выбора
 * не должен переставляться между рендерами.
 */
export function groupByLocation<T extends { lat: number; lng: number }>(points: readonly T[], precision = GROUP_PRECISION): T[][] {
  const factor = 10 ** precision;
  // Math.round перед toFixed убирает «-0.00000» у точек чуть западнее нулевого меридиана: иначе соседи
  // по разные стороны от нуля получили бы разные ключи.
  const q = (v: number) => (Math.round(v * factor) / factor).toFixed(precision);
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const key = `${q(p.lat)}|${q(p.lng)}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()];
}

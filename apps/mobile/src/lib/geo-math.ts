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

/**
 * Регион карты, вмещающий все точки с запасом; одна точка — окно ~2 км; нет точек — null.
 * Антимеридиан: если разброс долгот > 180°, точки с отрицательной долготой сдвигаются на +360, центр нормализуется.
 */
export function boundingRegion(points: readonly { lat: number; lng: number }[], paddingFactor = 1.4, minDelta = 0.02): Region | null {
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
  let longitude = (minLng + maxLng) / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude,
    latitudeDelta: Math.min(MAX_LAT_DELTA, Math.max(minDelta, (maxLat - minLat) * paddingFactor)),
    longitudeDelta: Math.min(MAX_LNG_DELTA, Math.max(minDelta, (maxLng - minLng) * paddingFactor)),
  };
}

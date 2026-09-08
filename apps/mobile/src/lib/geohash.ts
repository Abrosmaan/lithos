// Geohash (base32, как ngeohash у воркера): кодирование точки в ячейку и границы ячейки для карты.
// Своя реализация — чтобы не тащить в клиент зависимость воркера; совместима с ngeohash.encode/decode_bbox.

import { GEOHASH_PRECISION } from '@lithos/shared';

export { GEOHASH_PRECISION };
const MAX_PRECISION = 12;

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function isGeohash(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_PRECISION && [...v].every((ch) => BASE32.includes(ch));
}

export function encodeGeohash(lat: number, lng: number, precision: number = GEOHASH_PRECISION): string {
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = '';
  let bits = 0, bit = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bit = bit * 2 + 1; minLng = mid; } else { bit *= 2; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bit = bit * 2 + 1; minLat = mid; } else { bit *= 2; maxLat = mid; }
    }
    even = !even;
    if (++bits === 5) { hash += BASE32[bit]; bits = 0; bit = 0; }
  }
  return hash;
}

/** Границы ячейки. Невалидный geohash → null. */
export function decodeBbox(hash: string): Bbox | null {
  if (!isGeohash(hash)) return null;
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let even = true;
  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    for (let mask = 16; mask > 0; mask >>= 1) {
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (idx & mask) minLng = mid; else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (idx & mask) minLat = mid; else maxLat = mid;
      }
      even = !even;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function cellCenter(hash: string): LatLng | null {
  const b = decodeBbox(hash);
  return b ? { latitude: (b.minLat + b.maxLat) / 2, longitude: (b.minLng + b.maxLng) / 2 } : null;
}

/** Четыре угла ячейки по часовой стрелке — для Polygon на карте. Только ячейки штатной точности (короткий хеш — огромный прямоугольник). */
export function cellPolygon(hash: string): LatLng[] | null {
  if (hash.length !== GEOHASH_PRECISION) return null;
  const b = decodeBbox(hash);
  if (!b) return null;
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

import { describe, expect, it } from 'vitest';
import { cellCenter, cellPolygon, decodeBbox, encodeGeohash, GEOHASH_PRECISION, isGeohash } from './geohash';

describe('geohash', () => {
  it('кодирует как ngeohash (эталонные значения)', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(encodeGeohash(42.6, -5.6, 5)).toBe('ezs42');
    expect(encodeGeohash(55.7558, 37.6173)).toHaveLength(GEOHASH_PRECISION);
    expect(encodeGeohash(55.7558, 37.6173)).toBe('ucfv0n');
  });

  it('bbox содержит исходную точку и совпадает с ngeohash.decode_bbox', () => {
    const b = decodeBbox('ezs42');
    expect(b).not.toBeNull();
    expect(b!.minLat).toBeCloseTo(42.583, 3);
    expect(b!.maxLat).toBeCloseTo(42.627, 3);
    expect(b!.minLng).toBeCloseTo(-5.625, 3);
    expect(b!.maxLng).toBeCloseTo(-5.581, 3);
  });

  it('round-trip: центр ячейки кодируется в ту же ячейку', () => {
    for (const h of ['szms3z', 'ucftpx', 'u4pruy', '000000', 'zzzzzz']) {
      const c = cellCenter(h)!;
      expect(encodeGeohash(c.latitude, c.longitude)).toBe(h);
    }
  });

  it('polygon: четыре угла по часовой стрелке, ширина ячейки geohash-6 ≈ 0.011° по долготе', () => {
    const p = cellPolygon('szms3z')!;
    expect(p).toHaveLength(4);
    expect(p[0]!.latitude).toBe(p[1]!.latitude);
    expect(p[2]!.latitude).toBe(p[3]!.latitude);
    expect(p[1]!.longitude - p[0]!.longitude).toBeCloseTo(360 / 2 ** 15, 6);
    expect(p[0]!.latitude - p[3]!.latitude).toBeCloseTo(180 / 2 ** 15, 6);
  });

  it('невалидный хеш → null / false', () => {
    expect(isGeohash('abc')).toBe(false); // 'a' нет в base32 geohash
    expect(isGeohash('')).toBe(false);
    expect(isGeohash(null)).toBe(false);
    expect(decodeBbox('a1')).toBeNull();
    expect(cellPolygon('')).toBeNull();
    expect(cellPolygon('ezs42')).toBeNull(); // не geohash-6
    expect(isGeohash('0123456789bcd')).toBe(false); // длиннее 12
  });
});

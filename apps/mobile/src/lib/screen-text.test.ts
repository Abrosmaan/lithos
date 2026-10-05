import { describe, expect, it } from 'vitest';
import { exactCoordsText } from './screen-text';

describe('exactCoordsText', () => {
  it('формат «N/S, E/W» с пятью знаками — честная точность, не округление до ячейки (T7.3)', () => {
    expect(exactCoordsText(46.558012, 7.981234)).toBe('46.55801 N, 7.98123 E');
  });

  it('отрицательные координаты — S/W', () => {
    expect(exactCoordsText(-33.8688, 151.2093)).toBe('33.86880 S, 151.20930 E');
    expect(exactCoordsText(40.7128, -74.006)).toBe('40.71280 N, 74.00600 W');
  });

  it('нулевые координаты — N/E по соглашению знака >= 0', () => {
    expect(exactCoordsText(0, 0)).toBe('0.00000 N, 0.00000 E');
  });
});

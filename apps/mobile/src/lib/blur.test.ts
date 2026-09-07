import { describe, expect, it } from 'vitest';
import { BLUR_VARIANCE_THRESHOLD, DARK_LUMA_THRESHOLD, isBlurry, isDark, laplacianVariance, meanLuminance } from './blur';

function rgba(width: number, height: number, luma: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = Math.max(0, Math.min(255, Math.round(luma(x, y))));
    const p = (y * width + x) * 4;
    out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
  }
  return out;
}

/** Box-blur 3×3 по яркости — имитация расфокуса. */
function boxBlur(src: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let cur = src;
  for (let k = 0; k < passes; k++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        sum += cur[(yy * width + xx) * 4] ?? 0; n++;
      }
      const p = (y * width + x) * 4;
      const v = Math.round(sum / n);
      next[p] = v; next[p + 1] = v; next[p + 2] = v; next[p + 3] = 255;
    }
    cur = next;
  }
  return cur;
}

const W = 128, H = 96;

describe('laplacianVariance', () => {
  it('плоский серый кадр → 0 (размыт/без деталей)', () => {
    const v = laplacianVariance(rgba(W, H, () => 128), W, H);
    expect(v).toBe(0);
    expect(isBlurry(v)).toBe(true);
  });

  it('резкий шахматный паттерн → много выше порога', () => {
    const v = laplacianVariance(rgba(W, H, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 200 : 60)), W, H);
    expect(v).toBeGreaterThan(BLUR_VARIANCE_THRESHOLD * 10);
    expect(isBlurry(v)).toBe(false);
  });

  it('размытие снижает variance монотонно, сильное — ниже порога', () => {
    const sharp = rgba(W, H, (x, y) => (((x >> 4) + (y >> 4)) % 2 ? 180 : 80) + ((x * 7 + y * 13) % 5) * 4);
    const v0 = laplacianVariance(sharp, W, H);
    const v2 = laplacianVariance(boxBlur(sharp, W, H, 2), W, H);
    const v16 = laplacianVariance(boxBlur(sharp, W, H, 16), W, H);
    expect(v0).toBeGreaterThan(v2);
    expect(v2).toBeGreaterThan(v16);
    expect(isBlurry(v0)).toBe(false);
    expect(isBlurry(v16)).toBe(true);
  });

  it('плавный градиент (нет деталей) → ниже порога', () => {
    const v = laplacianVariance(rgba(W, H, (x) => 60 + (x / W) * 120), W, H);
    expect(v).toBeLessThan(BLUR_VARIANCE_THRESHOLD);
  });

  it('слишком маленький кадр → 0, короткий буфер → ошибка', () => {
    expect(laplacianVariance(new Uint8Array(2 * 2 * 4), 2, 2)).toBe(0);
    expect(() => laplacianVariance(new Uint8Array(10), W, H)).toThrow();
  });
});

describe('meanLuminance / isDark', () => {
  it('тёмный кадр ниже порога, обычный — выше', () => {
    expect(isDark(meanLuminance(rgba(W, H, () => 10), W, H))).toBe(true);
    expect(isDark(meanLuminance(rgba(W, H, () => 128), W, H))).toBe(false);
    expect(meanLuminance(rgba(W, H, () => 128), W, H)).toBeCloseTo(128, 5);
    expect(DARK_LUMA_THRESHOLD).toBeGreaterThan(0);
  });
});

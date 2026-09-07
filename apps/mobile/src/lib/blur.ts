// S0 Preflight (ai-pipeline §3): детект размытия — variance of Laplacian.
// Чистая функция без нативных зависимостей: считается по RGBA-пикселям уменьшенной копии
// (BLUR_SAMPLE_SIZE px по длинной стороне), которую даёт jpeg-js (см. preflight.ts).
// Порог калиброван на этом масштабе; на полноразмерном фото значения другие.

/** Длинная сторона уменьшенной копии для blur-детекта. */
export const BLUR_SAMPLE_SIZE = 128;

/**
 * Порог variance of Laplacian на копии 128 px (яркость 0..255).
 * Калибровка на синтетической многооктавной текстуре (docs/tasks/T1.4.md): резкие → 43–193,
 * размытие σ=5 px (в масштабе 1024) → 18–70, σ≥8 px → 9–27. Порог консервативный: отсекаем
 * только явно размытое, пограничное доверяем S1 Gate (quality=blurry). Уточнить на golden set.
 */
export const BLUR_VARIANCE_THRESHOLD = 25;

/**
 * Variance of Laplacian по RGBA-буферу. Яркость — Rec.601, ядро 4-связного лапласиана
 * [0 1 0; 1 -4 1; 0 1 0], без учёта границы в 1 px.
 */
export function laplacianVariance(rgba: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  if (rgba.length < width * height * 4) throw new Error('rgba buffer too small');

  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0);
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap =
        (gray[i - width] ?? 0) + (gray[i + width] ?? 0) + (gray[i - 1] ?? 0) + (gray[i + 1] ?? 0) - 4 * (gray[i] ?? 0);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Средняя яркость (0..255), ниже которой кадр считаем тёмным/без деталей, а не размытым. */
export const DARK_LUMA_THRESHOLD = 40;

export function meanLuminance(rgba: Uint8Array, width: number, height: number): number {
  const n = width * height;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    sum += 0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0);
  }
  return sum / n;
}

export function isDark(meanLuma: number, threshold: number = DARK_LUMA_THRESHOLD): boolean {
  return meanLuma < threshold;
}

export function isBlurry(variance: number, threshold: number = BLUR_VARIANCE_THRESHOLD): boolean {
  return variance < threshold;
}

// S0 Preflight на воркере (ai-pipeline §3 S0): нормализация до 1024 px / JPEG q=85, резкость
// (variance of Laplacian) для выбора фото в Gate, pHash (sharp → imghash/blockhash) для дедупа.
import imghash from 'imghash';
import sharp from 'sharp';
import { PIPELINE } from './constants.js';

export interface NormalizedImage {
  bytes: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/** Поворот по EXIF, ≤ 1024 px по длинной стороне, JPEG q=85. Клиент уже сжал — воркер страхует токены. */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const out = await sharp(input)
    .rotate()
    .resize({ width: PIPELINE.imageMaxSide, height: PIPELINE.imageMaxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PIPELINE.jpegQuality })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, mimeType: 'image/jpeg', width: out.info.width, height: out.info.height };
}

/** Резкость: дисперсия лапласиана (4-связного) на серой копии ≤ 256 px. Больше — резче. */
export async function sharpness(bytes: Buffer): Promise<number> {
  const { data, info } = await sharp(bytes)
    .grayscale()
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Perceptual hash (blockhash, 64 бит → 16 hex). Считается на RGBA-копии 256×256 — независимо от размера кадра. */
export async function perceptualHash(bytes: Buffer, bits: number = PIPELINE.phashBits): Promise<string> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .resize({ width: 256, height: 256, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return imghash.hashRaw({ width: info.width, height: info.height, data }, bits);
}

/** Расстояние Хэмминга между hex-хэшами одной длины; разная длина → Infinity (несравнимо). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16);
    const y = parseInt(b[i]!, 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return Infinity;
    let v = x ^ y;
    while (v) {
      d += v & 1;
      v >>= 1;
    }
  }
  return d;
}

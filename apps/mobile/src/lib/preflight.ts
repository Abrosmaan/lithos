// S0 Preflight на клиенте (ai-pipeline §3): ресайз 1024 px по длинной стороне, JPEG q=0.85,
// blur-детект по уменьшенной копии (jpeg-js декодирует 128 px в JS — дёшево, без нативки).
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';
import { BLUR_SAMPLE_SIZE, isBlurry, isDark, laplacianVariance, meanLuminance } from './blur';

export const PHOTO_MAX_SIDE = 1024;
export const PHOTO_JPEG_QUALITY = 0.85;
const SAMPLE_JPEG_QUALITY = 0.9;

export interface SourcePhoto {
  uri: string;
  width: number;
  height: number;
}

export interface PreparedPhoto {
  uri: string;
  width: number;
  height: number;
  /** Variance of Laplacian на копии BLUR_SAMPLE_SIZE px — чем больше, тем резче. */
  sharpness: number;
}

export type PreflightReason = 'blurry' | 'dark';
export type PreflightResult = { ok: true; photo: PreparedPhoto } | { ok: false; reason: PreflightReason };

function fitLongSide(width: number, height: number, maxSide: number): { width?: number; height?: number } | null {
  if (width <= 0 || height <= 0) return { width: maxSide };
  if (Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

async function resizeToJpeg(uri: string, size: { width?: number; height?: number } | null, quality: number) {
  const ctx = ImageManipulator.manipulate(uri);
  if (size) ctx.resize(size);
  const image = await ctx.renderAsync();
  try {
    return await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  } finally {
    image.release();
  }
}

/** Удалить временный файл в кэше (фото после отказа, черновик после отправки). Ошибки глотаем. */
export function deleteFileQuietly(uri: string): void {
  try { new File(uri).delete(); } catch { /* уже удалён или недоступен — не критично */ }
}

export interface SharpnessStats {
  sharpness: number;
  meanLuma: number;
}

/** Резкость и яркость по уменьшенной копии: JPEG → jpeg-js → RGBA → variance of Laplacian. */
export async function measureSharpness(uri: string, width: number, height: number): Promise<SharpnessStats> {
  const sample = await resizeToJpeg(uri, fitLongSide(width, height, BLUR_SAMPLE_SIZE) ?? { width: BLUR_SAMPLE_SIZE }, SAMPLE_JPEG_QUALITY);
  try {
    const bytes = await new File(sample.uri).bytes();
    const img = decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { sharpness: laplacianVariance(img.data, img.width, img.height), meanLuma: meanLuminance(img.data, img.width, img.height) };
  } finally {
    deleteFileQuietly(sample.uri);
  }
}

export async function preparePhoto(src: SourcePhoto): Promise<PreflightResult> {
  const main = await resizeToJpeg(src.uri, fitLongSide(src.width, src.height, PHOTO_MAX_SIDE), PHOTO_JPEG_QUALITY);
  const { sharpness, meanLuma } = await measureSharpness(main.uri, main.width, main.height);
  if (isBlurry(sharpness)) {
    deleteFileQuietly(main.uri);
    return { ok: false, reason: isDark(meanLuma) ? 'dark' : 'blurry' };
  }
  return { ok: true, photo: { uri: main.uri, width: main.width, height: main.height, sharpness } };
}

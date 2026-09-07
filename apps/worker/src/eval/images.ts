// Картинки для eval: golden set с диска (сжатие как S0: 1024 px, JPEG q=85) и синтетика «не камень» для --synthetic.
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { ImageInput } from '../llm/types.js';
import { GOLDEN_IMAGES_DIR, type GoldenLabel } from './labels.js';

/** Длинная сторона после сжатия — как у клиента (ai-pipeline §3 S0). */
export const EVAL_IMAGE_PX = 1024;
export const EVAL_JPEG_QUALITY = 85;

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function imagePath(label: Pick<GoldenLabel, 'file'>): string | null {
  return label.file ? resolve(GOLDEN_IMAGES_DIR, label.file) : null;
}

export async function loadGoldenImage(label: Pick<GoldenLabel, 'file'>): Promise<ImageInput | null> {
  const p = imagePath(label);
  if (!p || !(await fileExists(p))) return null;
  const bytes = await sharp(await readFile(p))
    .rotate()
    .resize({ width: EVAL_IMAGE_PX, height: EVAL_IMAGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: EVAL_JPEG_QUALITY })
    .toBuffer();
  return { bytes, mimeType: 'image/jpeg' };
}

export interface SyntheticItem {
  label: GoldenLabel;
  image: ImageInput;
}

function rawImage(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * w + x) * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  return raw;
}

async function toJpeg(raw: Buffer, w: number, h: number): Promise<ImageInput> {
  const bytes = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: EVAL_JPEG_QUALITY }).toBuffer();
  return { bytes, mimeType: 'image/jpeg' };
}

/**
 * Три картинки, на которых gate обязан ответить is_rock=false: серый шум, «скриншот» (плоский фон, панели, пиксельная сетка),
 * шахматная доска. Детерминированный PRNG — прогон воспроизводим.
 */
export async function syntheticItems(): Promise<SyntheticItem[]> {
  const w = 768;
  const h = 768;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const noise = rawImage(w, h, () => {
    const v = 110 + Math.floor(rnd() * 50);
    return [v, v, v - 5];
  });
  const screen = rawImage(w, h, (x, y) => {
    if (y < 80) return [32, 33, 36]; // status bar
    if (y > h - 120) return [245, 245, 245]; // nav bar
    if (x > 60 && x < w - 60 && y > 140 && y < 420) return [66, 133, 244]; // card
    const grid = (x % 3 === 0 || y % 3 === 0) ? 6 : 0;
    return [230 - grid, 232 - grid, 236 - grid];
  });
  const checker = rawImage(w, h, (x, y) => (((x >> 6) + (y >> 6)) % 2 === 0 ? [20, 20, 20] : [235, 235, 235]));
  const base: Omit<GoldenLabel, 'id' | 'notes'> = {
    file: null,
    is_rock: false,
    rock_class: 'unknown',
    acceptable_alternatives: [],
    inclusions: [],
    geology_type: 'volcanic_coast',
    trap: null,
    decoy: null,
    lat: 0,
    lng: 0,
    source: null,
  };
  return [
    { label: { ...base, id: 'sy-01', notes: 'серый шум' }, image: await toJpeg(noise, w, h) },
    { label: { ...base, id: 'sy-02', notes: 'синтетический скриншот' }, image: await toJpeg(screen, w, h) },
    { label: { ...base, id: 'sy-03', notes: 'шахматная доска' }, image: await toJpeg(checker, w, h) },
  ];
}

// Чистые помощники отправки скана (без нативных импортов — тестируются в vitest).
import type { PreparedPhoto } from './preflight';

export const PHOTO_BUCKET = 'lithos-photos';
export const MAX_PHOTOS = 3;

/** Путь объекта в Storage: <user_id>/<scan_id>/<n>.jpg (миграция 0002). */
export function photoStoragePath(userId: string, scanId: string, index: number): string {
  return `${userId}/${scanId}/${index + 1}.jpg`;
}

/** Основное фото для S1 Gate — самое резкое (ai-pipeline §3 S1: «лучшее по резкости»). */
export function primaryPhotoIndex(photos: readonly Pick<PreparedPhoto, 'sharpness'>[]): number {
  let best = 0;
  photos.forEach((p, i) => { if (p.sharpness > (photos[best]?.sharpness ?? -Infinity)) best = i; });
  return best;
}

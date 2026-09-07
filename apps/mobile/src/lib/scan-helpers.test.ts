import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS, PHOTO_BUCKET, photoStoragePath, primaryPhotoIndex } from './scan-helpers';

describe('scan-helpers', () => {
  it('путь в Storage: <user_id>/<scan_id>/<n>.jpg, n с единицы', () => {
    expect(photoStoragePath('u1', 's1', 0)).toBe('u1/s1/1.jpg');
    expect(photoStoragePath('u1', 's1', 2)).toBe('u1/s1/3.jpg');
    expect(PHOTO_BUCKET).toBe('lithos-photos');
    expect(MAX_PHOTOS).toBe(3);
  });

  it('основное фото — самое резкое; при равенстве — первое', () => {
    expect(primaryPhotoIndex([{ sharpness: 10 }, { sharpness: 50 }, { sharpness: 30 }])).toBe(1);
    expect(primaryPhotoIndex([{ sharpness: 5 }, { sharpness: 5 }])).toBe(0);
    expect(primaryPhotoIndex([])).toBe(0);
  });
});

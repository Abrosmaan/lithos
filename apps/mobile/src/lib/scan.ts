// Отправка скана: lithos.scans → Storage lithos-photos/<user_id>/<scan_id>/<n>.jpg → lithos.scan_photos
// → rpc enqueue_scan. Всё идемпотентно по scan_id: повтор после сбоя с тем же id не создаёт дублей.
import type { UserTests } from '@lithos/shared';
import { File } from 'expo-file-system';
import { ensureUser } from './auth';
import { MSG, UserError } from './errors';
import type { GeoFix } from './location';
import type { PreparedPhoto } from './preflight';
import { withRetry } from './retry';
import { MAX_PHOTOS, PHOTO_BUCKET, photoStoragePath, primaryPhotoIndex } from './scan-helpers';
import { scanPhotoId } from './scan-id';
import { supabase } from './supabase';

export { MAX_PHOTOS, PHOTO_BUCKET } from './scan-helpers';

const UPLOAD_TIMEOUT_MS = 60_000;

export interface DraftPhoto extends PreparedPhoto {
  isScale: boolean;
}

export interface SubmitScanInput {
  scanId: string;
  photos: DraftPhoto[];
  tests: UserTests;
  geo: GeoFix | null;
  /** Раскол (T2.3): скан свежего скола; воркер берёт гео и тесты от родительской карточки. */
  parentCardId?: string | null;
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  const bytes = await new File(uri).bytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function submitScan(input: SubmitScanInput): Promise<{ scanId: string }> {
  if (input.photos.length === 0 || input.photos.length > MAX_PHOTOS) {
    throw new UserError(MSG.photoCount, { retryable: false });
  }
  const { userId } = await ensureUser();
  const { scanId } = input;
  const scanFields = {
    lat: input.geo?.lat ?? null,
    lng: input.geo?.lng ?? null,
    accuracy_m: input.geo?.accuracy_m ?? null,
    user_tests: input.tests,
    parent_card_id: input.parentCardId ?? null,
  };

  // 1. scans: insert (stage = default 'preflight'); при повторе — только обновить поля клиента
  //    и только пока скан ещё не ушёл в конвейер (stage воркера не откатываем).
  await withRetry(async (signal) => {
    const ins = await supabase
      .from('scans')
      .upsert({ id: scanId, user_id: userId, ...scanFields }, { onConflict: 'id', ignoreDuplicates: true })
      .abortSignal(signal);
    if (ins.error) throw new UserError(MSG.submitFailed, { cause: ins.error });
    const upd = await supabase.from('scans').update(scanFields).eq('id', scanId).eq('stage', 'preflight').abortSignal(signal);
    if (upd.error) throw new UserError(MSG.submitFailed, { cause: upd.error });
  }, { label: 'scans.upsert' });

  // 2. фото в Storage (upsert: true — тот же путь перезаписывается; политика update — миграция 0003).
  //    У storage.upload нет AbortSignal: таймаут отклоняет обёртку, запрос доезжает сам; повтор безопасен.
  const paths: string[] = [];
  for (const [i, photo] of input.photos.entries()) {
    const path = photoStoragePath(userId, scanId, i);
    await withRetry(async () => {
      const body = await readBytes(photo.uri);
      const r = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: true });
      if (r.error) throw new UserError(MSG.uploadFailed, { cause: r.error });
    }, { label: `upload ${i + 1}`, timeoutMs: UPLOAD_TIMEOUT_MS });
    paths.push(path);
  }

  // 3. scan_photos: id детерминирован (uuid v5 от scan_id|storage_path) → upsert идемпотентен
  //    без уникального ключа по пути и без delete в RLS.
  const primary = primaryPhotoIndex(input.photos);
  const rows = await Promise.all(
    input.photos.map(async (p, i) => {
      const storage_path = paths[i] ?? '';
      return { id: await scanPhotoId(scanId, storage_path), scan_id: scanId, storage_path, is_primary: i === primary, width: p.width, height: p.height };
    }),
  );
  await withRetry(async (signal) => {
    const r = await supabase.from('scan_photos').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(signal);
    if (r.error) throw new UserError(MSG.submitFailed, { cause: r.error });
  }, { label: 'scan_photos.upsert' });

  // 4. очередь scan_interactive
  await withRetry(async (signal) => {
    const r = await supabase.rpc('enqueue_scan', { p_scan_id: scanId }).abortSignal(signal);
    if (r.error) throw new UserError(MSG.submitFailed, { cause: r.error });
  }, { label: 'enqueue_scan' });

  return { scanId };
}

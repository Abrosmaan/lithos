// Скачивание фото из приватного бакета lithos-photos под service-ключом (supabase-js, .schema('lithos')).
// Ключ живёт только здесь и в env; в лог не попадает. Таймаут на каждый запрос + retry на временных ошибках.
import { createClient } from '@supabase/supabase-js';
import { PIPELINE } from './constants.js';
import { PhotoUnavailableError, type PhotoStore } from './types.js';

export const PHOTO_BUCKET = 'lithos-photos';

/** Ошибка Storage «нет объекта / плохой запрос» — постоянная, retry бесполезен; остальное — временное. */
function isPermanentStorageError(err: { status?: number | undefined; message: string }): boolean {
  const s = err.status;
  if (s === 400 || s === 404) return true;
  return /not found|object not found/i.test(err.message);
}

export interface PhotoStoreOptions {
  bucket?: string;
  timeoutMs?: number;
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Для тестов: подмена fetch. */
  fetch?: typeof fetch;
}

export function createPhotoStore(url: string, serviceKey: string, o: PhotoStoreOptions = {}): PhotoStore {
  const bucket = o.bucket ?? PHOTO_BUCKET;
  const timeoutMs = o.timeoutMs ?? PIPELINE.storageTimeoutMs;
  const attempts = o.attempts ?? PIPELINE.storageAttempts;
  const backoffMs = o.backoffMs ?? PIPELINE.storageBackoffMs;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseFetch = o.fetch ?? fetch;
  // supabase-js не принимает AbortSignal в download(): таймаут ставим на уровне fetch.
  const timedFetch: typeof fetch = (input, init) => baseFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const client = createClient(url, serviceKey, {
    db: { schema: 'lithos' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  return {
    async download(storagePath: string): Promise<Buffer> {
      let last: Error = new Error('storage: no attempts');
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const { data, error } = await client.storage.from(bucket).download(storagePath);
          if (error) {
            if (isPermanentStorageError(error)) throw new PhotoUnavailableError(storagePath, `storage: ${error.message}`);
            throw new Error(`storage download failed (${error.status ?? 'no status'}): ${error.message.slice(0, 200)}`);
          }
          if (!data) throw new PhotoUnavailableError(storagePath, 'storage: empty response');
          return Buffer.from(await data.arrayBuffer());
        } catch (e) {
          if (e instanceof PhotoUnavailableError) throw e;
          last = e instanceof Error ? e : new Error(String(e));
          if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
        }
      }
      throw last;
    },
  };
}

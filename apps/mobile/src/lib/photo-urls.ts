// Лицевые фото карточек для сетки: один запрос scan_photos на пачку сканов + один createSignedUrls,
// кэш подписанных URL в памяти и AsyncStorage (TTL 1 ч, обновляем за 10 мин до истечения).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScanPhotoRow } from './card-types';
import { logError, MSG, UserError } from './errors';
import { withRetry } from './retry';
import { PHOTO_BUCKET } from './scan-helpers';
import { supabase } from './supabase';

const SIGNED_URL_TTL_S = 60 * 60;
const REFRESH_BEFORE_MS = 10 * 60_000;
const CACHE_KEY = 'lithos.cache.photo_urls';
const CHUNK = 100;

interface Entry { url: string; exp: number }

let mem: Map<string, Entry> | null = null;
let loading: Promise<Map<string, Entry>> | null = null;

async function memory(): Promise<Map<string, Entry>> {
  if (mem) return mem;
  if (loading) return loading;
  loading = (async () => {
    const map = new Map<string, Entry>();
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v && typeof v === 'object' && typeof (v as Entry).url === 'string' && typeof (v as Entry).exp === 'number') map.set(k, v as Entry);
        }
      }
    } catch (e) { logError('photo_urls.read', e); }
    mem = map;
    loading = null;
    return map;
  })();
  return loading;
}

async function persist(map: Map<string, Entry>): Promise<void> {
  const now = Date.now();
  const obj: Record<string, Entry> = {};
  for (const [k, v] of map) if (v.exp > now) obj[k] = v;
  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { logError('photo_urls.write', e); }
}

const fresh = (e: Entry | undefined, now: number): e is Entry => !!e && e.exp - now > REFRESH_BEFORE_MS;

/**
 * scan_id → signed URL лицевого фото (is_primary, иначе первое по пути). Сканы без фото в ответе отсутствуют.
 * Сеть недоступна → отдаём что есть в кэше, ошибку не бросаем (сетка покажет заглушки).
 */
export async function fetchPrimaryPhotoUrls(scanIds: readonly string[]): Promise<Map<string, string>> {
  const map = await memory();
  const now = Date.now();
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(scanIds)) {
    const e = map.get(id);
    if (fresh(e, now)) out.set(id, e.url); else missing.push(id);
  }
  if (missing.length === 0) return out;

  try {
    const pathByScan = new Map<string, { path: string; primary: boolean }>();
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const rows = await withRetry(async (signal) => {
        const r = await supabase.from('scan_photos').select('scan_id, storage_path, is_primary').in('scan_id', chunk).order('storage_path').abortSignal(signal);
        if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
        return r.data ?? [];
      }, { label: 'scan_photos.batch' });
      for (const raw of rows) {
        const p = parseScanPhotoRow(raw);
        const scanId = (raw as { scan_id?: unknown }).scan_id;
        if (!p || typeof scanId !== 'string') continue;
        const cur = pathByScan.get(scanId);
        if (!cur || (p.is_primary && !cur.primary)) pathByScan.set(scanId, { path: p.storage_path, primary: p.is_primary });
      }
    }
    const entries = [...pathByScan.entries()];
    if (entries.length > 0) {
      const signed = await withRetry(async () => {
        const r = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(entries.map(([, v]) => v.path), SIGNED_URL_TTL_S);
        if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
        return r.data ?? [];
      }, { label: 'storage.signBatch' });
      const norm = (path: string) => path.replace(/^\/+/, '');
      const urlByPath = new Map<string, string>();
      for (const s of signed) if (!s.error && s.signedUrl && s.path) urlByPath.set(norm(s.path), s.signedUrl);
      const exp = Date.now() + SIGNED_URL_TTL_S * 1000;
      for (const [scanId, v] of entries) {
        const url = urlByPath.get(norm(v.path));
        if (!url) continue;
        map.set(scanId, { url, exp });
        out.set(scanId, url);
      }
      void persist(map);
    }
  } catch (e) {
    logError('photo_urls', e);
    const now2 = Date.now();
    for (const id of missing) { const e = map.get(id); if (e && e.exp > now2) out.set(id, e.url); } // ещё живые (< 10 мин до истечения) — лучше, чем ничего; просроченные дадут 403
  }
  return out;
}

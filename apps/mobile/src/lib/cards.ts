// Чтение результата/карточек из lithos.* и фото из Storage (signed URL). Только anon-ключ + RLS.
import { ensureUser } from './auth';
import { type CardRow, parseCardRow, parseScanPhotoRow, parseScanResultRow, parseScanRow, type ScanResultRow, type ScanRow } from './card-types';
import { type DiaryRow, parseDiaryRow, parseExpectedRocks } from './diary';
import { logError, MSG, UserError } from './errors';
import { withRetry } from './retry';
import { PHOTO_BUCKET } from './scan-helpers';
import { supabase } from './supabase';

const SIGNED_URL_TTL_S = 60 * 60;

const CARD_COLUMNS =
  'id, scan_id, rock_class, tier, score, score_breakdown, inclusions, shape, lore, name, user_name, state, parent_card_id, verification, provisional, hidden, cell_id, lat, lng, created_at, updated_at';
const SCAN_COLUMNS = 'id, stage, error, parent_card_id, lat, lng, created_at, updated_at';

function fail(cause: unknown, message: string = MSG.loadFailed): never {
  throw new UserError(message, { cause });
}

export async function fetchScan(scanId: string): Promise<ScanRow | null> {
  return withRetry(async (signal) => {
    const r = await supabase.from('scans').select(SCAN_COLUMNS).eq('id', scanId).abortSignal(signal).maybeSingle();
    if (r.error) fail(r.error);
    return parseScanRow(r.data);
  }, { label: 'scans.get' });
}

export async function fetchCardByScan(scanId: string): Promise<CardRow | null> {
  return withRetry(async (signal) => {
    const r = await supabase.from('cards').select(CARD_COLUMNS).eq('scan_id', scanId).abortSignal(signal).maybeSingle();
    if (r.error) fail(r.error);
    return parseCardRow(r.data);
  }, { label: 'cards.byScan' });
}

export async function fetchCard(cardId: string): Promise<CardRow | null> {
  return withRetry(async (signal) => {
    const r = await supabase.from('cards').select(CARD_COLUMNS).eq('id', cardId).abortSignal(signal).maybeSingle();
    if (r.error) fail(r.error);
    return parseCardRow(r.data);
  }, { label: 'cards.get' });
}

/** Сырые ответы моделей по ступеням — «история версий» карточки. */
export async function fetchScanResults(scanId: string): Promise<ScanResultRow[]> {
  return withRetry(async (signal) => {
    const r = await supabase.from('scan_results').select('scan_id, stage, provider, model, raw_json, created_at').eq('scan_id', scanId).abortSignal(signal);
    if (r.error) fail(r.error);
    return (r.data ?? []).map(parseScanResultRow).filter((x): x is ScanResultRow => x !== null);
  }, { label: 'scan_results.list' });
}

export async function updateCardUserName(cardId: string, userName: string | null): Promise<void> {
  await withRetry(async (signal) => {
    const r = await supabase.from('cards').update({ user_name: userName }).eq('id', cardId).abortSignal(signal);
    if (r.error) fail(r.error, MSG.saveFailed);
  }, { label: 'cards.rename' });
}

export interface CardPhoto {
  path: string;
  url: string;
  isPrimary: boolean;
}

/** Фото скана по signed URL (бакет приватный, политика select — своя папка). Лицевая — is_primary, первой. */
export async function fetchScanPhotos(scanId: string): Promise<CardPhoto[]> {
  const rows = await withRetry(async (signal) => {
    const r = await supabase.from('scan_photos').select('storage_path, is_primary').eq('scan_id', scanId).order('storage_path').abortSignal(signal);
    if (r.error) fail(r.error);
    return (r.data ?? []).map(parseScanPhotoRow).filter((p): p is NonNullable<typeof p> => p !== null);
  }, { label: 'scan_photos.list' });
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const signed = await withRetry(async () => {
    const r = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(sorted.map((p) => p.storage_path), SIGNED_URL_TTL_S);
    if (r.error) fail(r.error);
    return r.data ?? [];
  }, { label: 'storage.sign' });
  // Подпись сопоставляем по path (порядок ответа — не контракт); ведущий «/» нормализуем с обеих сторон.
  const norm = (path: string) => path.replace(/^\/+/, '');
  const byPath = new Map<string, string>();
  for (const s of signed) {
    if (s.error || !s.signedUrl || !s.path) continue;
    byPath.set(norm(s.path), s.signedUrl);
  }
  return sorted.flatMap((p) => {
    const url = byPath.get(norm(p.storage_path));
    return url ? [{ path: p.storage_path, url, isPrimary: p.is_primary }] : [];
  });
}

/** Геологический возраст региона из кэша Macrostrat (geo_cache.age_range, доступен на чтение). */
export async function fetchAgeRange(cellId: string | null): Promise<string | null> {
  if (!cellId) return null;
  try {
    return await withRetry(async (signal) => {
      const r = await supabase.from('geo_cache').select('age_range').eq('cell_id', cellId).abortSignal(signal).maybeSingle();
      if (r.error) fail(r.error);
      const age = (r.data as { age_range?: unknown } | null)?.age_range;
      return typeof age === 'string' && age.length > 0 ? age : null;
    }, { label: 'geo_cache.get' });
  } catch (e) {
    logError('geo_cache', e);
    return null; // возраст — необязательное поле, блок просто скрывается
  }
}

// ---------------------------------------------------------------------------
// Волна 3: дневник, ячейки, карточки в ячейке (T3.1 / T3.2).
// ---------------------------------------------------------------------------

const DIARY_COLUMNS = 'cell_id, expected, found, updated_at';

/** Все строки дневника пользователя (RLS: только свои) — для карты и подсветки закрытых ячеек. */
export async function listDiary(): Promise<DiaryRow[]> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('diary').select(DIARY_COLUMNS).limit(500).abortSignal(signal);
    if (r.error) fail(r.error);
    return (r.data ?? []).map(parseDiaryRow).filter((d): d is DiaryRow => d !== null);
  }, { label: 'diary.list' });
}

export async function fetchDiaryCell(cellId: string): Promise<DiaryRow | null> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('diary').select(DIARY_COLUMNS).eq('cell_id', cellId).abortSignal(signal).maybeSingle();
    if (r.error) fail(r.error);
    return parseDiaryRow(r.data);
  }, { label: 'diary.get' });
}

/** Ожидаемые породы ячейки из кэша Macrostrat (geo_cache.expected_rocks) — когда дневника ещё нет. Нет строки → []. */
export async function fetchExpectedRocks(cellId: string): Promise<string[]> {
  return withRetry(async (signal) => {
    const r = await supabase.from('geo_cache').select('expected_rocks').eq('cell_id', cellId).abortSignal(signal).maybeSingle();
    if (r.error) fail(r.error);
    return parseExpectedRocks((r.data as { expected_rocks?: unknown } | null)?.expected_rocks);
  }, { label: 'geo_cache.expected' });
}

/** Карточки пользователя в ячейке, включая скрытых родителей после раскола — для дневника это тоже находки. */
export async function listCardsInCell(cellId: string): Promise<CardRow[]> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('cards').select(CARD_COLUMNS).eq('cell_id', cellId).order('created_at', { ascending: false }).limit(200).abortSignal(signal);
    if (r.error) fail(r.error);
    return (r.data ?? []).map(parseCardRow).filter((c): c is CardRow => c !== null);
  }, { label: 'cards.inCell' });
}

/** Все карточки пользователя (и скрытые) — для дневника/статистики; коллекция фильтрует hidden сама. */
export async function listAllCards(): Promise<CardRow[]> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('cards').select(CARD_COLUMNS).order('created_at', { ascending: false }).limit(500).abortSignal(signal);
    if (r.error) fail(r.error);
    return (r.data ?? []).map(parseCardRow).filter((c): c is CardRow => c !== null);
  }, { label: 'cards.all' });
}

// Публичная витрина — сервер (T6.1, поток D; миграция 0007_public_showcase.sql).
// Стиль как в lib/cards.ts: withRetry, abortSignal, ошибки через UserError/MSG, без текста сервера.
// Координаты чужой находки клиенту не приходят — только cell_id; центр ячейки считаем сами (cellCenter).
import type { Tier } from '@lithos/shared';
import { isTier } from './card-types';
import { ensureUser } from './auth';
import { logError, MSG, UserError } from './errors';
import { cellCenter, type LatLng } from './geohash';
import { withRetry } from './retry';
import { PHOTO_BUCKET } from './scan-helpers';
import { supabase } from './supabase';

const SIGNED_URL_TTL_S = 60 * 60;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const PUBLIC_FIND_COLUMNS = 'id, rock_class, tier, score, lore, name, user_name, cell_id, created_at, published_at, author_name';

/** Тексты, которые сервер сам не присылает — только коды ошибок RPC (без сырого текста postgres, CLAUDE.md). */
const PUBLISH_MSG = {
  hidden: 'Эту карточку нельзя опубликовать — она скрыта после раскола.',
  pendingReview: 'Эту карточку нельзя опубликовать — она ждёт проверки.',
} as const;

function fail(cause: unknown, message: string = MSG.saveFailed): never {
  throw new UserError(message, { cause });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

/** Строка представления lithos.public_finds. lat/lng сюда сознательно не входят (T6.0 §2.1) — только center, посчитанный на клиенте. */
export interface PublicFindRow {
  id: string;
  rock_class: string;
  tier: Tier | null;
  score: number | null;
  lore: string | null;
  name: string | null;
  user_name: string | null;
  cell_id: string | null;
  created_at: string;
  published_at: string | null;
  /** «Без имени», если владелец не задал display_name — решает экран (T6.0 §2.1), здесь — как есть (null). */
  author_name: string | null;
  /** Центр ячейки geohash-6 (~1,2 км) — единственная гео-подсказка, которую видят другие пользователи. */
  center: LatLng | null;
}

export function parsePublicFindRow(raw: unknown): PublicFindRow | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const rock_class = str(raw.rock_class);
  if (!id || !rock_class) return null;
  const cell_id = str(raw.cell_id);
  return {
    id,
    rock_class,
    tier: isTier(raw.tier) ? raw.tier : null,
    score: num(raw.score),
    lore: str(raw.lore),
    name: str(raw.name),
    user_name: str(raw.user_name),
    cell_id,
    created_at: str(raw.created_at) ?? '',
    published_at: str(raw.published_at),
    author_name: str(raw.author_name),
    center: cell_id ? cellCenter(cell_id) : null,
  };
}

// ---------------------------------------------------------------------------
// Публикация / снятие (RPC lithos.publish_card) — владелец карточки.
// ---------------------------------------------------------------------------

export interface PublishStatus {
  published: boolean;
  publishedAt: string | null;
}

/** RPC на функцию, возвращающую единственную строку (не SETOF), приходит объектом; на всякий случай терпим и массив. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? row : null;
}

/** Публикует/снимает карточку с витрины. Запрещено для скрытых (раскол) и pending_review — сервер это тоже проверяет. */
export async function setPublished(cardId: string, published: boolean): Promise<PublishStatus> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.rpc('publish_card', { p_card_id: cardId, p_published: published }).abortSignal(signal);
    if (r.error) {
      const msg = r.error.message ?? '';
      if (msg.includes('card_hidden')) throw new UserError(PUBLISH_MSG.hidden, { cause: r.error, retryable: false });
      if (msg.includes('card_pending_review')) throw new UserError(PUBLISH_MSG.pendingReview, { cause: r.error, retryable: false });
      if (msg.includes('not found or not owned')) fail(r.error, MSG.loadFailed);
      fail(r.error);
    }
    const row = firstRow(r.data);
    return { published: bool(row?.published, published), publishedAt: str(row?.published_at ?? null) };
  }, { label: 'cards.publish' });
}

// ---------------------------------------------------------------------------
// Чтение чужих находок (view lithos.public_finds) — постранично, по ячейке.
// ---------------------------------------------------------------------------

export interface ListPublicFindsParams {
  /** Ограничить одной ячейкой (geohash-6) — дневник места, «здесь находили другие». */
  cellId?: string;
  limit?: number;
  /** Из nextCursor предыдущей страницы; для первой страницы не передавать. */
  cursor?: string | null;
}

export interface PublicFindsPage {
  items: PublicFindRow[];
  nextCursor: string | null;
}

function encodeCursor(row: PublicFindRow): string {
  return `${row.published_at ?? ''}|${row.id}`;
}

/** uuid и timestamptz в том виде, в каком их отдаёт PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+(?:[+-][0-9:]+|Z)?$/;

/**
 * Курсор подставляется в фильтр `.or(...)`, где запятая и скобки — синтаксис PostgREST. Свой курсор таким
 * не бывает, но чужой или испорченный сломал бы запрос, поэтому обе части проверяются по форме и всё
 * непохожее считается «курсора нет» — страница просто начнётся сначала, а не упадёт ошибкой.
 */
export function decodeCursor(cursor: string): { publishedAt: string; id: string } | null {
  const i = cursor.indexOf('|');
  if (i < 0) return null;
  const publishedAt = cursor.slice(0, i);
  const id = cursor.slice(i + 1);
  if (!TIMESTAMP_RE.test(publishedAt) || !UUID_RE.test(id)) return null;
  return { publishedAt, id };
}

/** Постранично, новые публикации сверху (published_at desc, id — устойчивый тай-брейк). Пусто — «пока никто не публиковал». */
export async function listPublicFinds(params: ListPublicFindsParams = {}): Promise<PublicFindsPage> {
  await ensureUser();
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return withRetry(async (signal) => {
    let q = supabase
      .from('public_finds')
      .select(PUBLIC_FIND_COLUMNS)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (params.cellId) q = q.eq('cell_id', params.cellId);
    const decoded = params.cursor ? decodeCursor(params.cursor) : null;
    if (decoded) q = q.or(`published_at.lt.${decoded.publishedAt},and(published_at.eq.${decoded.publishedAt},id.lt.${decoded.id})`);
    const r = await q;
    if (r.error) fail(r.error, MSG.loadFailed);
    const items = (r.data ?? []).map(parsePublicFindRow).filter((x): x is PublicFindRow => x !== null);
    const last = items.at(-1);
    return { items, nextCursor: items.length === limit && last ? encodeCursor(last) : null };
  }, { label: 'public_finds.list' });
}

// ---------------------------------------------------------------------------
// Лицевое фото опубликованной карточки: RPC отдаёт путь, Storage подписывает (RLS storage.objects, 0007).
// ---------------------------------------------------------------------------

/** null — карточка больше не опубликована/скрыта, или у неё нет фото. Не бросает при «нет доступа». */
export async function fetchPublicPhotoUrl(cardId: string): Promise<string | null> {
  await ensureUser();
  try {
    const path = await withRetry(async (signal) => {
      const r = await supabase.rpc('public_photo_path', { p_card_id: cardId }).abortSignal(signal);
      if (r.error) fail(r.error, MSG.loadFailed);
      return typeof r.data === 'string' && r.data.length > 0 ? r.data : null;
    }, { label: 'public_photo_path' });
    if (!path) return null;
    return await withRetry(async () => {
      const r = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S);
      if (r.error) fail(r.error, MSG.loadFailed);
      return r.data?.signedUrl ?? null;
    }, { label: 'storage.signPublic' });
  } catch (e) {
    logError('publish.photo', e);
    return null; // сетка чужих находок показывает заглушку, а не ошибку
  }
}

// ---------------------------------------------------------------------------
// Жалоба (RPC lithos.report_card) — на чужую опубликованную находку.
// ---------------------------------------------------------------------------

export type ReportResult = 'reported' | 'already_reported';

export const REPORT_REASON_MAX = 500;

/** Обрезка/пустая строка → null (совпадает с проверкой в lithos.report_card, чтобы не полагаться только на сервер). */
export function normalizeReportReason(reason?: string | null): string | null {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, REPORT_REASON_MAX) : null;
}

/** До 500 символов (consent-copy.md §7); пустая/undefined причина — без текста. Повторная жалоба — не ошибка. */
export async function reportCard(cardId: string, reason?: string | null): Promise<ReportResult> {
  await ensureUser();
  const p_reason = normalizeReportReason(reason);
  return withRetry(async (signal) => {
    const r = await supabase.rpc('report_card', { p_card_id: cardId, p_reason }).abortSignal(signal);
    if (r.error) {
      if ((r.error.message ?? '').includes('card_not_public')) fail(r.error, MSG.loadFailed);
      fail(r.error);
    }
    return r.data === 'already_reported' ? 'already_reported' : 'reported';
  }, { label: 'cards.report' });
}

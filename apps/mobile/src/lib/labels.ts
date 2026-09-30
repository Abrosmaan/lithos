// Метки пород (T7.1, потоки A и B) — тонкий слой поверх lithos.record_label (0013_labels.sql) и
// lithos.list_my_labels (0015_my_label.sql, чтение собственной метки).
// Заготовка данных под будущую свою модель: обучения нет, копим только подтверждённые метки.
// Стиль как lib/publish.ts: withRetry, abortSignal, UserError/MSG, русские тексты, без текста сервера.
// Кнопки «подтвердить»/«исправить» — на CardScreen (поток B), этот файл только сеть и чистый разбор.
import { ROCK_CLASSES, type RockClass } from '@lithos/shared';
import type { CardVerification } from './card-types';
import { ensureUser } from './auth';
import { MSG, UserError } from './errors';
import { withRetry } from './retry';
import { supabase } from './supabase';

/** expert/golden зарезервированы в БД под будущие потоки — lithos.record_label их не принимает (см. 0013). */
export const LABEL_SOURCES = ['user_confirm', 'user_correct'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

export function isLabelSource(v: unknown): v is LabelSource {
  return typeof v === 'string' && (LABEL_SOURCES as readonly string[]).includes(v);
}

/** Тексты по кодам ошибок RPC record_label (без сырого текста postgres, CLAUDE.md). */
const LABEL_MSG = {
  cardNotReady: 'Карточка ещё не готова — попробуйте чуть позже.',
  cardHidden: 'Эту карточку нельзя отметить — она скрыта после раскола.',
  cardPendingReview: 'Эту карточку нельзя отметить — она ждёт проверки.',
  // Справочник пород в базе (миграция 0014) может отставать от вердикта воркера: порода из карточки
  // существует, а в справочнике её ещё нет. Тогда кнопка «Подтвердить» упирается именно сюда, и общее
  // «не удалось сохранить» ничего человеку не объясняет.
  unknownRockClass: 'Эту породу пока нельзя отметить — она не в справочнике. Мы её добавим.',
} as const;

const CARD_VERIFICATIONS: readonly CardVerification[] = ['ai', 'community', 'expert', 'pending_review'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

/** RPC на функцию, возвращающую одну строку (SETOF из RETURNS TABLE), приходит массивом; на всякий случай терпим и объект. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? row : null;
}

export interface LabelResult {
  id: string;
  /** true — rock_class метки совпал с вердиктом карточки на момент записи (lithos.labels.matched_model). */
  matchedModel: boolean;
  /**
   * Статус проверки карточки ПОСЛЕ вызова. Меняется сервером только для 'user_confirm' (ai → community);
   * для 'user_correct' — тот же verification, что был до вызова (сервер вердикт не подменяет, T7.1 §1).
   */
  verification: CardVerification;
}

/** Пустая/повреждённая строка ответа RPC → null, а не мусорный объект. */
export function parseLabelResult(raw: unknown): LabelResult | null {
  const row = firstRow(raw);
  const id = row ? str(row.id) : null;
  if (!id) return null;
  const verificationRaw = row!.verification;
  const verification = (CARD_VERIFICATIONS as readonly string[]).includes(verificationRaw as string)
    ? (verificationRaw as CardVerification)
    : 'ai';
  return { id, matchedModel: bool(row!.matched_model), verification };
}

function fail(cause: unknown, message: string = MSG.saveFailed): never {
  throw new UserError(message, { cause });
}

/**
 * Подтверждает или исправляет вердикт скана. rockClass — порода из справочника (packages/shared ROCK_CLASSES),
 * не свободный текст; на сервере хранится строкой, как lithos.cards.rock_class.
 *
 * 'user_confirm' переводит cards.verification из 'ai' в 'community' (делает сервер, RPC record_label).
 * 'user_correct' вердикт карточки не меняет — только сохраняет метку с происхождением; решение, что показать
 * пользователю и нужно ли отправлять скан на переанализ (очередь scan_dispute), — за экраном (поток B).
 *
 * Повторный вызов с тем же scanId/source от того же пользователя не создаёт дубль — перезаписывает свою же
 * метку (unique(scan_id, source, author_id) в 0013, upsert в record_label).
 */
export async function recordLabel(scanId: string, source: LabelSource, rockClass: RockClass): Promise<LabelResult> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase
      .rpc('record_label', { p_scan_id: scanId, p_source: source, p_rock_class: rockClass })
      .abortSignal(signal);
    if (r.error) {
      const msg = r.error.message ?? '';
      if (msg.includes('card_hidden')) throw new UserError(LABEL_MSG.cardHidden, { cause: r.error, retryable: false });
      if (msg.includes('card_pending_review')) throw new UserError(LABEL_MSG.cardPendingReview, { cause: r.error, retryable: false });
      if (msg.includes('card_not_ready')) throw new UserError(LABEL_MSG.cardNotReady, { cause: r.error, retryable: false });
      if (msg.includes('unknown_rock_class')) throw new UserError(LABEL_MSG.unknownRockClass, { cause: r.error, retryable: false });
      if (msg.includes('not found or not owned')) fail(r.error, MSG.loadFailed);
      fail(r.error);
    }
    const result = parseLabelResult(r.data);
    if (!result) fail(r.error, MSG.saveFailed);
    return result;
  }, { label: 'labels.record' });
}

// ---------------------------------------------------------------------------
// Чтение собственной метки (поток B) — lithos.list_my_labels (0015). Нужно, чтобы после перезапуска
// приложения карточка показывала «вы подтвердили»/«вы указали другую породу», не только сразу после нажатия.
// ---------------------------------------------------------------------------

export interface MyLabelRow {
  source: LabelSource;
  rockClass: RockClass;
  matchedModel: boolean;
  createdAt: string;
}

/** Строка ответа RPC → MyLabelRow; source вне (user_confirm|user_correct) или rock_class вне справочника — строка отбрасывается, не мусорится в UI. */
export function parseMyLabelRow(raw: unknown): MyLabelRow | null {
  if (!isRecord(raw)) return null;
  const source = raw.source;
  const rockClass = raw.rock_class;
  if (!isLabelSource(source)) return null;
  if (typeof rockClass !== 'string' || !(ROCK_CLASSES as readonly string[]).includes(rockClass)) return null;
  const createdAt = str(raw.created_at);
  if (!createdAt) return null;
  return { source, rockClass: rockClass as RockClass, matchedModel: bool(raw.matched_model), createdAt };
}

export function parseMyLabelRows(raw: unknown): MyLabelRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const parsed = parseMyLabelRow(row);
    return parsed ? [parsed] : [];
  });
}

/** Метка, которая отражает текущий выбор человека, когда есть и подтверждение, и исправление — последняя по времени. */
export function latestLabel(rows: MyLabelRow[]): MyLabelRow | null {
  return rows.reduce<MyLabelRow | null>((best, r) => (!best || r.createdAt > best.createdAt ? r : best), null);
}

/**
 * Собственные метки по скану — 0, 1 или 2 строки (не больше одной на источник, unique в 0013). Не бросает
 * на сетевой ошибке в UI-текст сама — вызывающий код (CardScreen) решает, критично ли это для экрана
 * (карточка показывается и без своей метки, поэтому load() глушит ошибку этого вызова, как fetchScanPhotos).
 */
export async function fetchMyLabels(scanId: string): Promise<MyLabelRow[]> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.rpc('list_my_labels', { p_scan_id: scanId }).abortSignal(signal);
    if (r.error) fail(r.error, MSG.loadFailed);
    return parseMyLabelRows(r.data);
  }, { label: 'labels.list_mine' });
}

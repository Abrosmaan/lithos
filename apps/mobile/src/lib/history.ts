// История версий карточки из lithos.scan_results (main → escalation) и итоговая рекомендация раскола.
// Чистый модуль: raw_json читается через ScanResultSchema из shared; при невалидном ответе — мягко.
import { finalSplitRecommendation, type ScanResult, ScanResultSchema, type ScanStage } from '@lithos/shared';
import type { ScanResultRow } from './card-types';
import { rockClassRu } from './card-facts';

export interface VersionEntry {
  stage: ScanStage;
  title: string;
  rockClass: string | null;
  rockClassRu: string | null;
  note: string | null;
  provider: string | null;
  model: string | null;
  /** raw_json.meta.used_fallback (воркер T2.1) — ответ резервного провайдера. */
  usedFallback: boolean;
  createdAt: string;
}

/** Порядок ступеней в истории: сначала первичное определение, потом уточнение. */
const HISTORY_ORDER: ScanStage[] = ['main', 'escalation'];
const STAGE_TITLE: Partial<Record<ScanStage, string>> = { main: 'Первичное определение', escalation: 'Уточнение' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Воркер пишет raw_json ступеней с моделью как { result, meta: { used_fallback, … } } (T2.1);
 * допускаем и «голый» ScanResult. Возвращает сам результат (ещё не проверенный схемой).
 */
export function unwrapRaw(raw: unknown): unknown {
  return isRecord(raw) && 'result' in raw && isRecord(raw.meta) ? raw.result : raw;
}

export function usedFallback(raw: unknown): boolean {
  return isRecord(raw) && isRecord(raw.meta) && raw.meta.used_fallback === true;
}

/** Ответ модели из raw_json — строго по схеме, иначе null. */
export function parseModelResult(raw: unknown): ScanResult | null {
  const r = ScanResultSchema.safeParse(unwrapRaw(raw));
  return r.success ? r.data : null;
}

function looseRockClass(raw: unknown): string | null {
  if (!isRecord(raw) || !isRecord(raw.rock_class)) return null;
  return typeof raw.rock_class.primary === 'string' ? raw.rock_class.primary : null;
}
function looseNote(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.revision_note === 'string' && raw.revision_note.length > 0 ? raw.revision_note : null;
}

export function versionHistory(rows: ScanResultRow[]): VersionEntry[] {
  return HISTORY_ORDER.flatMap((stage) => {
    const row = rows.find((r) => r.stage === stage);
    if (!row) return [];
    const inner = unwrapRaw(row.raw_json);
    const parsed = parseModelResult(row.raw_json);
    const rockClass = parsed?.rock_class.primary ?? looseRockClass(inner);
    return [{
      stage,
      title: STAGE_TITLE[stage] ?? stage,
      rockClass,
      rockClassRu: rockClass ? rockClassRu(rockClass) : null,
      note: parsed?.revision_note ?? looseNote(inner),
      provider: row.provider,
      model: row.model,
      usedFallback: usedFallback(row.raw_json),
      createdAt: row.created_at,
    }];
  });
}

/**
 * Рекомендован ли раскол: по последнему вердикту (escalation → main) через finalSplitRecommendation
 * (модель И правила); если raw_json не по схеме — поле модели split_recommendation.recommended.
 */
export function splitRecommended(rows: ScanResultRow[]): boolean {
  const row = rows.find((r) => r.stage === 'escalation') ?? rows.find((r) => r.stage === 'main');
  if (!row) return false;
  const parsed = parseModelResult(row.raw_json);
  if (parsed) return finalSplitRecommendation(parsed);
  const raw = unwrapRaw(row.raw_json);
  return isRecord(raw) && isRecord(raw.split_recommendation) && raw.split_recommendation.recommended === true;
}

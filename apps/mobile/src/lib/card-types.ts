// Строки таблиц lithos.scans / cards / scan_results / scan_photos, как их видит клиент (миграция 0001),
// и безопасный разбор jsonb-полей. Контракт с воркером T2.1 — docs/tasks/T2.2.md.
import type { Inclusion, ScanStage, ScoreBreakdown, Tier } from '@lithos/shared';
import { SCAN_STAGES, TIERS } from '@lithos/shared';

/** Коды scans.error при stage='failed' (контракт T2.1). */
export const SCAN_ERROR_CODES = ['not_rock', 'blurry', 'dark', 'too_far', 'screen_photo', 'multiple_objects', 'photo_unavailable', 'parent_not_found', 'dlq'] as const;
export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];

export type CardState = 'closed' | 'opened';
export type CardVerification = 'ai' | 'community' | 'expert' | 'pending_review';

export interface ScanRow {
  id: string;
  stage: ScanStage;
  error: string | null;
  parent_card_id: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface CardRow {
  id: string;
  scan_id: string;
  rock_class: string;
  tier: Tier | null;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  /** Из score_breakdown.meta.split_recommendation.recommended (воркер T2.1); null — поля нет. */
  split_recommended: boolean | null;
  /** score_breakdown.split_delta = score − score родителя (раскол, T2.1); null — нет поля или нет score. */
  split_delta: number | null;
  inclusions: Inclusion[];
  shape: Record<string, unknown>;
  lore: string | null;
  name: string | null;
  user_name: string | null;
  state: CardState;
  parent_card_id: string | null;
  verification: CardVerification;
  provisional: boolean;
  hidden: boolean;
  cell_id: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScanResultRow {
  scan_id: string;
  stage: ScanStage;
  provider: string | null;
  model: string | null;
  raw_json: unknown;
  created_at: string;
}

export interface ScanPhotoRow {
  storage_path: string;
  is_primary: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

export function isScanStage(v: unknown): v is ScanStage {
  return typeof v === 'string' && (SCAN_STAGES as readonly string[]).includes(v);
}
export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}
export function isScanErrorCode(v: unknown): v is ScanErrorCode {
  return typeof v === 'string' && (SCAN_ERROR_CODES as readonly string[]).includes(v);
}

export function parseScanRow(raw: unknown): ScanRow | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    stage: isScanStage(raw.stage) ? raw.stage : 'preflight',
    error: str(raw.error),
    parent_card_id: str(raw.parent_card_id),
    lat: num(raw.lat),
    lng: num(raw.lng),
    created_at: str(raw.created_at) ?? '',
    updated_at: str(raw.updated_at) ?? '',
  };
}

/** Структурная проверка breakdown (ScoreBreakdown из shared) — без zod, только форма четырёх слоёв. */
export function parseBreakdown(raw: unknown): ScoreBreakdown | null {
  if (!isRecord(raw)) return null;
  const { shape, place, composition, quality } = raw;
  if (!isRecord(shape) || !isRecord(place) || !isRecord(composition) || !isRecord(quality)) return null;
  if (num(shape.points) === null || num(place.points) === null || num(composition.points) === null || num(quality.points) === null) return null;
  if (!isRecord(composition.base)) return null;
  const inclusions = Array.isArray(composition.inclusions) ? composition.inclusions.filter(isRecord) : [];
  return {
    shape: { points: num(shape.points) ?? 0, reason: (str(shape.reason) ?? 'plain') as ScoreBreakdown['shape']['reason'] },
    place: {
      points: num(place.points) ?? 0,
      reason: (str(place.reason) ?? 'no_geo') as ScoreBreakdown['place']['reason'],
      mechanism: (str(place.mechanism) ?? null) as ScoreBreakdown['place']['mechanism'],
    },
    composition: {
      points: num(composition.points) ?? 0,
      base: {
        points: num(composition.base.points) ?? 0,
        reason: (str(composition.base.reason) ?? 'no_geo') as ScoreBreakdown['composition']['base']['reason'],
        share: num(composition.base.share),
      },
      inclusions: inclusions.map((i) => ({
        mineral: str(i.mineral) ?? 'quartz',
        extent: str(i.extent) ?? 'traces',
        base: num(i.base) ?? 0,
        multiplier: num(i.multiplier) ?? 1,
        points: num(i.points) ?? 0,
      })) as ScoreBreakdown['composition']['inclusions'],
      raw: num(composition.raw) ?? num(composition.points) ?? 0,
      capped: bool(composition.capped),
    },
    quality: {
      points: num(quality.points) ?? 0,
      fresh_split: bool(quality.fresh_split),
      scale_photo: bool(quality.scale_photo),
      user_tests: bool(quality.user_tests),
    },
  };
}

/** Рекомендация раскола, если воркер положил её в breakdown.meta (иначе — из scan_results, см. history.ts). */
export function parseSplitRecommended(breakdownRaw: unknown): boolean | null {
  if (!isRecord(breakdownRaw) || !isRecord(breakdownRaw.meta) || !isRecord(breakdownRaw.meta.split_recommendation)) return null;
  const v = breakdownRaw.meta.split_recommendation.recommended;
  return typeof v === 'boolean' ? v : null;
}

export function parseInclusions(raw: unknown): Inclusion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((i) => {
    const mineral = str(i.mineral);
    if (!mineral) return [];
    return [{
      mineral: mineral as Inclusion['mineral'],
      confidence: num(i.confidence) ?? 0,
      extent: (str(i.extent) ?? 'traces') as Inclusion['extent'],
      location: str(i.location),
      evidence: str(i.evidence) ?? '',
    }];
  });
}

export function parseCardRow(raw: unknown): CardRow | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const scan_id = str(raw.scan_id);
  const rock_class = str(raw.rock_class);
  if (!id || !scan_id || !rock_class) return null;
  return {
    id,
    scan_id,
    rock_class,
    tier: isTier(raw.tier) ? raw.tier : null,
    score: num(raw.score),
    score_breakdown: parseBreakdown(raw.score_breakdown),
    split_recommended: parseSplitRecommended(raw.score_breakdown),
    split_delta: isRecord(raw.score_breakdown) ? num(raw.score_breakdown.split_delta) : null,
    inclusions: parseInclusions(raw.inclusions),
    shape: isRecord(raw.shape) ? raw.shape : {},
    lore: str(raw.lore),
    name: str(raw.name),
    user_name: str(raw.user_name),
    state: raw.state === 'opened' ? 'opened' : 'closed',
    parent_card_id: str(raw.parent_card_id),
    verification: (['ai', 'community', 'expert', 'pending_review'] as const).find((v) => v === raw.verification) ?? 'ai',
    provisional: bool(raw.provisional),
    hidden: bool(raw.hidden),
    cell_id: str(raw.cell_id),
    lat: num(raw.lat),
    lng: num(raw.lng),
    created_at: str(raw.created_at) ?? '',
    updated_at: str(raw.updated_at) ?? '',
  };
}

export function parseScanResultRow(raw: unknown): ScanResultRow | null {
  if (!isRecord(raw)) return null;
  const scan_id = str(raw.scan_id);
  if (!scan_id || !isScanStage(raw.stage)) return null;
  return { scan_id, stage: raw.stage, provider: str(raw.provider), model: str(raw.model), raw_json: raw.raw_json, created_at: str(raw.created_at) ?? '' };
}

export function parseScanPhotoRow(raw: unknown): ScanPhotoRow | null {
  if (!isRecord(raw)) return null;
  const storage_path = str(raw.storage_path);
  return storage_path ? { storage_path, is_primary: bool(raw.is_primary) } : null;
}

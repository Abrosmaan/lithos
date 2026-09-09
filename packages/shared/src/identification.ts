// Определение породы как список кандидатов с вероятностями (UX в духе iNaturalist).
// Источник — калиброванные confidence модели (primary + alternatives). Это ВЕРОЯТНОСТЬ ОПРЕДЕЛЕНИЯ,
// не проценты состава (spec §11 «никогда: проценты состава по фото»). Score считается порогами
// в score.ts и от этих чисел не зависит — одинаковый камень при пересъёмке получает тот же тир,
// даже если проценты немного «плавают».
import { ROCK_CLASS_RU, type RockClass } from './enums.js';
import type { ScanResult } from './scan-result.js';

/** Границы уверенности для формулировки заголовка (оформление, не баланс). */
export const IDENTIFICATION_BANDS = {
  sure: 0.8,    // ≥ 0.8 — «Уверены: это …»
  likely: 0.6,  // ≥ 0.6 — «Скорее всего …»; ниже — «Похоже на … (не уверены)»
} as const;
export type IdentificationBand = 'sure' | 'likely' | 'unsure';

/** Шаг округления процентов на экране — чтобы список не «дрожал» между пересъёмками. */
export const IDENTIFICATION_PERCENT_STEP = 5;
/** Кандидаты ниже этой доли схлопываются в «другое». */
export const IDENTIFICATION_MIN_PERCENT = 5;
export const IDENTIFICATION_MAX_CANDIDATES = 5;

export interface IdentificationCandidate {
  rock_class: RockClass | 'other';
  name_ru: string;
  /** Целое число процентов, кратное IDENTIFICATION_PERCENT_STEP; сумма списка = 100. */
  percent: number;
  is_primary: boolean;
  reason: string | null;
}

export interface Identification {
  band: IdentificationBand;
  primary: RockClass;
  candidates: IdentificationCandidate[];
}

export function identificationBand(confidence: number): IdentificationBand {
  if (confidence >= IDENTIFICATION_BANDS.sure) return 'sure';
  if (confidence >= IDENTIFICATION_BANDS.likely) return 'likely';
  return 'unsure';
}

function roundStep(x: number, step: number): number {
  return Math.round(x / step) * step;
}

/**
 * Превращает primary + alternatives в ранжированный список с процентами.
 * Правила (детерминированные): дубликаты primary в alternatives отбрасываются; веса нормализуются к 100;
 * округление до шага 5; кандидаты < 5 % и всё, что не вошло, — строка «другое»; сумма всегда 100;
 * primary всегда первый, даже если после округления сравнялся со вторым.
 */
export function identificationCandidates(result: ScanResult): Identification {
  const primary = result.rock_class.primary;
  const seen = new Set<RockClass>([primary]);
  const raw: { rock_class: RockClass; w: number; reason: string | null; is_primary: boolean }[] = [
    { rock_class: primary, w: Math.max(result.rock_class.confidence, 0.01), reason: null, is_primary: true },
  ];
  for (const a of result.rock_class.alternatives) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    raw.push({ rock_class: a.name, w: Math.max(a.confidence, 0), reason: a.reason ?? null, is_primary: false });
    if (raw.length >= IDENTIFICATION_MAX_CANDIDATES) break;
  }
  // primary первый, остальные по убыванию веса, при равенстве — по алфавиту (стабильно).
  const rest = raw.slice(1).sort((x, y) => y.w - x.w || x.rock_class.localeCompare(y.rock_class));
  const ordered = [raw[0]!, ...rest];
  const total = ordered.reduce((s, c) => s + c.w, 0);
  // Если модель дала суммарно < 1, остаток — «другое»; если > 1 — нормализуем.
  const denom = Math.max(total, 1);
  let candidates: IdentificationCandidate[] = ordered.map((c) => ({
    rock_class: c.rock_class,
    name_ru: ROCK_CLASS_RU[c.rock_class] ?? c.rock_class,
    percent: roundStep((c.w / denom) * 100, IDENTIFICATION_PERCENT_STEP),
    is_primary: c.is_primary,
    reason: c.reason,
  }));
  const kept = candidates.filter((c) => c.is_primary || c.percent >= IDENTIFICATION_MIN_PERCENT);
  const sum = kept.reduce((s, c) => s + c.percent, 0);
  if (sum < 100) {
    kept.push({ rock_class: 'other', name_ru: 'другое', percent: 100 - sum, is_primary: false, reason: null });
  } else if (sum > 100) {
    // Округление увело сумму вверх — снимаем с primary (он всегда крупнейший).
    kept[0]!.percent -= sum - 100;
  }
  candidates = kept;
  return { band: identificationBand(result.rock_class.confidence), primary, candidates };
}

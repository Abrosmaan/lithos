// Метрики golden set (ai-pipeline §2a, §9, §11 п.7). Чистые функции — без сети и файлов, тестируются на синтетике.
// Пороги — из @lithos/shared (INCLUSION_CONFIDENCE_THRESHOLD, CONFIDENT_ERROR_THRESHOLD), хардкода нет.
import {
  CONFIDENT_ERROR_THRESHOLD,
  INCLUSION_CONFIDENCE_THRESHOLD,
  type GateResult,
  type Mineral,
  type RockClass,
  type ScanResult,
} from '@lithos/shared';
import type { GoldenLabel } from './labels.js';

/**
 * Семейства минералов для precision включений: «слюда» ≈ мусковит ≈ биотит — эксперт и модель могут назвать
 * разный уровень детализации, для ловушки важно только, что это не пирит. Не балансовое число — эквивалентность разметки.
 */
export const MINERAL_FAMILY: Partial<Record<Mineral, Mineral>> = {
  muscovite: 'mica',
  biotite: 'mica',
  plagioclase: 'feldspar',
  orthoclase: 'feldspar',
  hornblende: 'amphibole',
  augite: 'pyroxene',
  goethite: 'limonite',
  quartz_druse: 'quartz',
};

export function mineralFamily(m: Mineral): Mineral {
  return MINERAL_FAMILY[m] ?? m;
}

/**
 * Очевидные разновидности → порода (симметрично): модель, назвавшая базальт миндалекаменным, не ошиблась.
 * Локальный список eval, не ROCK_CLASS_BASE из shared: там есть и рёбра для score (chert → limestone), которые для
 * точности определения — ошибка. Кремень/кремнистая порода/известняк разводятся через acceptable_alternatives в манифесте.
 */
export const VARIETY_BASE: Partial<Record<RockClass, RockClass>> = {
  amygdaloidal_basalt: 'basalt',
  vesicular_basalt: 'basalt',
  fossiliferous_limestone: 'limestone',
  coquina: 'limestone',
  ignimbrite: 'tuff',
  greywacke: 'sandstone',
};

export function baseClass(c: RockClass): RockClass {
  return VARIETY_BASE[c] ?? c;
}

/** Совпадение с точностью до разновидности: равны или сводятся к одной породе. */
export function classMatches(pred: RockClass, truth: RockClass): boolean {
  return pred === truth || baseClass(pred) === baseClass(truth);
}

/** Ответ «не порода»: unknown / unknown_igneous / unknown_sedimentary / unknown_metamorphic. */
export function isUnknownClass(c: RockClass): boolean {
  return c === 'unknown' || c.startsWith('unknown_');
}

/** Не-камень (бетон, стекло) назван породой уверенно — отдельная строка отчёта, в top-1 не входит. */
export function namedNonRockConfidently(result: ScanResult, label: Pick<GoldenLabel, 'is_rock'>): boolean {
  return !label.is_rock && !isUnknownClass(result.rock_class.primary) && result.rock_class.confidence >= CONFIDENT_ERROR_THRESHOLD;
}

/** Ответ засчитывается, если совпадает с rock_class или с одной из acceptable_alternatives разметки. */
export function isAcceptable(pred: RockClass, label: Pick<GoldenLabel, 'rock_class' | 'acceptable_alternatives'>): boolean {
  return classMatches(pred, label.rock_class) || label.acceptable_alternatives.some((a) => classMatches(pred, a));
}

export function top1Correct(result: ScanResult, label: GoldenLabel): boolean {
  return isAcceptable(result.rock_class.primary, label);
}

/** Top-2: primary или самая уверенная альтернатива модели. */
export function top2Correct(result: ScanResult, label: GoldenLabel): boolean {
  if (top1Correct(result, label)) return true;
  const best = [...result.rock_class.alternatives].sort((a, b) => b.confidence - a.confidence)[0];
  return best ? isAcceptable(best.name, label) : false;
}

/** Уверенная ошибка (ai-pipeline §2a): confidence ≥ порога и top-1 неверен. Самая важная метрика (§9). */
export function isConfidentError(result: ScanResult, label: GoldenLabel): boolean {
  return result.rock_class.confidence >= CONFIDENT_ERROR_THRESHOLD && !top1Correct(result, label);
}

/**
 * Калибровка распределения (main-v2): сумма primary.confidence + Σ alternatives.confidence должна быть ≈ 1
 * (остаток — «ни один из них»). Окно — допуск eval, не балансовое число: ниже 0.85 модель «недораздала» массу,
 * выше 1.05 — дала нескольким кандидатам по 0.9.
 */
export const CALIBRATION_SUM_RANGE = { min: 0.85, max: 1.05 } as const;

export function probabilitySum(result: ScanResult): number {
  return result.rock_class.confidence + result.rock_class.alternatives.reduce((s, a) => s + a.confidence, 0);
}

export function isCalibrated(result: ScanResult): boolean {
  const sum = probabilitySum(result);
  return sum >= CALIBRATION_SUM_RANGE.min && sum <= CALIBRATION_SUM_RANGE.max;
}

/**
 * Brier/NLL-lite: вероятность, которую модель отдала истинному классу — primary плюс альтернативы, совпадающие
 * с rock_class / acceptable_alternatives разметки (с точностью до разновидности). Обрезается до 1 (если модель
 * назвала истину дважды или сумма > 1). Ошибочный ответ без истины в списке — 0.
 */
export function truthProbability(result: ScanResult, label: Pick<GoldenLabel, 'rock_class' | 'acceptable_alternatives'>): number {
  let p = isAcceptable(result.rock_class.primary, label) ? result.rock_class.confidence : 0;
  for (const a of result.rock_class.alternatives) if (isAcceptable(a.name, label)) p += a.confidence;
  return Math.min(1, p);
}

export interface InclusionCounts {
  /** Предсказанные включения с confidence ≥ порога. */
  predicted: number;
  /** Из них подтверждённые разметкой (по семейству минерала). */
  truePositive: number;
  /** Размеченные включения всего. */
  labeled: number;
  /** Размеченные, которые модель нашла с confidence ≥ порога. */
  found: number;
}

/** Считаем по семействам минералов (Set): «muscovite» + «mica» у модели — одно предсказание, не два. */
export function inclusionCounts(result: ScanResult, label: GoldenLabel): InclusionCounts {
  const truth = new Set(label.inclusions.map((i) => mineralFamily(i.mineral)));
  const predicted = new Set(result.inclusions.filter((i) => i.confidence >= INCLUSION_CONFIDENCE_THRESHOLD).map((i) => mineralFamily(i.mineral)));
  const truePositive = [...predicted].filter((f) => truth.has(f)).length;
  return { predicted: predicted.size, truePositive, labeled: truth.size, found: truePositive };
}

/**
 * Проценты состава в тексте (чек-лист §11 п.7): «30%», «30 %», «процентов», «percent» / «per cent». \b не работает
 * с кириллицей — без него. Доли словами («half quartz», «треть») — не проценты, не ловим (T4.1: проверено на синтетике).
 */
export const PERCENT_RE = /\d\s?%|процент|per\s?cent/iu;

export function textFields(result: ScanResult): string[] {
  return [
    result.lore,
    result.split_recommendation.reason ?? '',
    result.revision_note ?? '',
    ...result.inclusions.map((i) => i.evidence),
    ...result.inclusions.map((i) => i.location ?? ''),
  ];
}

export function hasPercentages(result: ScanResult): boolean {
  return textFields(result).some((t) => PERCENT_RE.test(t));
}

/**
 * Ловушка пройдена: top-1 верен, порода-приманка не названа и минерал-приманка не заявлен с confidence ≥ порога.
 * Для не-ловушек — null.
 */
export function trapPassed(result: ScanResult, label: GoldenLabel): boolean | null {
  if (!label.trap) return null;
  if (!top1Correct(result, label)) return false;
  const decoy = label.decoy;
  if (!decoy) return true;
  if (decoy.rock_class && classMatches(result.rock_class.primary, decoy.rock_class)) return false;
  if (decoy.mineral) {
    const fam = mineralFamily(decoy.mineral);
    const claimed = result.inclusions.some((i) => i.confidence >= INCLUSION_CONFIDENCE_THRESHOLD && mineralFamily(i.mineral) === fam);
    if (claimed) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Агрегация по модели
// ---------------------------------------------------------------------------

export interface ItemOutcome {
  id: string;
  ok: boolean;
  costUsd: number;
  latencyMs: number;
  repaired: boolean;
  attempts: number;
}

export interface ScanOutcome extends ItemOutcome {
  stage: 'main' | 'escalation';
  top1: boolean;
  top2: boolean;
  confidentError: boolean;
  /** Сумма primary + alternatives (калибровка распределения). */
  probSum: number;
  calibrated: boolean;
  /** Вероятность, отданная истинному классу (0 — истины нет в списке). */
  truthProb: number;
  /** Число альтернатив в ответе. */
  alternatives: number;
  inclusions: InclusionCounts;
  percentages: boolean;
  trap: boolean | null;
  /** Escalation: primary изменился относительно prior. */
  changedPrimary: boolean | null;
  /** Группа для разбивки: тип геологии или 'trap'. */
  group: OutcomeGroup;
  /** Разметка: камень. Не-камни (бетон, стекло) в top-1/top-2/precision/уверенные ошибки не входят. */
  isRock: boolean;
  /** Не-камень уверенно назван породой (rock_class ≠ unknown*, confidence ≥ порога). */
  namedNonRock: boolean;
  /** Для списка уверенных ошибок в отчёте. */
  predicted: RockClass | null;
  confidence: number | null;
  expected: RockClass;
}

export interface GateOutcome extends ItemOutcome {
  stage: 'gate';
  isRockCorrect: boolean;
  qualityOk: boolean;
}

export type OutcomeGroup = GoldenLabel['geology_type'] | 'trap';
export type Outcome = ScanOutcome | GateOutcome;

export function outcomeGroup(label: Pick<GoldenLabel, 'geology_type' | 'trap'>): OutcomeGroup {
  return label.trap ? 'trap' : label.geology_type;
}

export function scanOutcome(
  result: ScanResult,
  label: GoldenLabel,
  meta: Omit<ItemOutcome, 'id' | 'ok'>,
  stage: 'main' | 'escalation',
  prior?: ScanResult,
): ScanOutcome {
  return {
    id: label.id,
    ok: true,
    stage,
    ...meta,
    top1: top1Correct(result, label),
    top2: top2Correct(result, label),
    confidentError: isConfidentError(result, label),
    probSum: probabilitySum(result),
    calibrated: isCalibrated(result),
    truthProb: truthProbability(result, label),
    alternatives: result.rock_class.alternatives.length,
    inclusions: inclusionCounts(result, label),
    percentages: hasPercentages(result),
    trap: trapPassed(result, label),
    changedPrimary: prior ? prior.rock_class.primary !== result.rock_class.primary : null,
    group: outcomeGroup(label),
    isRock: label.is_rock,
    namedNonRock: namedNonRockConfidently(result, label),
    predicted: result.rock_class.primary,
    confidence: result.rock_class.confidence,
    expected: label.rock_class,
  };
}

export function gateOutcome(result: GateResult, label: Pick<GoldenLabel, 'id' | 'is_rock'>, meta: Omit<ItemOutcome, 'id' | 'ok'>): GateOutcome {
  return { id: label.id, ok: true, stage: 'gate', ...meta, isRockCorrect: result.is_rock === label.is_rock, qualityOk: result.quality === 'ok' };
}

export function failedOutcome(id: string, stage: Outcome['stage'], meta: Omit<ItemOutcome, 'id' | 'ok'>, label: Pick<GoldenLabel, 'geology_type' | 'rock_class' | 'trap' | 'is_rock'>): Outcome {
  if (stage === 'gate') return { id, ok: false, stage, ...meta, isRockCorrect: false, qualityOk: false };
  return {
    id,
    ok: false,
    stage,
    ...meta,
    predicted: null,
    confidence: null,
    expected: label.rock_class,
    top1: false,
    top2: false,
    confidentError: false,
    probSum: 0,
    calibrated: false,
    truthProb: 0,
    alternatives: 0,
    inclusions: { predicted: 0, truePositive: 0, labeled: 0, found: 0 },
    percentages: false,
    trap: null,
    changedPrimary: null,
    group: outcomeGroup(label),
    isRock: label.is_rock,
    namedNonRock: false,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export interface CommonSummary {
  n: number;
  okCalls: number;
  failedCalls: number;
  repaired: number;
  costMeanUsd: number;
  costTotalUsd: number;
  latencyP50: number;
  latencyP95: number;
}

export interface ScanSummary extends CommonSummary {
  stage: 'main' | 'escalation';
  top1: number | null;
  top2: number | null;
  /** Доля уверенных ошибок среди успешных ответов. */
  confidentErrorRate: number | null;
  /** Доля ответов с суммой вероятностей в CALIBRATION_SUM_RANGE. */
  calibratedRate: number | null;
  /** Средняя вероятность истинного класса (Brier/NLL-lite; 1 — идеал). */
  truthProbMean: number | null;
  /** Среднее число альтернатив — цена калибровки в токенах. */
  alternativesMean: number | null;
  inclusionPrecision: number | null;
  inclusionRecall: number | null;
  /** Доля ответов с процентами состава. */
  percentagesRate: number | null;
  trapN: number;
  trapAccuracy: number | null;
  changedPrimaryRate: number | null;
  /** Top-1 по группам: типы геологии + 'trap' (только камни). */
  top1ByGroup: Partial<Record<OutcomeGroup, { n: number; top1: number | null }>>;
  /** Не-камни: сколько из них уверенно названы породой. */
  nonRock: { n: number; namedRock: number };
  /** id ответов с процентами состава (§11 п.7). */
  percentageIds: string[];
}

export interface GateSummary extends CommonSummary {
  stage: 'gate';
  isRockAccuracy: number | null;
  qualityOkRate: number | null;
}

function common(outcomes: Outcome[]): CommonSummary {
  const ok = outcomes.filter((o) => o.ok);
  const cost = ok.reduce((s, o) => s + o.costUsd, 0);
  const lat = ok.map((o) => o.latencyMs);
  return {
    n: outcomes.length,
    okCalls: ok.length,
    failedCalls: outcomes.length - ok.length,
    repaired: ok.filter((o) => o.repaired).length,
    costMeanUsd: ok.length ? cost / ok.length : 0,
    costTotalUsd: cost,
    latencyP50: percentile(lat, 50),
    latencyP95: percentile(lat, 95),
  };
}

export function summarizeScan(outcomes: ScanOutcome[]): ScanSummary {
  const okAll = outcomes.filter((o) => o.ok);
  // Точность породы считаем только по камням; не-камни — отдельной строкой.
  const ok = okAll.filter((o) => o.isRock);
  const nonRock = okAll.filter((o) => !o.isRock);
  const inc = ok.reduce(
    (s, o) => ({
      predicted: s.predicted + o.inclusions.predicted,
      truePositive: s.truePositive + o.inclusions.truePositive,
      labeled: s.labeled + o.inclusions.labeled,
      found: s.found + o.inclusions.found,
    }),
    { predicted: 0, truePositive: 0, labeled: 0, found: 0 },
  );
  // Ловушки — включая не-камни (бетон, стекло): их смысл именно в том, чтобы не назвать их породой.
  const traps = okAll.filter((o) => o.trap !== null);
  const changed = okAll.filter((o) => o.changedPrimary !== null);
  const top1ByGroup: ScanSummary['top1ByGroup'] = {};
  for (const o of ok) {
    const g = (top1ByGroup[o.group] ??= { n: 0, top1: null });
    g.n++;
  }
  for (const [k, g] of Object.entries(top1ByGroup)) {
    const hits = ok.filter((o) => o.group === k && o.top1).length;
    g.top1 = ratio(hits, g.n);
  }
  return {
    ...common(outcomes),
    stage: outcomes[0]?.stage ?? 'main',
    top1: ratio(ok.filter((o) => o.top1).length, ok.length),
    top2: ratio(ok.filter((o) => o.top2).length, ok.length),
    confidentErrorRate: ratio(ok.filter((o) => o.confidentError).length, ok.length),
    calibratedRate: ratio(ok.filter((o) => o.calibrated).length, ok.length),
    truthProbMean: ratio(ok.reduce((s, o) => s + o.truthProb, 0), ok.length),
    alternativesMean: ratio(ok.reduce((s, o) => s + o.alternatives, 0), ok.length),
    inclusionPrecision: ratio(inc.truePositive, inc.predicted),
    inclusionRecall: ratio(inc.found, inc.labeled),
    percentagesRate: ratio(okAll.filter((o) => o.percentages).length, okAll.length),
    trapN: traps.length,
    trapAccuracy: ratio(traps.filter((o) => o.trap === true).length, traps.length),
    changedPrimaryRate: ratio(changed.filter((o) => o.changedPrimary).length, changed.length),
    top1ByGroup,
    nonRock: { n: nonRock.length, namedRock: nonRock.filter((o) => o.namedNonRock).length },
    percentageIds: okAll.filter((o) => o.percentages).map((o) => o.id),
  };
}

export function summarizeGate(outcomes: GateOutcome[]): GateSummary {
  const ok = outcomes.filter((o) => o.ok);
  return {
    ...common(outcomes),
    stage: 'gate',
    isRockAccuracy: ratio(ok.filter((o) => o.isRockCorrect).length, ok.length),
    qualityOkRate: ratio(ok.filter((o) => o.qualityOk).length, ok.length),
  };
}

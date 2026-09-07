// Score и тиры — spec §6, §7; пороги конвейера — ai-pipeline §3, §7, §9.
// ЕДИНСТВЕННОЕ место с балансовыми числами. Хардкод чисел в воркере/клиенте — дефект (dev-plan §5.3).
// Принцип: модель даёт вердикт с вероятностью, игра даёт цифры. Ни один балл не берётся из confidence
// напрямую — только через дискретные пороги (spec §4.3, §6.5).
import type { Extent, Mineral, RockClass, ShapeTag, Surface, Tier, WandererMechanism } from './enums.js';
import { ROCK_CLASS_BASE, TIERS } from './enums.js';
import type { ExpectedRock, GeoContext, UserTests } from './geo.js';
import type { Inclusion, ScanResult } from './scan-result.js';

// ---------------------------------------------------------------------------
// Пороги, которые использует воркер (не влияют на баллы напрямую)
// ---------------------------------------------------------------------------

/** Включение засчитывается в score только при confidence ≥ порога (spec §6.3, ai-pipeline S4). */
export const INCLUSION_CONFIDENCE_THRESHOLD = 0.6;
/** Полоса неуверенности rock_class.confidence → эскалация на S3 (ai-pipeline §3 S3). */
export const ESCALATION_CONFIDENCE_BAND = [0.45, 0.65] as const;
/** «Уверенная ошибка» для eval/golden set: confidence ≥ порога и неверный ответ (ai-pipeline §2a, §9). */
export const CONFIDENT_ERROR_THRESHOLD = 0.8;
/** Максимальный тир через fallback-провайдер и при бюджетном отключении S3 (ai-pipeline §7). */
export const FALLBACK_MAX_TIER: Tier = 'rare';
/** rock_class вне enum → ближайший unknown_*, confidence умножается на этот коэффициент (ai-pipeline §7). */
export const OUT_OF_ENUM_CONFIDENCE_FACTOR = 0.5;

// ---------------------------------------------------------------------------
// Таблицы spec §6
// ---------------------------------------------------------------------------

export const MAX_SCORE = 100;

/** Тиры по порогам: score ≥ min → тир (spec §6). Порядок возрастающий. */
export const TIER_THRESHOLDS = [
  { tier: 'common', min: 0 },
  { tier: 'uncommon', min: 30 },
  { tier: 'rare', min: 50 },
  { tier: 'epic', min: 70 },
  { tier: 'legendary', min: 85 },
] as const satisfies ReadonlyArray<{ tier: Tier; min: number }>;

/** §6.1 Форма (0–25). Берётся максимум из подходящих строк. */
export const SHAPE_POINTS = {
  natural_hole: 20,      // сквозное естественное отверстие («куриный бог»)
  silhouette: 15,        // узнаваемый силуэт (сердце, полумесяц)
  banded: 10,            // полосчатость / рисунок на поверхности
  spheroid: 8,           // идеально окатанный сфероид / яйцо
  plain: 3,              // обычная галька
} as const;
export type ShapeReason = keyof typeof SHAPE_POINTS;
export const SHAPE_LAYER_MAX = 25;

/** §6.2 Соответствие месту (0–20). */
export const PLACE_POINTS = {
  match: 5,                    // совпадает с ожидаемым
  wanderer: 20,                // редко для региона + правдоподобный механизм → тег «Странник»
  mismatch_no_mechanism: 0,    // не совпадает, механизма нет → geo_anomaly, ревью
  mismatch_implausible: 0,     // механизм заявлен, но для этой зоны неправдоподобен → geo_anomaly
  unknown_class: 0,            // порода не определена — сравнивать не с чем
  no_geo: 0,                   // без гео — слой не считается, карточка без score (spec §4.1)
  ubiquitous: 5,               // расширение сверх spec §6.2, решение T1.1: повсеместные породы — как «совпадает»
} as const;
export const GEO_ANOMALY_REASONS: readonly PlaceReason[] = ['mismatch_no_mechanism', 'mismatch_implausible'];
/**
 * Вторичные / повсеместные породы, которых нет в литологии Macrostrat как самостоятельных юнитов.
 * Расширение сверх spec §6.2, решение T1.1: место = 5 (reason 'ubiquitous'), аномалия и странник не применяются;
 * база состава — бакет по share, если есть совпадение через ROCK_CLASS_BASE, иначе «редкая» 20.
 */
export const UBIQUITOUS_ROCK_CLASSES: readonly RockClass[] = [
  'agate', 'chalcedony', 'jasper', 'chert', 'flint', 'quartz_vein', 'geode', 'concretion', 'fossil', 'petrified_wood',
];
export const UBIQUITOUS_BASE_BUCKET: ShareBucket = 'rare';
export type PlaceReason = keyof typeof PLACE_POINTS;
export const PLACE_LAYER_MAX = 20;

/**
 * §6.3 Состав: бакет базовой породы по доле площади в водосборе. Проверяется сверху вниз.
 * Границы 0.5 / 0.15 / 0.03 — расширение сверх spec §6.3 (там только имена бакетов), решение T1.1.
 */
export const SHARE_BUCKETS = [
  { bucket: 'dominant', minShare: 0.5, points: 5 },
  { bucket: 'common', minShare: 0.15, points: 10 },
  { bucket: 'rare', minShare: 0.03, points: 20 },
  { bucket: 'singular', minShare: 0, points: 30 },   // < 0.03 или отсутствует в expected_rocks
] as const;
export type ShareBucket = (typeof SHARE_BUCKETS)[number]['bucket'];
export type BaseReason = ShareBucket | 'agate' | 'fossil' | 'unknown_class' | 'no_geo' | 'geo_anomaly';

/** §6.3 Фиксированные бонусы для классов, редких везде (заменяют бакет, не суммируются с ним). */
export const FIXED_BASE_POINTS = { agate: 30, fossil: 40 } as const;
/** Породы-окаменелости: база 40 вместо бакета. fossiliferous_limestone — обычная порода, база по бакету. */
export const FOSSIL_ROCK_CLASSES: readonly RockClass[] = ['fossil', 'petrified_wood'];
export const AGATE_ROCK_CLASSES: readonly RockClass[] = ['agate'];
/** Минерал-включение «окаменелость»: только баллы включения ×2, базу 40 не даёт. */
export const FOSSIL_MINERALS: readonly Mineral[] = ['fossil_fragment'];

/** §6.3 Включения по extent (каждое — только при confidence ≥ INCLUSION_CONFIDENCE_THRESHOLD). */
export const INCLUSION_EXTENT_POINTS = { traces: 3, noticeable: 7, dominant: 12 } as const satisfies Record<Extent, number>;
/** §6.3 Множители за «красивые» включения. Нет в таблице → ×1. */
export const INCLUSION_MULTIPLIERS: Readonly<Partial<Record<Mineral, number>>> = {
  zeolite: 1.5,          // миндалины с цеолитом
  quartz_druse: 1.5,     // кварцевая друза
  amethyst: 1.5,         // расширение сверх spec §6.3, решение T1.1: аметист трактуем как кварцевую друзу
  pyrite: 1.3,
  fossil_fragment: 2,
};
export const COMPOSITION_LAYER_MAX = 45;

/** §6.4 Раскрытие и качество (0–10). */
export const QUALITY_POINTS = {
  fresh_split: 6,   // свежий скол с видимым интерьером
  scale_photo: 2,   // есть фото с масштабом
  user_tests: 2,    // пользователь прошёл мини-тесты (вес и царапина)
} as const;
export const QUALITY_LAYER_MAX = 10;

/** §7 Раскол предлагается, если форма ≤ этого порога и нет засчитанных включений. */
export const SPLIT_SHAPE_MAX = 8;
/** Раскол не предлагается: ценность в целости (окаменелость, жеода, агат). */
export const NO_SPLIT_ROCK_CLASSES: readonly RockClass[] = ['fossil', 'petrified_wood', 'geode', 'agate'];
/** Раскол не предлагается: уже расколот или окатанная поверхность ценна сама по себе. */
export const NO_SPLIT_SURFACES: readonly Surface[] = ['fresh_split', 'polished'];

/** Редкие заявки, которые всегда проверяет S3 независимо от confidence (ai-pipeline §3 S3). */
export const RARE_CLAIM_MINERALS: readonly Mineral[] = ['fossil_fragment', 'quartz_druse', 'amethyst', 'native_copper'];
/** Породы-заявки (кроме окаменелостей — у них свой триггер). geode — расширение сверх spec §6.3, решение T1.1. */
export const RARE_CLAIM_ROCK_CLASSES: readonly RockClass[] = [...AGATE_ROCK_CLASSES, 'geode'];

// ---------------------------------------------------------------------------
// Типы результата
// ---------------------------------------------------------------------------

export interface ScoredInclusion {
  mineral: Mineral;
  extent: Extent;
  base: number;
  multiplier: number;
  points: number;
}

export interface ScoreBreakdown {
  shape: { points: number; reason: ShapeReason };
  place: { points: number; reason: PlaceReason; mechanism: WandererMechanism | null };
  composition: {
    points: number;
    base: { points: number; reason: BaseReason; share: number | null };
    inclusions: ScoredInclusion[];
    /** Сумма до потолка (для отладки и лора «потолок достигнут»). */
    raw: number;
    capped: boolean;
  };
  quality: { points: number; fresh_split: boolean; scale_photo: boolean; user_tests: boolean };
}

export interface ScoreOutcome {
  /** null, если гео нет — карточка без score (spec §4.1). */
  score: number | null;
  tier: Tier | null;
  /** Считаются всегда — для эскалации, логов, отладки. Клиенту не показывать при !has_geo. */
  internal_score: number;
  internal_tier: Tier;
  breakdown: ScoreBreakdown;
  /** Тег «Странник»: редкая для региона порода с правдоподобным механизмом переноса. */
  wanderer: boolean;
  /** Порода не совпадает с литологией и механизма нет → карточка на ревью (антифрод). */
  geo_anomaly: boolean;
  /** false → гео не было или литология пуста; score посчитан, но карточка показывается без score (spec §4.1). */
  has_geo: boolean;
}

// ---------------------------------------------------------------------------
// Вспомогательные
// ---------------------------------------------------------------------------

export function tierFromScore(score: number): Tier {
  let tier: Tier = TIER_THRESHOLDS[0].tier;
  for (const row of TIER_THRESHOLDS) if (score >= row.min) tier = row.tier;
  return tier;
}

export function tierRank(tier: Tier): number {
  const rank = TIERS.indexOf(tier);
  if (rank < 0) throw new Error(`Unknown tier: ${String(tier)}`);
  return rank;
}

/** Ограничить тир сверху (fallback-провайдер, бюджетный предохранитель). */
export function clampTier(tier: Tier, max: Tier): Tier {
  return tierRank(tier) > tierRank(max) ? max : tier;
}

function isUnknownClass(rockClass: RockClass): boolean {
  return rockClass === 'unknown' || rockClass.startsWith('unknown_');
}

/** Базовая литология с разрешением цепочки (flint → chert → limestone). */
function baseClass(rockClass: RockClass): RockClass {
  let current = rockClass;
  for (let i = 0; i < 4; i++) {
    const next = ROCK_CLASS_BASE[current];
    if (next === undefined || next === current) break;
    current = next;
  }
  return current;
}

/** Литология пришла и не пуста — только тогда слои «место» и «база состава» имеют смысл. */
export function hasGeology(geo: GeoContext | null): geo is GeoContext {
  return geo !== null && geo.expected_rocks.length > 0;
}

/** Доля площади валидна, если это конечное число; приводится к [0, 1]. Иначе запись пропускается. */
function normalizedShare(share: unknown): number | null {
  if (typeof share !== 'number' || !Number.isFinite(share)) return null;
  return Math.min(1, Math.max(0, share));
}

/**
 * Ожидаемая порода, соответствующая rock_class: точное совпадение, либо совпадение по базовой литологии
 * (amygdaloidal_basalt ↔ basalt). Возвращается запись с максимальной долей (share нормализован в [0, 1]);
 * записи с невалидным share (NaN, не число) пропускаются.
 */
export function findExpectedRock(rockClass: RockClass, geo: GeoContext | null): ExpectedRock | null {
  if (!hasGeology(geo)) return null;
  const target = baseClass(rockClass);
  let best: ExpectedRock | null = null;
  for (const e of geo.expected_rocks) {
    if (e.rock_class !== rockClass && baseClass(e.rock_class) !== target) continue;
    const share = normalizedShare(e.share);
    if (share === null) continue;
    if (best === null || share > best.share) best = { rock_class: e.rock_class, share };
  }
  return best;
}

/**
 * Совпадает ли порода с литологией точки. Детерминированно, по expected_rocks, а не по флагу модели.
 * unknown* — сравнивать не с чем: считается совпадающей (аномалию не объявляем, баллов не даём — см. placeLayer).
 */
export function rockMatchesGeology(rockClass: RockClass, geo: GeoContext | null): boolean {
  if (!hasGeology(geo)) return false;
  if (isUnknownClass(rockClass)) return true;
  return findExpectedRock(rockClass, geo) !== null;
}

/** Включения, прошедшие порог confidence. Всё остальное для score не существует (spec §6.5). */
export function scoredInclusions(result: ScanResult): Inclusion[] {
  return result.inclusions.filter((i) => i.confidence >= INCLUSION_CONFIDENCE_THRESHOLD);
}

// ---------------------------------------------------------------------------
// Слои
// ---------------------------------------------------------------------------

export function shapeLayer(result: ScanResult): ScoreBreakdown['shape'] {
  const tags = new Set<ShapeTag>(result.shape.tags);
  const candidates: ShapeReason[] = ['plain'];
  if (result.shape.natural_hole || tags.has('natural_hole')) candidates.push('natural_hole');
  // Силуэт — только по закрытым тегам; свободный текст recognizable_silhouette в score не участвует.
  if (tags.has('heart') || tags.has('crescent')) candidates.push('silhouette');
  if (tags.has('banded')) candidates.push('banded');
  if (tags.has('spheroid') || tags.has('egg')) candidates.push('spheroid');

  let best: ShapeReason = 'plain';
  for (const c of candidates) if (SHAPE_POINTS[c] > SHAPE_POINTS[best]) best = c;
  return { points: Math.min(SHAPE_LAYER_MAX, SHAPE_POINTS[best]), reason: best };
}

export function placeLayer(result: ScanResult, geo: GeoContext | null): ScoreBreakdown['place'] {
  const mechanism = result.provenance.wanderer_mechanism;
  const primary = result.rock_class.primary;
  let reason: PlaceReason;
  if (!hasGeology(geo)) reason = 'no_geo';
  else if (isUnknownClass(primary)) reason = 'unknown_class';
  else if (UBIQUITOUS_ROCK_CLASSES.includes(primary)) reason = 'ubiquitous';
  else if (rockMatchesGeology(primary, geo)) reason = 'match';
  else if (mechanism === null) reason = 'mismatch_no_mechanism';
  else if (geo.wanderers.includes(mechanism)) reason = 'wanderer';
  else reason = 'mismatch_implausible';
  return { points: Math.min(PLACE_LAYER_MAX, PLACE_POINTS[reason]), reason, mechanism };
}

function baseComposition(result: ScanResult, geo: GeoContext | null, place: ScoreBreakdown['place']): ScoreBreakdown['composition']['base'] {
  const primary = result.rock_class.primary;
  // Фиксированные бонусы «редких везде» — до проверки гео: их не бывает в литологии Macrostrat.
  if (FOSSIL_ROCK_CLASSES.includes(primary)) return { points: FIXED_BASE_POINTS.fossil, reason: 'fossil', share: null };
  if (AGATE_ROCK_CLASSES.includes(primary)) return { points: FIXED_BASE_POINTS.agate, reason: 'agate', share: null };
  if (!hasGeology(geo)) return { points: 0, reason: 'no_geo', share: null };
  if (isUnknownClass(primary)) return { points: 0, reason: 'unknown_class', share: null };
  // Гео-аномалия: карточка идёт на ревью, «единичная» база 30 не начисляется (антифрод).
  if (GEO_ANOMALY_REASONS.includes(place.reason)) return { points: 0, reason: 'geo_anomaly', share: null };

  const expected = findExpectedRock(primary, geo);
  if (expected === null && UBIQUITOUS_ROCK_CLASSES.includes(primary)) {
    const row = SHARE_BUCKETS.find((b) => b.bucket === UBIQUITOUS_BASE_BUCKET) ?? SHARE_BUCKETS[2];
    return { points: row.points, reason: row.bucket, share: null };
  }
  const share = expected?.share ?? 0;
  const row = SHARE_BUCKETS.find((b) => share >= b.minShare) ?? SHARE_BUCKETS[3];
  return { points: row.points, reason: row.bucket, share: expected ? expected.share : null };
}

export function compositionLayer(result: ScanResult, geo: GeoContext | null): ScoreBreakdown['composition'] {
  const passed = scoredInclusions(result);
  const base = baseComposition(result, geo, placeLayer(result, geo));
  const inclusions: ScoredInclusion[] = passed.map((i) => {
    const b = INCLUSION_EXTENT_POINTS[i.extent];
    const multiplier = INCLUSION_MULTIPLIERS[i.mineral] ?? 1;
    return { mineral: i.mineral, extent: i.extent, base: b, multiplier, points: b * multiplier };
  });
  const raw = Math.round(base.points + inclusions.reduce((s, i) => s + i.points, 0));
  return { points: Math.min(COMPOSITION_LAYER_MAX, raw), base, inclusions, raw, capped: raw > COMPOSITION_LAYER_MAX };
}

export function qualityLayer(result: ScanResult, tests: UserTests | null): ScoreBreakdown['quality'] {
  const fresh_split = result.surface === 'fresh_split';
  const scale_photo = tests?.has_scale_photo === true;
  const user_tests = tests !== null && tests.weight !== null && tests.scratch !== null;
  const points =
    (fresh_split ? QUALITY_POINTS.fresh_split : 0) +
    (scale_photo ? QUALITY_POINTS.scale_photo : 0) +
    (user_tests ? QUALITY_POINTS.user_tests : 0);
  return { points: Math.min(QUALITY_LAYER_MAX, points), fresh_split, scale_photo, user_tests };
}

// ---------------------------------------------------------------------------
// Итог
// ---------------------------------------------------------------------------

export function computeScore(result: ScanResult, geo: GeoContext | null, tests: UserTests | null): ScoreOutcome {
  const shape = shapeLayer(result);
  const place = placeLayer(result, geo);
  const composition = compositionLayer(result, geo);
  const quality = qualityLayer(result, tests);
  const internal_score = Math.min(MAX_SCORE, shape.points + place.points + composition.points + quality.points);
  const internal_tier = tierFromScore(internal_score);
  const has_geo = hasGeology(geo);
  return {
    score: has_geo ? internal_score : null,
    tier: has_geo ? internal_tier : null,
    internal_score,
    internal_tier,
    breakdown: { shape, place, composition, quality },
    wanderer: place.reason === 'wanderer',
    geo_anomaly: GEO_ANOMALY_REASONS.includes(place.reason),
    has_geo,
  };
}

/**
 * spec §7 (правила игры): снаружи обычный (форма ≤ 8), включений не видно — предлагаем расколоть.
 * Не предлагаем: уже расколот / окатан (NO_SPLIT_SURFACES), ценные целиком породы (NO_SPLIT_ROCK_CLASSES).
 */
export function shouldRecommendSplit(result: ScanResult): boolean {
  if (NO_SPLIT_SURFACES.includes(result.surface)) return false;
  if (NO_SPLIT_ROCK_CLASSES.includes(result.rock_class.primary)) return false;
  return shapeLayer(result).points <= SPLIT_SHAPE_MAX && scoredInclusions(result).length === 0;
}

/** Итог для клиента: модель рекомендует И правила согласны. */
export function finalSplitRecommendation(result: ScanResult): boolean {
  return result.split_recommendation.recommended && shouldRecommendSplit(result);
}

export const ESCALATION_TRIGGERS = [
  'tier_rare_or_above',
  'confidence_band',
  'fossil_claimed',
  'rare_inclusion_claimed',
  'geology_mismatch',
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

/**
 * ai-pipeline §3 S3: причины отправить вердикт S2 на проверку Opus. Пустой массив — эскалация не нужна.
 * Триггер «пользователь оспорил» живёт на уровне очереди (scan_dispute), здесь его нет.
 */
export function escalationTriggers(result: ScanResult, prelimTier: Tier, geo: GeoContext | null): EscalationTrigger[] {
  const out: EscalationTrigger[] = [];
  if (tierRank(prelimTier) >= tierRank('rare')) out.push('tier_rare_or_above');

  const conf = result.rock_class.confidence;
  const [lo, hi] = ESCALATION_CONFIDENCE_BAND;
  if (conf >= lo && conf <= hi) out.push('confidence_band');

  const primary = result.rock_class.primary;
  const fossilClaimed =
    FOSSIL_ROCK_CLASSES.includes(primary) || result.inclusions.some((i) => FOSSIL_MINERALS.includes(i.mineral));
  if (fossilClaimed) out.push('fossil_claimed');

  const rareClaimed =
    RARE_CLAIM_ROCK_CLASSES.includes(primary) ||
    result.inclusions.some((i) => RARE_CLAIM_MINERALS.includes(i.mineral) && !FOSSIL_MINERALS.includes(i.mineral));
  if (rareClaimed) out.push('rare_inclusion_claimed');

  // Несовпадение с литологией без правдоподобного механизма — детерминированно по геоконтексту;
  // флаг модели matches_local_geology не учитывается. Без гео триггер не срабатывает.
  const place = placeLayer(result, geo);
  if (GEO_ANOMALY_REASONS.includes(place.reason)) out.push('geology_mismatch');

  return out;
}

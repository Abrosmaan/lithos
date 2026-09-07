import { describe, expect, it } from 'vitest';
import { MINERALS, ROCK_CLASSES, SHAPE_TAGS, MINERAL_RU, ROCK_CLASS_RU, ROCK_CLASS_GROUP } from './enums.js';
import type { GeoContext, UserTests } from './geo.js';
import type { Tier } from './enums.js';
import { ScanResultSchema, type ScanResult } from './scan-result.js';
import {
  COMPOSITION_LAYER_MAX,
  computeScore,
  escalationTriggers,
  clampTier,
  FALLBACK_MAX_TIER,
  finalSplitRecommendation,
  MAX_SCORE,
  PLACE_LAYER_MAX,
  QUALITY_LAYER_MAX,
  SHAPE_LAYER_MAX,
  tierRank,
  INCLUSION_CONFIDENCE_THRESHOLD,
  shouldRecommendSplit,
  tierFromScore,
} from './score.js';

// ---------------------------------------------------------------------------
// Фабрики
// ---------------------------------------------------------------------------

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

function mk(over: Deep<ScanResult> = {}): ScanResult {
  const base = {
    rock_class: { primary: 'basalt', confidence: 0.85, alternatives: [] },
    inclusions: [],
    shape: { tags: ['rounded'], natural_hole: false, recognizable_silhouette: null },
    surface: 'weathered',
    provenance: { matches_local_geology: true, wanderer_mechanism: null },
    split_recommendation: { recommended: false, reason: null },
    lore: 'Обычный базальт с пляжа.',
    flags: [],
    revision_note: null,
  };
  return ScanResultSchema.parse({
    ...base,
    ...over,
    rock_class: { ...base.rock_class, ...over.rock_class },
    shape: { ...base.shape, ...over.shape },
    provenance: { ...base.provenance, ...over.provenance },
  });
}

function inc(mineral: ScanResult['inclusions'][number]['mineral'], confidence: number, extent: 'traces' | 'noticeable' | 'dominant' = 'noticeable') {
  return { mineral, confidence, extent, location: null, evidence: 'test' };
}

/** Черноморское побережье: базальт доминирует, андезит обычен, яшма редка; странник — пемза. */
const COAST: GeoContext = {
  cell_id: 'sxh7k2',
  expected_rocks: [
    { rock_class: 'basalt', share: 0.6 },
    { rock_class: 'andesite', share: 0.25 },
    { rock_class: 'jasper', share: 0.05 },
    { rock_class: 'limestone', share: 0.02 },
  ],
  age_range: 'Cretaceous–Paleogene',
  setting: 'coast',
  wanderers: ['drift_pumice', 'river_transport'],
  source: 'macrostrat',
};

const NO_TESTS: UserTests = { weight: null, scratch: null, wet: null, has_scale_photo: false };
const FULL_TESTS: UserTests = { weight: 'heavier', scratch: 'none', wet: false, has_scale_photo: true };

// ---------------------------------------------------------------------------
// Словари
// ---------------------------------------------------------------------------

describe('enums', () => {
  it('размеры словарей по dev-plan §3', () => {
    expect(ROCK_CLASSES.length).toBeGreaterThanOrEqual(55);
    expect(ROCK_CLASSES.length).toBeLessThanOrEqual(70);
    expect(MINERALS.length).toBeGreaterThanOrEqual(38);
    expect(MINERALS.length).toBeLessThanOrEqual(48);
    expect(SHAPE_TAGS.length).toBe(12);
    for (const u of ['unknown_igneous', 'unknown_sedimentary', 'unknown_metamorphic', 'unknown']) {
      expect(ROCK_CLASSES).toContain(u);
    }
  });

  it('без дублей, у каждого значения есть русское имя и группа', () => {
    expect(new Set(ROCK_CLASSES).size).toBe(ROCK_CLASSES.length);
    expect(new Set(MINERALS).size).toBe(MINERALS.length);
    for (const r of ROCK_CLASSES) {
      expect(ROCK_CLASS_RU[r]).toBeTruthy();
      expect(ROCK_CLASS_GROUP[r]).toBeTruthy();
    }
    for (const m of MINERALS) expect(MINERAL_RU[m]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

describe('computeScore — базовые кейсы', () => {
  it('обычный базальт на базальтовом пляже → common', () => {
    const r = computeScore(mk(), COAST, NO_TESTS);
    // форма 3 + место 5 + база (доминирующая) 5 + качество 0 = 13
    expect(r.breakdown.shape.points).toBe(3);
    expect(r.breakdown.place.points).toBe(5);
    expect(r.breakdown.composition.points).toBe(5);
    expect(r.breakdown.quality.points).toBe(0);
    expect(r.score).toBe(13);
    expect(r.tier).toBe('common');
    expect(r.wanderer).toBe(false);
    expect(r.geo_anomaly).toBe(false);
    expect(r.has_geo).toBe(true);
  });

  it('куриный бог → форма 20 (natural_hole по флагу и по тегу)', () => {
    const byFlag = computeScore(mk({ shape: { natural_hole: true } }), COAST, NO_TESTS);
    const byTag = computeScore(mk({ shape: { tags: ['natural_hole'] } }), COAST, NO_TESTS);
    expect(byFlag.breakdown.shape).toEqual({ points: 20, reason: 'natural_hole' });
    expect(byTag.breakdown.shape.points).toBe(20);
    expect(byFlag.internal_score - computeScore(mk(), COAST, NO_TESTS).internal_score).toBe(17); // 20 вместо 3
  });

  it('форма: берётся максимум, а не сумма', () => {
    const r = computeScore(
      mk({ shape: { tags: ['spheroid', 'banded', 'heart'], natural_hole: false, recognizable_silhouette: 'сердце' } }),
      COAST,
      NO_TESTS,
    );
    expect(r.breakdown.shape).toEqual({ points: 15, reason: 'silhouette' });
    const sph = computeScore(mk({ shape: { tags: ['egg'] } }), COAST, NO_TESTS);
    expect(sph.breakdown.shape).toEqual({ points: 8, reason: 'spheroid' });
    const banded = computeScore(mk({ shape: { tags: ['banded', 'spheroid'] } }), COAST, NO_TESTS);
    expect(banded.breakdown.shape).toEqual({ points: 10, reason: 'banded' });
  });

  it('силуэт — только по тегам heart/crescent; свободный текст recognizable_silhouette не участвует', () => {
    const text = computeScore(mk({ shape: { tags: ['rounded'], recognizable_silhouette: 'none' } }), COAST, NO_TESTS);
    expect(text.breakdown.shape).toEqual({ points: 3, reason: 'plain' });
    const heart = computeScore(mk({ shape: { tags: ['heart'], recognizable_silhouette: null } }), COAST, NO_TESTS);
    expect(heart.breakdown.shape).toEqual({ points: 15, reason: 'silhouette' });
    const crescent = computeScore(mk({ shape: { tags: ['crescent'] } }), COAST, NO_TESTS);
    expect(crescent.breakdown.shape.points).toBe(15);
  });

  it('пемза на побережье с drift_pumice → странник +20, база «единичная» 30', () => {
    const r = computeScore(
      mk({ rock_class: { primary: 'pumice' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'drift_pumice' } }),
      COAST,
      NO_TESTS,
    );
    expect(r.wanderer).toBe(true);
    expect(r.geo_anomaly).toBe(false);
    expect(r.breakdown.place).toEqual({ points: 20, reason: 'wanderer', mechanism: 'drift_pumice' });
    expect(r.breakdown.composition.base).toEqual({ points: 30, reason: 'singular', share: null });
    expect(r.score).toBe(3 + 20 + 30);
    expect(r.tier).toBe('rare');
  });

  it('гео-аномалия: порода не из региона, механизма нет → место 0, geo_anomaly', () => {
    const r = computeScore(
      mk({ rock_class: { primary: 'marble' }, provenance: { matches_local_geology: false, wanderer_mechanism: null } }),
      COAST,
      NO_TESTS,
    );
    expect(r.geo_anomaly).toBe(true);
    expect(r.wanderer).toBe(false);
    expect(r.breakdown.place).toEqual({ points: 0, reason: 'mismatch_no_mechanism', mechanism: null });
    // «единичная» база 30 при аномалии не начисляется
    expect(r.breakdown.composition.base).toEqual({ points: 0, reason: 'geo_anomaly', share: null });
    expect(r.score).toBe(3);
  });

  it('гео-аномалия: механизм заявлен, но его нет в wanderers зоны → неправдоподобно', () => {
    const r = computeScore(
      mk({ rock_class: { primary: 'granite' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'glacial_erratic' } }),
      COAST,
      NO_TESTS,
    );
    expect(r.geo_anomaly).toBe(true);
    expect(r.breakdown.place.reason).toBe('mismatch_implausible');
    expect(r.breakdown.place.points).toBe(0);
    expect(r.breakdown.composition.base.reason).toBe('geo_anomaly');
  });

  it('human_imported не в wanderers зоны → mismatch_implausible, аномалия', () => {
    const r = computeScore(
      mk({ rock_class: { primary: 'marble' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'human_imported' } }),
      COAST,
      NO_TESTS,
    );
    expect(r.breakdown.place).toEqual({ points: 0, reason: 'mismatch_implausible', mechanism: 'human_imported' });
    expect(r.geo_anomaly).toBe(true);
    expect(r.wanderer).toBe(false);
    // а в зоне, где human_imported допустим — странник
    const ok = computeScore(
      mk({ rock_class: { primary: 'marble' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'human_imported' } }),
      { ...COAST, wanderers: ['human_imported'] },
      NO_TESTS,
    );
    expect(ok.wanderer).toBe(true);
    expect(ok.breakdown.composition.base.reason).toBe('singular');
  });

  it('совпадение по базовой литологии: amygdaloidal_basalt ↔ basalt', () => {
    const r = computeScore(mk({ rock_class: { primary: 'amygdaloidal_basalt' } }), COAST, NO_TESTS);
    expect(r.breakdown.place.reason).toBe('match');
    expect(r.breakdown.composition.base).toEqual({ points: 5, reason: 'dominant', share: 0.6 });
  });

  it('флаг модели matches_local_geology не влияет на слой места — только литология', () => {
    const r = computeScore(mk({ provenance: { matches_local_geology: false, wanderer_mechanism: null } }), COAST, NO_TESTS);
    expect(r.breakdown.place.reason).toBe('match');
    expect(r.geo_anomaly).toBe(false);
  });

  it('без гео: место 0 (no_geo), база 0, has_geo=false, score всё равно посчитан', () => {
    const r = computeScore(mk({ shape: { natural_hole: true } }), null, NO_TESTS);
    expect(r.has_geo).toBe(false);
    expect(r.breakdown.place).toEqual({ points: 0, reason: 'no_geo', mechanism: null });
    expect(r.breakdown.composition.base.reason).toBe('no_geo');
    expect(r.geo_anomaly).toBe(false);
    // карточка без score (spec §4.1), но внутренние значения посчитаны
    expect(r.score).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.internal_score).toBe(20);
    expect(r.internal_tier).toBe('common');
    const empty = computeScore(mk(), { ...COAST, expected_rocks: [], source: 'none' }, NO_TESTS);
    expect(empty.has_geo).toBe(false);
    expect(empty.score).toBeNull();
    expect(empty.breakdown.place.reason).toBe('no_geo');
    // с гео score и internal_score совпадают
    const withGeo = computeScore(mk(), COAST, NO_TESTS);
    expect(withGeo.score).toBe(withGeo.internal_score);
    expect(withGeo.tier).toBe(withGeo.internal_tier);
  });
});

describe('computeScore — состав', () => {
  it('бакеты по доле площади: доминирующая 5 / обычная 10 / редкая 20 / единичная 30', () => {
    const base = (primary: ScanResult['rock_class']['primary']) =>
      computeScore(mk({ rock_class: { primary } }), COAST, NO_TESTS).breakdown.composition.base;
    expect(base('basalt')).toMatchObject({ points: 5, reason: 'dominant' });
    expect(base('andesite')).toMatchObject({ points: 10, reason: 'common' });
    expect(base('jasper')).toMatchObject({ points: 20, reason: 'rare' });
    expect(base('limestone')).toMatchObject({ points: 30, reason: 'singular', share: 0.02 });
    const absent = computeScore(
      mk({ rock_class: { primary: 'gneiss' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'river_transport' } }),
      COAST,
      NO_TESTS,
    );
    expect(absent.breakdown.composition.base).toMatchObject({ points: 30, reason: 'singular', share: null });
  });

  it('confidence выше порога не влияет на баллы: 0.6 и 0.99 дают одинаковый результат', () => {
    const lo = computeScore(mk({ rock_class: { confidence: 0.6 }, inclusions: [inc('zeolite', 0.6), inc('pyrite', 0.6, 'traces')] }), COAST, FULL_TESTS);
    const hi = computeScore(mk({ rock_class: { confidence: 0.99 }, inclusions: [inc('zeolite', 0.99), inc('pyrite', 0.99, 'traces')] }), COAST, FULL_TESTS);
    expect(hi).toEqual(lo);
  });

  it('включение с confidence 0.55 не засчитывается вообще', () => {
    const r = computeScore(mk({ inclusions: [inc('zeolite', 0.55)] }), COAST, NO_TESTS);
    expect(r.breakdown.composition.inclusions).toEqual([]);
    expect(r.breakdown.composition.points).toBe(5);
  });

  it('включение с confidence 0.6 засчитывается (порог включительно), цеолит ×1.5', () => {
    expect(INCLUSION_CONFIDENCE_THRESHOLD).toBe(0.6);
    const r = computeScore(mk({ inclusions: [inc('zeolite', 0.6)] }), COAST, NO_TESTS);
    expect(r.breakdown.composition.inclusions).toEqual([
      { mineral: 'zeolite', extent: 'noticeable', base: 7, multiplier: 1.5, points: 10.5 },
    ]);
    // 5 + 10.5 = 15.5 → округление до 16
    expect(r.breakdown.composition.points).toBe(16);
  });

  it('extent: следы 3 / заметно 7 / основной 12; пирит ×1.3; без множителя ×1', () => {
    const r = computeScore(
      mk({ inclusions: [inc('calcite', 0.9, 'traces'), inc('epidote', 0.9, 'noticeable'), inc('pyrite', 0.9, 'dominant')] }),
      COAST,
      NO_TESTS,
    );
    const pts = r.breakdown.composition.inclusions.map((i) => i.points);
    expect(pts).toEqual([3, 7, 12 * 1.3]);
  });

  it('потолок состава 45', () => {
    const r = computeScore(
      mk({
        rock_class: { primary: 'gneiss' }, // единичная → 30
        provenance: { matches_local_geology: false, wanderer_mechanism: 'river_transport' },
        inclusions: [inc('garnet', 0.9, 'dominant'), inc('pyrite', 0.9, 'dominant'), inc('quartz_druse', 0.9, 'dominant')],
      }),
      COAST,
      NO_TESTS,
    );
    expect(r.breakdown.composition.raw).toBeGreaterThan(COMPOSITION_LAYER_MAX);
    expect(r.breakdown.composition.points).toBe(COMPOSITION_LAYER_MAX);
    expect(r.breakdown.composition.capped).toBe(true);
  });

  it('окаменелость: база 40 только для fossil / petrified_wood, заменяет бакет', () => {
    const byClass = computeScore(mk({ rock_class: { primary: 'fossil' } }), COAST, NO_TESTS);
    expect(byClass.breakdown.composition.base).toEqual({ points: 40, reason: 'fossil', share: null });
    const wood = computeScore(mk({ rock_class: { primary: 'petrified_wood' } }), COAST, NO_TESTS);
    expect(wood.breakdown.composition.base.points).toBe(40);
    // fossiliferous_limestone — обычная порода: база по бакету (limestone 0.02 → единичная)
    const fl = computeScore(mk({ rock_class: { primary: 'fossiliferous_limestone' } }), COAST, NO_TESTS);
    expect(fl.breakdown.composition.base).toEqual({ points: 30, reason: 'singular', share: 0.02 });
  });

  it('включение fossil_fragment: только баллы включения ×2, базу 40 не даёт', () => {
    const geo: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'limestone', share: 0.3 }] };
    const r = computeScore(
      mk({ rock_class: { primary: 'limestone' }, inclusions: [inc('fossil_fragment', 0.6, 'traces')] }),
      geo,
      NO_TESTS,
    );
    expect(r.breakdown.composition.base).toEqual({ points: 10, reason: 'common', share: 0.3 });
    expect(r.breakdown.composition.inclusions).toEqual([
      { mineral: 'fossil_fragment', extent: 'traces', base: 3, multiplier: 2, points: 6 },
    ]);
    expect(r.breakdown.composition.points).toBe(16);

    // ниже порога — включения нет
    const weak = computeScore(mk({ inclusions: [inc('fossil_fragment', 0.5)] }), COAST, NO_TESTS);
    expect(weak.breakdown.composition.base.reason).toBe('dominant');
    expect(weak.breakdown.composition.points).toBe(5);
  });

  it('share: clamp в [0,1]; NaN / не число → запись пропускается', () => {
    const over: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'basalt', share: 5 }] };
    expect(computeScore(mk(), over, NO_TESTS).breakdown.composition.base).toEqual({ points: 5, reason: 'dominant', share: 1 });
    const nan: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'basalt', share: Number.NaN }, { rock_class: 'andesite', share: 0.2 }] };
    const r = computeScore(mk(), nan, NO_TESTS);
    // базальт с NaN пропущен → породы нет в литологии → аномалия
    expect(r.breakdown.place.reason).toBe('mismatch_no_mechanism');
    expect(r.breakdown.composition.base).toEqual({ points: 0, reason: 'geo_anomaly', share: null });
    const str: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'basalt', share: '0.5' as unknown as number }] };
    expect(computeScore(mk(), str, NO_TESTS).breakdown.place.reason).toBe('mismatch_no_mechanism');
  });

  it('агат: фиксированная база 30 независимо от литологии и гео', () => {
    const r = computeScore(mk({ rock_class: { primary: 'agate' } }), COAST, NO_TESTS);
    expect(r.breakdown.composition.base).toEqual({ points: 30, reason: 'agate', share: null });
    const noGeo = computeScore(mk({ rock_class: { primary: 'agate' } }), null, NO_TESTS);
    expect(noGeo.breakdown.composition.base.points).toBe(30);
  });

  it('повсеместные породы: агат на базальтовом побережье → место 5, состав 30, без аномалии и странника', () => {
    const r = computeScore(
      mk({ rock_class: { primary: 'agate' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'drift_pumice' } }),
      COAST,
      NO_TESTS,
    );
    expect(r.breakdown.place).toEqual({ points: 5, reason: 'ubiquitous', mechanism: 'drift_pumice' });
    expect(r.breakdown.composition.points).toBe(30);
    expect(r.geo_anomaly).toBe(false);
    expect(r.wanderer).toBe(false);
    expect(r.score).toBe(3 + 5 + 30);
    expect(escalationTriggers(mk({ rock_class: { primary: 'agate' } }), 'common', COAST)).toEqual(['rare_inclusion_claimed']);
  });

  it('повсеместные породы: яшма без совпадений → место 5, база «редкая» 20', () => {
    const geo: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'basalt', share: 0.9 }] };
    const r = computeScore(mk({ rock_class: { primary: 'jasper' } }), geo, NO_TESTS);
    expect(r.breakdown.place).toEqual({ points: 5, reason: 'ubiquitous', mechanism: null });
    expect(r.breakdown.composition.base).toEqual({ points: 20, reason: 'rare', share: null });
    expect(r.geo_anomaly).toBe(false);
    // а если яшма есть в литологии (COAST: 0.05) — обычный бакет по share
    expect(computeScore(mk({ rock_class: { primary: 'jasper' } }), COAST, NO_TESTS).breakdown.composition.base).toEqual({ points: 20, reason: 'rare', share: 0.05 });
  });

  it('повсеместные породы: флинт в известняковом регионе → база по share (flint → chert → limestone)', () => {
    const geo: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'limestone', share: 0.3 }, { rock_class: 'chalk', share: 0.6 }] };
    const r = computeScore(mk({ rock_class: { primary: 'flint' } }), geo, NO_TESTS);
    expect(r.breakdown.place.reason).toBe('ubiquitous');
    expect(r.breakdown.composition.base).toEqual({ points: 10, reason: 'common', share: 0.3 });
    const chertGeo: GeoContext = { ...COAST, expected_rocks: [{ rock_class: 'chert', share: 0.6 }] };
    expect(computeScore(mk({ rock_class: { primary: 'flint' } }), chertGeo, NO_TESTS).breakdown.composition.base).toEqual({ points: 5, reason: 'dominant', share: 0.6 });
  });

  it('unknown / unknown_*: база 0, место 0 (unknown_class), без аномалии', () => {
    for (const primary of ['unknown', 'unknown_igneous', 'unknown_sedimentary', 'unknown_metamorphic'] as const) {
      const r = computeScore(mk({ rock_class: { primary } }), COAST, NO_TESTS);
      expect(r.breakdown.composition.base).toEqual({ points: 0, reason: 'unknown_class', share: null });
      expect(r.breakdown.place).toEqual({ points: 0, reason: 'unknown_class', mechanism: null });
      expect(r.geo_anomaly).toBe(false);
      expect(r.wanderer).toBe(false);
    }
  });
});

describe('computeScore — качество', () => {
  it('fresh_split +6', () => {
    const r = computeScore(mk({ surface: 'fresh_split' }), COAST, NO_TESTS);
    expect(r.breakdown.quality).toEqual({ points: 6, fresh_split: true, scale_photo: false, user_tests: false });
  });

  it('фото с масштабом +2, тесты пользователя +2 (оба — вес и царапина)', () => {
    const full = computeScore(mk(), COAST, FULL_TESTS);
    expect(full.breakdown.quality).toEqual({ points: 4, fresh_split: false, scale_photo: true, user_tests: true });
    const half = computeScore(mk(), COAST, { ...FULL_TESTS, scratch: null });
    expect(half.breakdown.quality.user_tests).toBe(false);
    expect(half.breakdown.quality.points).toBe(2);
    expect(computeScore(mk(), COAST, null).breakdown.quality.points).toBe(0);
  });

  it('максимум слоя 10 и общий потолок 100', () => {
    const r = computeScore(
      mk({
        rock_class: { primary: 'gneiss' }, // странник → 20; единичная → 30
        surface: 'fresh_split',
        shape: { natural_hole: true },
        inclusions: [inc('garnet', 0.9, 'dominant'), inc('quartz_druse', 0.9, 'dominant'), inc('pyrite', 0.9, 'dominant')],
        provenance: { matches_local_geology: false, wanderer_mechanism: 'river_transport' },
      }),
      COAST,
      FULL_TESTS,
    );
    expect(r.breakdown.quality.points).toBe(10);
    expect(r.score).toBe(20 + 20 + 45 + 10);
    expect(r.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(r.tier).toBe('legendary');
  });

  it('общий потолок 100: сумма максимумов слоёв не превышает MAX_SCORE', () => {
    // форма фактически ≤ 20 (максимум из строк), поэтому 100 недостижимо — проверяем инвариант ≤ 100
    expect(SHAPE_LAYER_MAX + PLACE_LAYER_MAX + COMPOSITION_LAYER_MAX + QUALITY_LAYER_MAX).toBe(MAX_SCORE);
    expect(MAX_SCORE).toBe(100);
  });
});

describe('tierFromScore — границы', () => {
  it.each([
    [0, 'common'], [29, 'common'], [30, 'uncommon'], [49, 'uncommon'],
    [50, 'rare'], [69, 'rare'], [70, 'epic'], [84, 'epic'], [85, 'legendary'], [100, 'legendary'],
  ] as const)('%i → %s', (score, tier) => {
    expect(tierFromScore(score)).toBe(tier);
  });

  it('clampTier ограничивает сверху (fallback → максимум rare)', () => {
    expect(FALLBACK_MAX_TIER).toBe('rare');
    expect(clampTier('legendary', FALLBACK_MAX_TIER)).toBe('rare');
    expect(clampTier('epic', FALLBACK_MAX_TIER)).toBe('rare');
    expect(clampTier('rare', FALLBACK_MAX_TIER)).toBe('rare');
    expect(clampTier('uncommon', FALLBACK_MAX_TIER)).toBe('uncommon');
  });

  it('tierRank / clampTier бросают на значении не из TIERS', () => {
    expect(() => tierRank('mythic' as Tier)).toThrow(/Unknown tier/);
    expect(() => clampTier('mythic' as Tier, 'rare')).toThrow(/Unknown tier/);
    expect(() => clampTier('rare', 'mythic' as Tier)).toThrow(/Unknown tier/);
  });
});

describe('shouldRecommendSplit (spec §7)', () => {
  it('обычная галька без включений → предлагаем', () => {
    expect(shouldRecommendSplit(mk())).toBe(true);
    expect(shouldRecommendSplit(mk({ shape: { tags: ['spheroid'] } }))).toBe(true); // форма 8 — ещё да
  });
  it('форма > 8 или есть засчитанное включение → нет', () => {
    expect(shouldRecommendSplit(mk({ shape: { tags: ['banded'] } }))).toBe(false);
    expect(shouldRecommendSplit(mk({ inclusions: [inc('zeolite', 0.7)] }))).toBe(false);
  });
  it('включение ниже порога не считается видимым → предлагаем', () => {
    expect(shouldRecommendSplit(mk({ inclusions: [inc('zeolite', 0.5)] }))).toBe(true);
  });
  it('уже расколот (fresh_split) или окатан (polished) → не предлагаем', () => {
    expect(shouldRecommendSplit(mk({ surface: 'fresh_split' }))).toBe(false);
    expect(shouldRecommendSplit(mk({ surface: 'polished' }))).toBe(false);
    expect(shouldRecommendSplit(mk({ surface: 'coated' }))).toBe(true);
  });
  it('ценные целиком породы (fossil, petrified_wood, geode, agate) → не предлагаем', () => {
    for (const primary of ['fossil', 'petrified_wood', 'geode', 'agate'] as const) {
      expect(shouldRecommendSplit(mk({ rock_class: { primary } }))).toBe(false);
    }
  });
  it('finalSplitRecommendation: модель И правила согласны', () => {
    expect(finalSplitRecommendation(mk({ split_recommendation: { recommended: true, reason: 'snaruzhi obychnyj' } }))).toBe(true);
    expect(finalSplitRecommendation(mk({ split_recommendation: { recommended: false, reason: null } }))).toBe(false);
    expect(
      finalSplitRecommendation(mk({ split_recommendation: { recommended: true, reason: 'x' }, inclusions: [inc('zeolite', 0.7)] })),
    ).toBe(false);
  });
});

describe('escalationTriggers (ai-pipeline §3 S3)', () => {
  it('обычный уверенный базальт → без эскалации', () => {
    expect(escalationTriggers(mk(), 'common', COAST)).toEqual([]);
  });
  it('предварительный тир ≥ rare', () => {
    expect(escalationTriggers(mk(), 'rare', COAST)).toEqual(['tier_rare_or_above']);
    expect(escalationTriggers(mk(), 'legendary', COAST)).toContain('tier_rare_or_above');
    expect(escalationTriggers(mk(), 'uncommon', COAST)).not.toContain('tier_rare_or_above');
  });
  it('confidence в полосе 0.45–0.65 включительно', () => {
    expect(escalationTriggers(mk({ rock_class: { confidence: 0.45 } }), 'common', COAST)).toEqual(['confidence_band']);
    expect(escalationTriggers(mk({ rock_class: { confidence: 0.65 } }), 'common', COAST)).toEqual(['confidence_band']);
    expect(escalationTriggers(mk({ rock_class: { confidence: 0.44 } }), 'common', COAST)).toEqual([]);
    expect(escalationTriggers(mk({ rock_class: { confidence: 0.66 } }), 'common', COAST)).toEqual([]);
  });
  it('заявлена окаменелость — с любым confidence', () => {
    expect(escalationTriggers(mk({ inclusions: [inc('fossil_fragment', 0.2)] }), 'common', COAST)).toEqual(['fossil_claimed']);
    expect(escalationTriggers(mk({ rock_class: { primary: 'petrified_wood' } }), 'common', COAST)).toContain('fossil_claimed');
  });
  it('заявлено редкое включение/порода: агат, друза, самородный металл', () => {
    const agate = mk({ rock_class: { primary: 'agate' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'river_transport' } });
    expect(escalationTriggers(agate, 'common', COAST)).toEqual(['rare_inclusion_claimed']);
    expect(escalationTriggers(mk({ inclusions: [inc('quartz_druse', 0.3)] }), 'common', COAST)).toEqual(['rare_inclusion_claimed']);
    expect(escalationTriggers(mk({ inclusions: [inc('native_copper', 0.3)] }), 'common', COAST)).toEqual(['rare_inclusion_claimed']);
    expect(escalationTriggers(mk({ inclusions: [inc('quartz', 0.9)] }), 'common', COAST)).toEqual([]);
  });
  it('несовпадение с литологией: без механизма или с неправдоподобным → geology_mismatch; странник — нет', () => {
    const mismatch = mk({ rock_class: { primary: 'marble' }, provenance: { matches_local_geology: false, wanderer_mechanism: null } });
    expect(escalationTriggers(mismatch, 'common', COAST)).toEqual(['geology_mismatch']);
    const implausible = mk({ rock_class: { primary: 'granite' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'glacial_erratic' } });
    expect(escalationTriggers(implausible, 'common', COAST)).toEqual(['geology_mismatch']);
    const wanderer = mk({ rock_class: { primary: 'pumice' }, provenance: { matches_local_geology: false, wanderer_mechanism: 'drift_pumice' } });
    expect(escalationTriggers(wanderer, 'common', COAST)).toEqual([]);
  });
  it('флаг модели matches_local_geology не учитывается; без гео триггер не срабатывает', () => {
    expect(escalationTriggers(mk({ provenance: { matches_local_geology: false } }), 'common', COAST)).toEqual([]);
    expect(escalationTriggers(mk({ provenance: { matches_local_geology: false } }), 'common', null)).toEqual([]);
    expect(escalationTriggers(mk(), 'common', null)).toEqual([]);
  });
  it('несколько триггеров сразу', () => {
    const r = mk({ rock_class: { primary: 'fossil', confidence: 0.5 }, provenance: { matches_local_geology: false, wanderer_mechanism: null } });
    expect(escalationTriggers(r, 'epic', COAST)).toEqual([
      'tier_rare_or_above', 'confidence_band', 'fossil_claimed',
    ]);
    const m = mk({ rock_class: { primary: 'marble', confidence: 0.5 }, provenance: { matches_local_geology: false, wanderer_mechanism: null } });
    expect(escalationTriggers(m, 'rare', COAST)).toEqual(['tier_rare_or_above', 'confidence_band', 'geology_mismatch']);
  });
});

import { describe, expect, it } from 'vitest';
import { CONFIDENT_ERROR_THRESHOLD, INCLUSION_CONFIDENCE_THRESHOLD, type ScanResult } from '@lithos/shared';
import type { GoldenLabel } from './labels.js';
import {
  CALIBRATION_SUM_RANGE,
  classMatches,
  gateOutcome,
  isCalibrated,
  probabilitySum,
  truthProbability,
  hasPercentages,
  inclusionCounts,
  isConfidentError,
  percentile,
  scanOutcome,
  summarizeGate,
  summarizeScan,
  top1Correct,
  top2Correct,
  trapPassed,
  failedOutcome,
} from './metrics.js';

function label(over: Partial<GoldenLabel> = {}): GoldenLabel {
  return {
    id: 'vc-01',
    file: 'vc-01.jpg',
    is_rock: true,
    rock_class: 'basalt',
    acceptable_alternatives: [],
    inclusions: [],
    geology_type: 'volcanic_coast',
    trap: null,
    decoy: null,
    lat: 64.13,
    lng: -21.9,
    source: null,
    notes: '',
    ...over,
  };
}

function result(over: Partial<ScanResult> & { primary?: ScanResult['rock_class']['primary']; confidence?: number } = {}): ScanResult {
  const { primary = 'basalt', confidence = 0.7, ...rest } = over;
  return {
    rock_class: { primary, confidence, alternatives: [] },
    inclusions: [],
    shape: { tags: [], natural_hole: false, recognizable_silhouette: null },
    surface: 'weathered',
    provenance: { matches_local_geology: true, wanderer_mechanism: null },
    split_recommendation: { recommended: false, reason: null },
    lore: 'Базальт — застывшая лава.',
    flags: [],
    revision_note: null,
    ...rest,
  };
}

const meta = { costUsd: 0.01, latencyMs: 1000, repaired: false, attempts: 1 };

describe('top-1 / top-2', () => {
  it('exact match', () => {
    expect(top1Correct(result({ primary: 'basalt' }), label())).toBe(true);
    expect(top1Correct(result({ primary: 'granite' }), label())).toBe(false);
  });
  it('varieties collapse symmetrically (amygdaloidal_basalt ≈ basalt), but chert/flint/limestone do not', () => {
    expect(classMatches('amygdaloidal_basalt', 'basalt')).toBe(true);
    expect(classMatches('basalt', 'vesicular_basalt')).toBe(true);
    expect(classMatches('coquina', 'fossiliferous_limestone')).toBe(true);
    expect(classMatches('ignimbrite', 'tuff')).toBe(true);
    expect(classMatches('flint', 'chert')).toBe(false);
    expect(classMatches('chert', 'limestone')).toBe(false);
    expect(classMatches('flint', 'limestone')).toBe(false);
    // …только через acceptable_alternatives манифеста
    expect(top1Correct(result({ primary: 'chert' }), label({ rock_class: 'flint', acceptable_alternatives: ['chert'] }))).toBe(true);
  });
  it('acceptable_alternatives count as correct', () => {
    const l = label({ rock_class: 'andesite', acceptable_alternatives: ['basalt', 'dacite'] });
    expect(top1Correct(result({ primary: 'dacite' }), l)).toBe(true);
    expect(top1Correct(result({ primary: 'rhyolite' }), l)).toBe(false);
  });
  it('top-2 uses the most confident alternative of the model', () => {
    const r = result({
      primary: 'gabbro',
      rock_class: { primary: 'gabbro', confidence: 0.5, alternatives: [{ name: 'diorite', confidence: 0.2 }, { name: 'basalt', confidence: 0.4 }] },
    });
    expect(top1Correct(r, label())).toBe(false);
    expect(top2Correct(r, label())).toBe(true);
    const r2 = result({ rock_class: { primary: 'gabbro', confidence: 0.5, alternatives: [{ name: 'basalt', confidence: 0.1 }, { name: 'diorite', confidence: 0.4 }] } });
    expect(top2Correct(r2, label())).toBe(false);
  });
});

describe('confident errors', () => {
  it('threshold from shared', () => {
    expect(isConfidentError(result({ primary: 'granite', confidence: CONFIDENT_ERROR_THRESHOLD }), label())).toBe(true);
    expect(isConfidentError(result({ primary: 'granite', confidence: CONFIDENT_ERROR_THRESHOLD - 0.01 }), label())).toBe(false);
    expect(isConfidentError(result({ primary: 'basalt', confidence: 0.99 }), label())).toBe(false);
  });
});

describe('calibration of the candidate list (main-v2)', () => {
  const alts = (...a: [ScanResult['rock_class']['primary'], number][]) => a.map(([name, confidence]) => ({ name, confidence }));
  it('sum of primary + alternatives must fall into CALIBRATION_SUM_RANGE; the window itself is the metric constant', () => {
    expect(probabilitySum(result({ rock_class: { primary: 'basalt', confidence: 0.6, alternatives: alts(['andesite', 0.25], ['gabbro', 0.1]) } }))).toBeCloseTo(0.95);
    expect(isCalibrated(result({ rock_class: { primary: 'basalt', confidence: 0.6, alternatives: alts(['andesite', 0.25], ['gabbro', 0.1]) } }))).toBe(true);
    // «всем по 0.9» — не калибровка
    expect(isCalibrated(result({ rock_class: { primary: 'basalt', confidence: 0.9, alternatives: alts(['andesite', 0.9]) } }))).toBe(false);
    // недораздал массу
    expect(isCalibrated(result({ rock_class: { primary: 'basalt', confidence: 0.5, alternatives: [] } }))).toBe(false);
    expect(isCalibrated(result({ rock_class: { primary: 'basalt', confidence: CALIBRATION_SUM_RANGE.min, alternatives: [] } }))).toBe(true);
    expect(isCalibrated(result({ rock_class: { primary: 'basalt', confidence: CALIBRATION_SUM_RANGE.max, alternatives: [] } }))).toBe(true);
  });
  it('truth probability sums the mass on acceptable classes (varieties and acceptable_alternatives), capped at 1', () => {
    const l = label({ rock_class: 'basalt', acceptable_alternatives: ['andesite'] });
    // primary верен → его confidence
    expect(truthProbability(result({ rock_class: { primary: 'basalt', confidence: 0.7, alternatives: alts(['gabbro', 0.2]) } }), l)).toBeCloseTo(0.7);
    // primary неверен, истина второй → её confidence
    expect(truthProbability(result({ rock_class: { primary: 'gabbro', confidence: 0.5, alternatives: alts(['vesicular_basalt', 0.3], ['diorite', 0.1]) } }), l)).toBeCloseTo(0.3);
    // истина и допустимая альтернатива обе в списке — складываются
    expect(truthProbability(result({ rock_class: { primary: 'basalt', confidence: 0.5, alternatives: alts(['andesite', 0.3]) } }), l)).toBeCloseTo(0.8);
    // истины нет — 0
    expect(truthProbability(result({ rock_class: { primary: 'gabbro', confidence: 0.9, alternatives: alts(['diorite', 0.1]) } }), l)).toBe(0);
    // обрезка до 1
    expect(truthProbability(result({ rock_class: { primary: 'basalt', confidence: 0.9, alternatives: alts(['andesite', 0.9]) } }), l)).toBe(1);
  });
  it('summary: calibrated rate, mean truth probability and mean alternatives over rocks only; failed calls excluded', () => {
    const glass = label({ id: 'tr-10', is_rock: false, rock_class: 'unknown', trap: 'glass_vs_quartz', decoy: { rock_class: 'quartz_vein' } });
    const outcomes = [
      scanOutcome(result({ rock_class: { primary: 'basalt', confidence: 0.6, alternatives: alts(['andesite', 0.3]) } }), label(), meta, 'main'),
      scanOutcome(result({ rock_class: { primary: 'granite', confidence: 0.9, alternatives: alts(['basalt', 0.9], ['gabbro', 0.9], ['diorite', 0.9]) } }), label({ id: 'vc-02' }), meta, 'main'),
      scanOutcome(result({ rock_class: { primary: 'quartz_vein', confidence: 0.3, alternatives: [] } }), glass, meta, 'main'),
      failedOutcome('vc-03', 'main', { ...meta, costUsd: 0 }, label({ id: 'vc-03' })),
    ];
    const s = summarizeScan(outcomes.filter((o): o is Extract<typeof o, { stage: 'main' }> => o.stage === 'main'));
    expect(s.calibratedRate).toBe(0.5);
    expect(s.truthProbMean).toBeCloseTo((0.6 + 0.9) / 2); // vc-02: истина в альтернативах с 0.9, обрезка до 1 не нужна
    expect(s.alternativesMean).toBe(2);
    const onlyFailed = [failedOutcome('vc-03', 'main', { ...meta, costUsd: 0 }, label({ id: 'vc-03' }))].filter((o): o is Extract<typeof o, { stage: 'main' }> => o.stage === 'main');
    expect(summarizeScan(onlyFailed).calibratedRate).toBeNull();
  });
});

describe('inclusion precision', () => {
  const l = label({ inclusions: [{ mineral: 'mica', extent: 'noticeable' }, { mineral: 'quartz', extent: 'traces' }] });
  const inc = (mineral: ScanResult['inclusions'][number]['mineral'], confidence: number) => ({
    mineral,
    confidence,
    extent: 'traces' as const,
    location: null,
    evidence: 'shiny flakes',
  });
  it('only inclusions ≥ INCLUSION_CONFIDENCE_THRESHOLD are counted; mineral families collapse into one prediction', () => {
    const r = result({ inclusions: [inc('muscovite', 0.9), inc('mica', 0.7), inc('pyrite', INCLUSION_CONFIDENCE_THRESHOLD), inc('quartz', INCLUSION_CONFIDENCE_THRESHOLD - 0.1)] });
    expect(inclusionCounts(r, l)).toEqual({ predicted: 2, truePositive: 1, labeled: 2, found: 1 });
  });
  it('no confident inclusions → precision null, recall 0', () => {
    const s = summarizeScan([scanOutcome(result(), l, meta, 'main')]);
    expect(s.inclusionPrecision).toBeNull();
    expect(s.inclusionRecall).toBe(0);
  });
});

describe('percentages regex (ai-pipeline §11 п.7)', () => {
  it('detects "30%", "30 %", "процентов", "percent" in lore/evidence/notes', () => {
    expect(hasPercentages(result({ lore: 'Около 30% кварца.' }))).toBe(true);
    expect(hasPercentages(result({ lore: 'Около 30 % кварца.' }))).toBe(true);
    expect(hasPercentages(result({ lore: 'Несколько процентов слюды.' }))).toBe(true);
    expect(hasPercentages(result({ revision_note: 'about ten percent feldspar' }))).toBe(true);
    expect(hasPercentages(result({ inclusions: [{ mineral: 'quartz', confidence: 0.7, extent: 'traces', location: null, evidence: 'roughly 5% white grains' }] }))).toBe(true);
    // T4.1 §11 п.7: числительное словами + «процентов», «per cent», неразрывный пробел перед %
    expect(hasPercentages(result({ lore: 'около сорока процентов кварца' }))).toBe(true);
    expect(hasPercentages(result({ lore: 'около 40 процентов кварца' }))).toBe(true);
    expect(hasPercentages(result({ lore: 'about ten per cent mica' }))).toBe(true);
    expect(hasPercentages(result({ lore: 'примерно 30\u00a0% полевого шпата' }))).toBe(true);
  });

  it('does not flag fractions in words, plain numbers or units (T4.1 §11 п.7, no false positives)', () => {
    for (const text of [
      'half quartz, a third feldspar',
      'наполовину кварц, треть полевого шпата',
      'много кварца и немного слюды',
      'около 40 мм в поперечнике, 2 см вкрапленники',
      'SiO2-rich rock with 3 visible veins',
      'уверенность 0.7, 100 метров от берега',
      'преобладает кварц, подчинённо — полевой шпат',
    ]) {
      expect(hasPercentages(result({ lore: text })), text).toBe(false);
      expect(hasPercentages(result({ revision_note: text })), text).toBe(false);
    }
  });
  it('ignores clean text', () => {
    expect(hasPercentages(result({ lore: 'Кварц заметен, слюда — следы. Возраст 300 млн лет.' }))).toBe(false);
  });
});

describe('traps', () => {
  const schist = label({ id: 'tr-01', rock_class: 'schist', inclusions: [{ mineral: 'mica', extent: 'dominant' }], trap: 'mica_vs_pyrite', decoy: { mineral: 'pyrite' } });
  const inc = (mineral: ScanResult['inclusions'][number]['mineral'], confidence: number) => ({ mineral, confidence, extent: 'noticeable' as const, location: null, evidence: 'metallic cubes' });
  it('null for non-traps', () => {
    expect(trapPassed(result(), label())).toBeNull();
  });
  it('fails when the decoy mineral is claimed with confidence ≥ threshold', () => {
    expect(trapPassed(result({ primary: 'schist', inclusions: [inc('pyrite', 0.8)] }), schist)).toBe(false);
    expect(trapPassed(result({ primary: 'schist', inclusions: [inc('pyrite', 0.3), inc('muscovite', 0.9)] }), schist)).toBe(true);
  });
  it('fails on the decoy rock class', () => {
    const concrete = label({ id: 'tr-07', is_rock: false, rock_class: 'unknown', trap: 'concrete_vs_limestone', decoy: { rock_class: 'limestone' } });
    expect(trapPassed(result({ primary: 'limestone', confidence: 0.9 }), concrete)).toBe(false);
    expect(trapPassed(result({ primary: 'unknown', confidence: 0.4 }), concrete)).toBe(true);
    expect(isConfidentError(result({ primary: 'limestone', confidence: 0.9 }), concrete)).toBe(true);
  });
});

describe('summaries', () => {
  it('scan summary aggregates rates, cost and latency; failed calls excluded from rates', () => {
    const outcomes = [
      scanOutcome(result({ primary: 'basalt', confidence: 0.9 }), label(), { ...meta, latencyMs: 1000 }, 'main'),
      scanOutcome(result({ primary: 'granite', confidence: 0.9, lore: '40% кварца' }), label({ id: 'vc-02' }), { ...meta, latencyMs: 3000, costUsd: 0.03 }, 'main'),
      failedOutcome('vc-03', 'main', { ...meta, costUsd: 0 }, label({ id: 'vc-03' })),
    ];
    const s = summarizeScan(outcomes.filter((o): o is Extract<typeof o, { stage: 'main' }> => o.stage === 'main'));
    expect(s.n).toBe(3);
    expect(s.okCalls).toBe(2);
    expect(s.failedCalls).toBe(1);
    expect(s.top1).toBe(0.5);
    expect(s.confidentErrorRate).toBe(0.5);
    expect(s.percentagesRate).toBe(0.5);
    expect(s.costMeanUsd).toBeCloseTo(0.02);
    expect(s.latencyP50).toBe(1000);
    expect(s.latencyP95).toBe(3000);
    expect(s.trapN).toBe(0);
    expect(s.trapAccuracy).toBeNull();
    expect(s.top1ByGroup.volcanic_coast).toEqual({ n: 2, top1: 0.5 });
    expect(s.percentageIds).toEqual(['vc-02']);
  });
  it('non-rock items (concrete, glass) are excluded from top-1/precision/confident errors and counted separately; traps form their own group', () => {
    const glass = label({ id: 'tr-10', is_rock: false, rock_class: 'unknown', trap: 'glass_vs_quartz', decoy: { rock_class: 'quartz_vein', mineral: 'quartz' } });
    const schist = label({ id: 'tr-01', rock_class: 'schist', trap: 'mica_vs_pyrite', decoy: { mineral: 'pyrite' } });
    const outcomes = [
      scanOutcome(result({ primary: 'quartz_vein', confidence: 0.9 }), glass, meta, 'main'),
      scanOutcome(result({ primary: 'schist', confidence: 0.9 }), schist, meta, 'main'),
      scanOutcome(result({ primary: 'basalt', confidence: 0.9 }), label(), meta, 'main'),
    ];
    const s = summarizeScan(outcomes);
    expect(s.top1).toBe(1); // стекло не в знаменателе
    expect(s.confidentErrorRate).toBe(0);
    expect(s.nonRock).toEqual({ n: 1, namedRock: 1 });
    expect(s.trapN).toBe(2);
    expect(s.trapAccuracy).toBe(0.5); // стекло названо кварцем — ловушка провалена
    expect(s.top1ByGroup).toEqual({ trap: { n: 1, top1: 1 }, volcanic_coast: { n: 1, top1: 1 } });
    const unknownGlass = summarizeScan([scanOutcome(result({ primary: 'unknown', confidence: 0.9 }), glass, meta, 'main')]);
    expect(unknownGlass.nonRock).toEqual({ n: 1, namedRock: 0 });
    expect(unknownGlass.top1).toBeNull();
  });
  it('escalation summary reports changed primary rate', () => {
    const prior = result({ primary: 'gabbro' });
    const o1 = scanOutcome(result({ primary: 'basalt' }), label(), meta, 'escalation', prior);
    const o2 = scanOutcome(result({ primary: 'gabbro' }), label({ id: 'vc-02' }), meta, 'escalation', prior);
    expect(summarizeScan([o1, o2]).changedPrimaryRate).toBe(0.5);
  });
  it('gate summary: is_rock accuracy honours label.is_rock', () => {
    const outcomes = [
      gateOutcome({ is_rock: true, quality: 'ok', multiple_objects: false }, { id: 'a', is_rock: true }, meta),
      gateOutcome({ is_rock: true, quality: 'blurry', multiple_objects: false }, { id: 'b', is_rock: false }, meta),
      gateOutcome({ is_rock: false, quality: 'screen_photo', multiple_objects: false }, { id: 'c', is_rock: false }, meta),
    ];
    const s = summarizeGate(outcomes);
    expect(s.isRockAccuracy).toBeCloseTo(2 / 3);
    expect(s.qualityOkRate).toBeCloseTo(1 / 3);
  });
  it('percentile', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
});

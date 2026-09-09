import { describe, expect, it } from 'vitest';
import { identificationBand, identificationCandidates } from './identification.js';
import type { ScanResult } from './scan-result.js';

function res(primary: ScanResult['rock_class']['primary'], confidence: number, alternatives: ScanResult['rock_class']['alternatives'] = []): ScanResult {
  return {
    rock_class: { primary, confidence, alternatives },
    inclusions: [],
    shape: { tags: [], natural_hole: false, recognizable_silhouette: null },
    surface: 'weathered',
    provenance: { matches_local_geology: true, wanderer_mechanism: null },
    split_recommendation: { recommended: false, reason: null },
    lore: '',
    flags: [],
    revision_note: null,
  };
}

describe('identificationCandidates', () => {
  it('туф 65 / андезит 20 / базальт 10 / другое 5', () => {
    const id = identificationCandidates(res('tuff', 0.65, [
      { name: 'andesite', confidence: 0.2, reason: 'plagioclase laths' },
      { name: 'basalt', confidence: 0.1, reason: null },
    ]));
    expect(id.candidates.map((c) => [c.rock_class, c.percent])).toEqual([['tuff', 65], ['andesite', 20], ['basalt', 10], ['other', 5]]);
    expect(id.candidates[0]!.is_primary).toBe(true);
    expect(id.candidates[1]!.reason).toBe('plagioclase laths');
    expect(id.band).toBe('likely');
  });
  it('сумма всегда 100, округление до 5', () => {
    const id = identificationCandidates(res('basalt', 0.78, [{ name: 'andesite', confidence: 0.17, reason: null }, { name: 'gabbro', confidence: 0.02, reason: null }]));
    expect(id.candidates.reduce((s, c) => s + c.percent, 0)).toBe(100);
    for (const c of id.candidates) expect(c.percent % 5).toBe(0);
    expect(id.candidates.find((c) => c.rock_class === 'gabbro')).toBeUndefined(); // 2 % → округляется в 0 → в «другое»
  });
  it('нормализует, если сумма > 1, и primary остаётся первым', () => {
    const id = identificationCandidates(res('granite', 0.6, [{ name: 'granodiorite', confidence: 0.6, reason: null }]));
    expect(id.candidates[0]!.rock_class).toBe('granite');
    expect(id.candidates.reduce((s, c) => s + c.percent, 0)).toBe(100);
  });
  it('дубликат primary в alternatives отбрасывается; больше 5 кандидатов не бывает', () => {
    const id = identificationCandidates(res('basalt', 0.5, [
      { name: 'basalt', confidence: 0.3, reason: null },
      { name: 'andesite', confidence: 0.1, reason: null },
      { name: 'gabbro', confidence: 0.1, reason: null },
      { name: 'diabase', confidence: 0.1, reason: null },
      { name: 'scoria', confidence: 0.1, reason: null },
      { name: 'tuff', confidence: 0.1, reason: null },
    ]));
    expect(id.candidates.filter((c) => c.rock_class === 'basalt')).toHaveLength(1);
    expect(id.candidates.filter((c) => c.rock_class !== 'other').length).toBeLessThanOrEqual(5);
  });
  it('primary всегда ≥ любого другого кандидата после округления', () => {
    const id = identificationCandidates(res('basalt', 0.34, [{ name: 'andesite', confidence: 0.33, reason: null }, { name: 'gabbro', confidence: 0.33, reason: null }]));
    const [p, ...rest] = id.candidates;
    expect(p!.rock_class).toBe('basalt');
    for (const c of rest) expect(p!.percent).toBeGreaterThanOrEqual(c.percent);
    expect(id.candidates.reduce((s, c) => s + c.percent, 0)).toBe(100);
  });
  it('primary не бывает 0 %', () => {
    const id = identificationCandidates(res('basalt', 0.02, []));
    expect(id.candidates[0]).toMatchObject({ rock_class: 'basalt', percent: 5 });
    expect(id.candidates[1]).toMatchObject({ rock_class: 'other', percent: 95 });
  });
  it('band по порогам', () => {
    expect(identificationBand(0.8)).toBe('sure');
    expect(identificationBand(0.79)).toBe('likely');
    expect(identificationBand(0.59)).toBe('unsure');
  });
  it('одинаковый вход → одинаковый выход (детерминизм)', () => {
    const a = identificationCandidates(res('tuff', 0.65, [{ name: 'andesite', confidence: 0.2, reason: null }]));
    const b = identificationCandidates(res('tuff', 0.65, [{ name: 'andesite', confidence: 0.2, reason: null }]));
    expect(a).toEqual(b);
  });
});

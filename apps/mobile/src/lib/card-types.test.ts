import { describe, expect, it } from 'vitest';
import { parseBreakdown, parseCardRow, parseIdentificationMeta, parseScanRow } from './card-types';

describe('parseCardRow', () => {
  it('минимальная строка: null tier/score, пустые jsonb, verification по умолчанию', () => {
    const c = parseCardRow({ id: 'c', scan_id: 's', rock_class: 'basalt', tier: null, score: null, score_breakdown: null, inclusions: null, shape: null, state: 'closed', verification: 'weird' });
    expect(c).toMatchObject({ id: 'c', tier: null, score: null, score_breakdown: null, inclusions: [], shape: {}, verification: 'ai', hidden: false, provisional: false });
  });
  it('мусор → null; неизвестный тир → null', () => {
    expect(parseCardRow(null)).toBeNull();
    expect(parseCardRow({ id: 'c' })).toBeNull();
    expect(parseCardRow({ id: 'c', scan_id: 's', rock_class: 'basalt', tier: 'mythic' })?.tier).toBeNull();
    expect(parseCardRow({ id: 'c', scan_id: 's', rock_class: 'basalt', tier: 'epic' })?.tier).toBe('epic');
  });
});

describe('split_recommended из breakdown.meta (T2.1)', () => {
  it('есть поле → boolean; нет → null (тогда читаем scan_results)', () => {
    const base = { id: 'c', scan_id: 's', rock_class: 'basalt' };
    expect(parseCardRow({ ...base, score_breakdown: { meta: { split_recommendation: { recommended: true, reason: 'x' } } } })?.split_recommended).toBe(true);
    expect(parseCardRow({ ...base, score_breakdown: { meta: { split_recommendation: { recommended: false, reason: null } } } })?.split_recommended).toBe(false);
    expect(parseCardRow({ ...base, score_breakdown: { shape: {} } })?.split_recommended).toBeNull();
    expect(parseCardRow({ ...base, score_breakdown: null })?.split_recommended).toBeNull();
  });
  it('split_delta из breakdown; отсутствует/не число → null', () => {
    const base = { id: 'c', scan_id: 's', rock_class: 'basalt', score: 41 };
    expect(parseCardRow({ ...base, score_breakdown: { split_from: 'p', split_delta: 18 } })?.split_delta).toBe(18);
    expect(parseCardRow({ ...base, score_breakdown: { split_from: 'p', split_delta: null } })?.split_delta).toBeNull();
    expect(parseCardRow({ ...base, score_breakdown: {} })?.split_delta).toBeNull();
  });
});

describe('parseBreakdown / parseScanRow', () => {
  it('breakdown без одного из слоёв → null; с полными слоями → структура', () => {
    expect(parseBreakdown({ shape: { points: 3 } })).toBeNull();
    const b = parseBreakdown({
      shape: { points: 3, reason: 'plain' }, place: { points: 5, reason: 'match', mechanism: null },
      composition: { points: 10, base: { points: 10, reason: 'common', share: 0.3 }, inclusions: [{ mineral: 'quartz', extent: 'traces', base: 3, multiplier: 1, points: 3 }], raw: 13, capped: false },
      quality: { points: 0, fresh_split: false, scale_photo: false, user_tests: false },
    });
    expect(b?.composition.inclusions[0]?.mineral).toBe('quartz');
    expect(b?.place.reason).toBe('match');
  });
  it('scan: неизвестный stage → preflight', () => {
    expect(parseScanRow({ id: 's', stage: 'bogus', error: null })?.stage).toBe('preflight');
    expect(parseScanRow({ id: 's', stage: 'failed', error: 'not_rock' })).toMatchObject({ stage: 'failed', error: 'not_rock' });
  });
});

describe('parseIdentificationMeta — кандидаты из breakdown.meta (T5.0)', () => {
  const alt = [{ name: 'andesite', confidence: 0.15, reason: 'plagioclase laths' }];
  it('rock_class карточки + meta.confidence/alternatives → rock_class-вход по zod-схеме shared', () => {
    expect(parseIdentificationMeta('basalt', { meta: { confidence: 0.8, alternatives: alt } })).toEqual({ primary: 'basalt', confidence: 0.8, alternatives: alt });
    // Без alternatives (воркер до T5.0 их не писал) — пустой список по умолчанию схемы.
    expect(parseIdentificationMeta('basalt', { meta: { confidence: 0.8 } })).toEqual({ primary: 'basalt', confidence: 0.8, alternatives: [] });
  });
  it('нет meta / нет confidence / не по схеме → null', () => {
    expect(parseIdentificationMeta('basalt', null)).toBeNull();
    expect(parseIdentificationMeta('basalt', { shape: {} })).toBeNull();
    expect(parseIdentificationMeta('basalt', { meta: { alternatives: alt } })).toBeNull();
    expect(parseIdentificationMeta('kryptonite', { meta: { confidence: 0.8 } })).toBeNull();
    expect(parseIdentificationMeta('basalt', { meta: { confidence: 1.4 } })).toBeNull();
    expect(parseIdentificationMeta('basalt', { meta: { confidence: 0.8, alternatives: [{ name: 'kryptonite', confidence: 0.1 }] } })).toBeNull();
  });
  it('parseCardRow кладёт identification рядом с split_recommended', () => {
    const base = { id: 'c', scan_id: 's', rock_class: 'basalt' };
    expect(parseCardRow({ ...base, score_breakdown: { meta: { confidence: 0.6, alternatives: alt } } })?.identification).toEqual({ primary: 'basalt', confidence: 0.6, alternatives: alt });
    expect(parseCardRow({ ...base, score_breakdown: { meta: { split_recommendation: { recommended: true } } } })?.identification).toBeNull();
    expect(parseCardRow({ ...base, score_breakdown: null })?.identification).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { ScanResultRow } from './card-types';
import { splitRecommended, versionHistory } from './history';

const valid = (over: Record<string, unknown> = {}) => ({
  rock_class: { primary: 'basalt', confidence: 0.8, alternatives: [] },
  inclusions: [],
  shape: { tags: ['rounded'], natural_hole: false, recognizable_silhouette: null },
  surface: 'weathered',
  provenance: { matches_local_geology: true, wanderer_mechanism: null },
  split_recommendation: { recommended: true, reason: 'plain outside' },
  lore: 'Лава.',
  flags: [],
  revision_note: null,
  ...over,
});
const row = (stage: ScanResultRow['stage'], raw_json: unknown, provider = 'anthropic'): ScanResultRow => ({ scan_id: 's', stage, provider, model: 'm', raw_json, created_at: '2026-09-07T10:00:00Z' });

describe('versionHistory', () => {
  it('main → escalation с revision_note и русской породой', () => {
    const h = versionHistory([
      row('escalation', valid({ rock_class: { primary: 'andesite', confidence: 0.7, alternatives: [] }, revision_note: 'Плагиоклаз виден.' })),
      row('gate', { is_rock: true }),
      row('main', valid()),
    ]);
    expect(h.map((v) => v.stage)).toEqual(['main', 'escalation']);
    expect(h[0]).toMatchObject({ title: 'Первичное определение', rockClassRu: 'Базальт', note: null });
    expect(h[1]).toMatchObject({ title: 'Уточнение', rockClassRu: 'Андезит', note: 'Плагиоклаз виден.' });
  });
  it('невалидный raw_json — мягко: порода и заметка читаются, если есть', () => {
    const h = versionHistory([row('main', { rock_class: { primary: 'granite' }, revision_note: 'x' })]);
    expect(h[0]).toMatchObject({ rockClass: 'granite', rockClassRu: 'Гранит', note: 'x' });
    expect(versionHistory([row('main', 'garbage')])[0]?.rockClass).toBeNull();
  });
});

describe('splitRecommended', () => {
  it('модель рекомендует и правила согласны (плоская галька без включений) → true', () => {
    expect(splitRecommended([row('main', valid())])).toBe(true);
  });
  it('правила против (свежий скол / агат / есть включения) → false, даже если модель за', () => {
    expect(splitRecommended([row('main', valid({ surface: 'fresh_split' }))])).toBe(false);
    expect(splitRecommended([row('main', valid({ rock_class: { primary: 'agate', confidence: 0.9, alternatives: [] } }))])).toBe(false);
    expect(splitRecommended([row('main', valid({ inclusions: [{ mineral: 'zeolite', confidence: 0.9, extent: 'noticeable', location: null, evidence: 'e' }] }))])).toBe(false);
  });
  it('последний вердикт важнее: escalation перекрывает main', () => {
    expect(splitRecommended([row('main', valid()), row('escalation', valid({ split_recommendation: { recommended: false, reason: null } }))])).toBe(false);
  });
  it('raw_json воркера { result, meta } — разворачивается; used_fallback → пометка', () => {
    const wrapped = row('main', { result: valid(), meta: { used_fallback: true, fallback_reason: 'breaker', repaired: false, attempts: 2 } });
    expect(splitRecommended([wrapped])).toBe(true);
    expect(versionHistory([wrapped])[0]).toMatchObject({ rockClassRu: 'Базальт', usedFallback: true });
    expect(versionHistory([row('main', valid())])[0]?.usedFallback).toBe(false);
  });
  it('raw_json не по схеме → поле модели; нет строк → false', () => {
    expect(splitRecommended([row('main', { split_recommendation: { recommended: true } })])).toBe(true);
    expect(splitRecommended([row('main', { split_recommendation: { recommended: false } })])).toBe(false);
    expect(splitRecommended([])).toBe(false);
  });
});

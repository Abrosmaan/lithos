import { describe, expect, it } from 'vitest';
import type { ScanResultRow } from './card-types';
import {
  candidateLabel, candidatesSummary, cardIdentification, IDENTIFICATION_NOTE, identificationBefore, identificationHeadline, latestIdentification,
} from './identification-view';

const valid = (over: Record<string, unknown> = {}) => ({
  rock_class: { primary: 'basalt', confidence: 0.8, alternatives: [] },
  inclusions: [],
  shape: { tags: ['rounded'], natural_hole: false, recognizable_silhouette: null },
  surface: 'weathered',
  provenance: { matches_local_geology: true, wanderer_mechanism: null },
  split_recommendation: { recommended: false, reason: null },
  lore: 'Лава.',
  flags: [],
  revision_note: null,
  ...over,
});
const rc = (primary: string, confidence: number, alternatives: { name: string; confidence: number; reason?: string | null }[] = []) => ({ rock_class: { primary, confidence, alternatives } });
const row = (stage: ScanResultRow['stage'], raw_json: unknown): ScanResultRow => ({ scan_id: 's', stage, provider: 'anthropic', model: 'm', raw_json, created_at: '2026-09-07T10:00:00Z' });

describe('identificationHeadline', () => {
  it('три формулировки по band, порода со строчной внутри фразы', () => {
    expect(identificationHeadline('sure', 'Базальт')).toBe('Уверены: это базальт');
    expect(identificationHeadline('likely', 'Базальт')).toBe('Скорее всего базальт');
    expect(identificationHeadline('unsure', 'Базальт')).toBe('Похоже на базальт, но не уверены');
  });
});

describe('candidateLabel', () => {
  it('«название · N %» с неразрывным пробелом перед %', () => {
    expect(candidateLabel({ name_ru: 'Базальт', percent: 80 })).toBe("Базальт · 80\u00A0%");
  });
});

describe('latestIdentification', () => {
  it("старая карточка без alternatives → primary X % + «другое» (честно, не 100\u00A0%)", () => {
    const v = latestIdentification([row('main', valid())]);
    expect(v).not.toBeNull();
    expect(v!.candidates.map((c) => [c.rock_class, c.percent])).toEqual([['basalt', 80], ['other', 20]]);
    expect(v!.candidates[0]).toMatchObject({ is_primary: true, label: "Базальт · 80\u00A0%", accessibilityLabel: 'Базальт: 80 процентов, основной вариант' });
    expect(v!.candidates[1]!.name_ru).toBe('другое');
    expect(v!.candidates.reduce((s, c) => s + c.percent, 0)).toBe(100);
    expect(v!).toMatchObject({ band: 'sure', primary: 'basalt', primaryName: 'Базальт', headline: 'Уверены: это базальт', source: 'main' });
  });
  it('кандидаты с reason: подпись и a11y-строка; «другое» последним', () => {
    const v = latestIdentification([row('main', valid(rc('tuff', 0.65, [
      { name: 'andesite', confidence: 0.2, reason: 'plagioclase laths' },
      { name: 'basalt', confidence: 0.1, reason: null },
    ])))]);
    expect(v!.candidates.map((c) => c.label)).toEqual(["Туф · 65\u00A0%", "Андезит · 20\u00A0%", "Базальт · 10\u00A0%", "другое · 5\u00A0%"]);
    expect(v!.candidates[1]).toMatchObject({ reason: 'plagioclase laths', accessibilityLabel: 'Андезит: 20 процентов. plagioclase laths' });
    expect(v!.candidates[2]!.accessibilityLabel).toBe('Базальт: 10 процентов');
    expect(v!.candidates.at(-1)!.rock_class).toBe('other');
    expect(v!).toMatchObject({ band: 'likely', headline: 'Скорее всего туф' });
  });
  it('последний вердикт важнее: escalation перекрывает main; raw_json воркера { result, meta } разворачивается', () => {
    const v = latestIdentification([
      row('main', valid()),
      row('escalation', { result: valid(rc('andesite', 0.55)), meta: { used_fallback: false } }),
    ]);
    expect(v).toMatchObject({ primary: 'andesite', source: 'escalation', band: 'unsure', headline: 'Похоже на андезит, но не уверены' });
  });
  it('невалидная escalation → берём main; ничего валидного → null', () => {
    expect(latestIdentification([row('main', valid()), row('escalation', 'garbage')])).toMatchObject({ primary: 'basalt', source: 'main' });
    expect(latestIdentification([row('main', { rock_class: { primary: 'granite' } })])).toBeNull();
    expect(latestIdentification([row('gate', { is_rock: true })])).toBeNull();
    expect(latestIdentification([])).toBeNull();
  });
});

describe('cardIdentification', () => {
  const meta = { primary: 'basalt', confidence: 0.7, alternatives: [{ name: 'andesite', confidence: 0.2, reason: null }] } as const;
  it('meta карточки — главный источник: без scan_results, primary = rock_class, source card', () => {
    const v = cardIdentification({ rock_class: 'basalt', identification: { ...meta, alternatives: [...meta.alternatives] } }, null);
    expect(v).toMatchObject({ source: 'card', primary: 'basalt', band: 'likely', headline: 'Скорее всего базальт' });
    expect(v!.candidates.map((c) => c.label)).toEqual(["Базальт · 70\u00A0%", "Андезит · 20\u00A0%", "другое · 10\u00A0%"]);
    // Даже если scan_results уже от другого вердикта — карточка важнее (список согласован с заголовком).
    const rows = [row('escalation', valid(rc('granite', 0.9)))];
    expect(cardIdentification({ rock_class: 'basalt', identification: { ...meta, alternatives: [] } }, rows)).toMatchObject({ source: 'card', primary: 'basalt' });
  });
  it('без meta — запасной путь по scan_results, и только если primary совпадает с rock_class карточки', () => {
    expect(cardIdentification({ rock_class: 'basalt', identification: null }, null)).toBeNull();
    expect(cardIdentification({ rock_class: 'basalt', identification: null }, [])).toBeNull();
    expect(cardIdentification({ rock_class: 'basalt', identification: null }, [row('main', valid())])).toMatchObject({ source: 'main', primary: 'basalt' });
    // Гонка: scan_results уже от escalation (андезит), карточка ещё от main (базальт) → списка нет, порода строкой.
    expect(cardIdentification({ rock_class: 'basalt', identification: null }, [row('main', valid()), row('escalation', valid(rc('andesite', 0.7)))])).toBeNull();
  });
});

describe('identificationBefore', () => {
  it('списки main и escalation отличаются → «было: …» по main', () => {
    const before = identificationBefore([
      row('main', valid(rc('basalt', 0.6, [{ name: 'andesite', confidence: 0.3 }]))),
      row('escalation', valid(rc('andesite', 0.7, [{ name: 'basalt', confidence: 0.2 }]))),
    ]);
    expect(before).toBe("было: Базальт · 60\u00A0%, Андезит · 30\u00A0%, другое · 10\u00A0%");
  });
  it('одинаковые списки (reason не в счёт) или нет уточнения → null', () => {
    const a = valid(rc('basalt', 0.8, [{ name: 'andesite', confidence: 0.1, reason: 'x' }]));
    const b = valid(rc('basalt', 0.8, [{ name: 'andesite', confidence: 0.1, reason: 'y' }]));
    expect(identificationBefore([row('main', a), row('escalation', b)])).toBeNull();
    expect(identificationBefore([row('main', a)])).toBeNull();
    expect(identificationBefore([row('escalation', b)])).toBeNull();
    expect(identificationBefore([row('main', 'garbage'), row('escalation', b)])).toBeNull();
  });
});

describe('candidatesSummary / note', () => {
  it('сводка через запятую; подпись говорит о вероятности определения, не составе', () => {
    const v = latestIdentification([row('main', valid())])!;
    expect(candidatesSummary(v)).toBe("Базальт · 80\u00A0%, другое · 20\u00A0%");
    expect(IDENTIFICATION_NOTE).toContain('не состав');
    expect(IDENTIFICATION_NOTE).toContain('от процентов не зависит');
  });
});

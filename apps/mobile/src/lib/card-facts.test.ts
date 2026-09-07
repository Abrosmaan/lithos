import { COMPOSITION_LAYER_MAX, PLACE_LAYER_MAX, QUALITY_LAYER_MAX, SHAPE_LAYER_MAX, type ScoreBreakdown } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import { cardFacts, describeBreakdown, displayName, formatCoords, formatDateRu, formatScoreDelta, inclusionLines, splitDelta, tierLabel } from './card-facts';

function breakdown(over: Partial<{ shape: ScoreBreakdown['shape']; place: ScoreBreakdown['place']; composition: ScoreBreakdown['composition']; quality: ScoreBreakdown['quality'] }> = {}): ScoreBreakdown {
  return {
    shape: { points: 3, reason: 'plain' },
    place: { points: 5, reason: 'match', mechanism: null },
    composition: { points: 10, base: { points: 10, reason: 'common', share: 0.3 }, inclusions: [], raw: 10, capped: false },
    quality: { points: 2, fresh_split: false, scale_photo: true, user_tests: false },
    ...over,
  };
}

describe('cardFacts — три главных факта', () => {
  it('порода с группой, форма (нет включений), соответствие месту', () => {
    const [rock, second, place] = cardFacts({ rock_class: 'basalt', score_breakdown: breakdown() });
    expect(rock).toEqual({ label: 'Порода', value: 'Базальт · магматическая' });
    expect(second).toEqual({ label: 'Форма', value: 'Обычная галька' });
    expect(place).toEqual({ label: 'Место', value: 'Соответствует геологии места' });
  });

  it('главное включение — с максимальными баллами, extent по-русски без процентов', () => {
    const b = breakdown({
      composition: {
        points: 30, raw: 30, capped: false, base: { points: 10, reason: 'common', share: 0.3 },
        inclusions: [
          { mineral: 'quartz', extent: 'dominant', base: 12, multiplier: 1, points: 12 },
          { mineral: 'zeolite', extent: 'noticeable', base: 7, multiplier: 1.5, points: 10.5 },
        ],
      },
    });
    const [, second] = cardFacts({ rock_class: 'amygdaloidal_basalt', score_breakdown: b });
    expect(second).toEqual({ label: 'Включение', value: 'Кварц — основной' });
    expect(second.value).not.toMatch(/%/);
  });

  it('странник с механизмом; куриный бог; без гео; неизвестная порода', () => {
    const wanderer = breakdown({ place: { points: 20, reason: 'wanderer', mechanism: 'glacial_erratic' }, shape: { points: 20, reason: 'natural_hole' } });
    const f = cardFacts({ rock_class: 'granite', score_breakdown: wanderer });
    expect(f[1].value).toMatch(/куриный бог/);
    expect(f[2].value).toBe('Странник: принесён ледником');

    const noGeo = cardFacts({ rock_class: 'unknown', score_breakdown: null });
    expect(noGeo[0].value).toBe('Неопределённая порода · группа не определена');
    expect(noGeo[1].value).toBe('Обычная галька');
    expect(noGeo[2].value).toMatch(/Без геопозиции/);

    const weird = cardFacts({ rock_class: 'moon_rock', score_breakdown: null });
    expect(weird[0].value).toMatch(/^Неопределённая порода/);
  });
});

describe('describeBreakdown — четыре слоя', () => {
  it('потолки из shared, баллы из breakdown, причины по-русски', () => {
    const b = breakdown({
      composition: {
        points: COMPOSITION_LAYER_MAX, raw: 52, capped: true, base: { points: 40, reason: 'fossil', share: null },
        inclusions: [{ mineral: 'pyrite', extent: 'traces', base: 3, multiplier: 1.3, points: 3.9 }],
      },
      quality: { points: 8, fresh_split: true, scale_photo: true, user_tests: false },
    });
    const layers = describeBreakdown(b);
    expect(layers.map((l) => l.key)).toEqual(['shape', 'place', 'composition', 'quality']);
    expect(layers.map((l) => l.max)).toEqual([SHAPE_LAYER_MAX, PLACE_LAYER_MAX, COMPOSITION_LAYER_MAX, QUALITY_LAYER_MAX]);
    expect(layers[2]?.points).toBe(COMPOSITION_LAYER_MAX);
    const comp = layers[2]?.lines.map((l) => l.text) ?? [];
    expect(comp[0]).toBe('Окаменелость — редка везде');
    expect(comp[1]).toBe('Пирит — следы ×1.3');
    expect(comp.at(-1)).toBe('Потолок слоя (было 52)');
    const q = layers[3]?.lines.map((l) => l.text) ?? [];
    expect(q).toEqual(['Свежий скол — интерьер виден', 'Есть фото с масштабом', 'Мини-тесты не пройдены']);
    for (const l of layers) for (const line of l.lines) expect(/[а-яё]/i.test(line.text)).toBe(true);
  });

  it('неизвестная причина от воркера → русский фолбэк, не enum', () => {
    const b = breakdown({ shape: { points: 25, reason: 'new_row' as never } });
    b.composition.base.reason = 'weird' as never;
    const layers = describeBreakdown(b);
    expect(layers[0]?.lines[0]?.text).toBe('Причина не указана');
    expect(layers[2]?.lines[0]?.text).toBe('Причина не указана');
    b.place.reason = 'new_place' as never;
    expect(describeBreakdown(b)[1]?.lines[0]?.text).toBe('Причина не указана');
  });
});

describe('formatScoreDelta', () => {
  it('«было 23 → стало 41», знак и модуль', () => {
    expect(formatScoreDelta(23, 41)).toEqual({ text: 'было 23 → стало 41 (+18)', sign: 'up' });
    expect(formatScoreDelta(41, 23)).toEqual({ text: 'было 41 → стало 23 (−18)', sign: 'down' });
    expect(formatScoreDelta(30, 30)).toEqual({ text: 'было 30 → стало 30 (без изменений)', sign: 'same' });
  });
  it('splitDelta: breakdown.split_delta важнее родителя; без него — по родителю; без обоих — null', () => {
    expect(splitDelta({ score: 41, split_delta: 18 }, 99)?.text).toBe('было 23 → стало 41 (+18)');
    expect(splitDelta({ score: 41, split_delta: null }, 23)?.text).toBe('было 23 → стало 41 (+18)');
    expect(splitDelta({ score: 41, split_delta: null }, undefined)).toBeNull();
    expect(splitDelta({ score: null, split_delta: 5 }, 23)).toBeNull();
  });
  it('без score у одной из карточек — дельты нет', () => {
    expect(formatScoreDelta(null, 41)).toBeNull();
    expect(formatScoreDelta(23, null)).toBeNull();
  });
});

describe('подписи', () => {
  it('тир: русское имя, «?» на ревью, «Без редкости» без гео', () => {
    expect(tierLabel('rare')).toBe('Редкий');
    expect(tierLabel('rare', 'pending_review')).toBe('?');
    expect(tierLabel(null)).toBe('Без редкости');
  });
  it('имя: своё → автоген → порода', () => {
    expect(displayName({ user_name: ' Мой ', name: 'Базальт, Гонио', rock_class: 'basalt' })).toBe('Мой');
    expect(displayName({ user_name: '  ', name: 'Базальт, Гонио', rock_class: 'basalt' })).toBe('Базальт, Гонио');
    expect(displayName({ user_name: null, name: null, rock_class: 'basalt' })).toBe('Базальт');
  });
  it('состав, дата, координаты', () => {
    expect(inclusionLines([{ mineral: 'zeolite', confidence: 0.7, extent: 'noticeable', location: null, evidence: '' }])).toEqual(['Цеолит — заметно']);
    expect(formatDateRu('2026-09-07T10:00:00Z')).toMatch(/^7 сен 2026$/);
    expect(formatDateRu('garbage')).toBeNull();
    expect(formatCoords(41.12346, 41.6)).toBe('41.1235, 41.6000');
    expect(formatCoords(null, 1)).toBeNull();
  });
});

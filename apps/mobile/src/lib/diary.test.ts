import { describe, expect, it } from 'vitest';
import { completedCells, diaryProgress, isCountableRock, parseDiaryRow, parseExpectedRocks } from './diary';

describe('diaryProgress', () => {
  it('приёмка T3.1: три скана в одной точке закрывают 3 позиции из N', () => {
    const expected = ['limestone', 'andesite', 'tuff', 'basalt', 'granite'];
    const cards = [{ rock_class: 'limestone' }, { rock_class: 'andesite' }, { rock_class: 'tuff' }];
    const p = diaryProgress({ expected, cards });
    expect(p.total).toBe(5);
    expect(p.foundCount).toBe(3);
    expect(p.complete).toBe(false);
    expect(p.items.map((i) => i.found)).toEqual([true, true, true, false, false]);
  });

  it('found из diary объединяется с карточками; повторы не удваивают', () => {
    const p = diaryProgress({ expected: ['limestone', 'basalt'], found: ['basalt'], cards: [{ rock_class: 'basalt' }, { rock_class: 'limestone' }] });
    expect(p.foundCount).toBe(2);
    expect(p.complete).toBe(true);
  });

  it('unknown* не закрывает позицию, находки сверх списка — отдельно', () => {
    const p = diaryProgress({ expected: ['limestone'], cards: [{ rock_class: 'unknown_sedimentary' }, { rock_class: 'pumice' }] });
    expect(p.foundCount).toBe(0);
    expect(p.extra).toEqual(['pumice']);
    expect(isCountableRock('unknown')).toBe(false);
    expect(isCountableRock('basalt')).toBe(true);
    expect(isCountableRock('kryptonite')).toBe(false);
  });

  it('пустой список ожидаемых — не «закрыт»', () => {
    const p = diaryProgress({ expected: [], cards: [{ rock_class: 'basalt' }] });
    expect(p.total).toBe(0);
    expect(p.complete).toBe(false);
  });
});

describe('parse', () => {
  it('diary row: jsonb-массивы строк, мусор отбрасывается', () => {
    const row = parseDiaryRow({ cell_id: 'szms3z', expected: ['limestone', 7, 'limestone'], found: null, updated_at: 'x' });
    expect(row).toEqual({ cell_id: 'szms3z', expected: ['limestone'], found: [], updated_at: 'x' });
    expect(parseDiaryRow({ expected: [] })).toBeNull();
  });
  it('geo_cache.expected_rocks → породы по убыванию доли', () => {
    expect(parseExpectedRocks([{ rock_class: 'basalt', share: 0.2 }, { rock_class: 'limestone', share: 0.7 }, { nope: 1 }])).toEqual(['limestone', 'basalt']);
    expect(parseExpectedRocks('bad')).toEqual([]);
  });
});

describe('completedCells', () => {
  it('ячейка подсвечивается, только если все ожидаемые найдены', () => {
    const diary = [
      { cell_id: 'aaaaaa', expected: ['basalt'], found: ['basalt'], updated_at: '' },
      { cell_id: 'bbbbbb', expected: ['basalt', 'granite'], found: ['basalt'], updated_at: '' },
      { cell_id: 'cccccc', expected: ['tuff'], found: [], updated_at: '' },
      { cell_id: 'dddddd', expected: [], found: [], updated_at: '' },
    ];
    const cards = [{ rock_class: 'tuff', cell_id: 'cccccc' }, { rock_class: 'granite', cell_id: 'zzzzzz' }, { rock_class: 'basalt', cell_id: null }];
    expect(completedCells(diary, cards)).toEqual(['aaaaaa', 'cccccc']);
  });
});

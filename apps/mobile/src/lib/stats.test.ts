import { TIERS } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import { toggleShowcase } from './showcase';
import { rarestCard, tierDistribution } from './stats';

type T = (typeof TIERS)[number] | null;
const c = (id: string, tier: T, score: number | null, day: number, hidden = false) => ({ id, tier, score, hidden, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z` });

describe('tierDistribution', () => {
  it('порядок от легендарного к обычному + без редкости; скрытые не считаются; доли суммируются в 1', () => {
    const d = tierDistribution([c('a', 'common', 1, 1), c('b', 'common', 2, 2), c('c', 'rare', 55, 3), c('d', null, null, 4), c('h', 'epic', 80, 5, true)]);
    expect(d.map((b) => b.tier)).toEqual([...[...TIERS].reverse(), null]);
    expect(d.find((b) => b.tier === 'common')!.count).toBe(2);
    expect(d.find((b) => b.tier === 'epic')!.count).toBe(0);
    expect(d.find((b) => b.tier === null)!.count).toBe(1);
    expect(d.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1);
    expect(d.every((b) => /[а-яё]/i.test(b.label))).toBe(true);
  });
  it('пустая коллекция — нули без NaN', () => {
    expect(tierDistribution([]).every((b) => b.count === 0 && b.share === 0)).toBe(true);
  });
});

describe('rarestCard', () => {
  it('максимум score; при равенстве — более ранняя; скрытые и без score — мимо', () => {
    expect(rarestCard([c('a', 'rare', 55, 1), c('b', 'epic', 80, 2), c('h', 'legendary', 99, 3, true)])!.id).toBe('b');
    expect(rarestCard([c('late', 'rare', 55, 5), c('early', 'rare', 55, 1)])!.id).toBe('early');
    expect(rarestCard([c('n', null, null, 1)])).toBeNull();
  });
});

describe('toggleShowcase', () => {
  it('добавляет, убирает, не превышает лимит', () => {
    expect(toggleShowcase([], 'a', 2)).toEqual({ list: ['a'], status: 'added' });
    expect(toggleShowcase(['a'], 'a', 2)).toEqual({ list: [], status: 'removed' });
    expect(toggleShowcase(['a', 'b'], 'c', 2)).toEqual({ list: ['a', 'b'], status: 'full' });
    expect(toggleShowcase(['a', 'b'], 'a', 2).status).toBe('removed');
  });
});

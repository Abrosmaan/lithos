import { TIERS } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import { countByFilter, filterCards, matchesTier, sortCards, TIER_FILTER_OPTIONS } from './collection';

type T = (typeof TIERS)[number] | null;
const c = (id: string, tier: T, score: number | null, day: number, hidden = false) => ({ id, tier, score, hidden, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z` });

const cards = [
  c('a', 'common', 12, 1),
  c('b', 'rare', 55, 2),
  c('c', null, null, 3),
  c('d', 'legendary', 90, 4),
  c('e', 'rare', 60, 5),
  c('hidden', 'epic', 80, 6, true),
];

describe('filterCards', () => {
  it('скрытые не показываются; фильтр по тиру и «без редкости»', () => {
    expect(filterCards(cards, null).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(filterCards(cards, 'rare').map((x) => x.id)).toEqual(['b', 'e']);
    expect(filterCards(cards, 'none').map((x) => x.id)).toEqual(['c']);
    expect(filterCards(cards, 'epic')).toEqual([]);
    expect(matchesTier({ tier: null }, 'none')).toBe(true);
  });

  it('чипы: «Все», тиры от легендарного к обычному, «Без редкости»', () => {
    expect(TIER_FILTER_OPTIONS[0]!.value).toBeNull();
    expect(TIER_FILTER_OPTIONS.slice(1, -1).map((o) => o.value)).toEqual([...TIERS].reverse());
    expect(TIER_FILTER_OPTIONS.at(-1)!.value).toBe('none');
    const counts = countByFilter(cards);
    expect(counts.get(null)).toBe(5);
    expect(counts.get('rare')).toBe(2);
    expect(counts.get('none')).toBe(1);
  });
});

describe('sortCards', () => {
  const visible = filterCards(cards, null);
  it('новые сверху', () => {
    expect(sortCards(visible, 'newest').map((x) => x.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('по score, без score — в конец', () => {
    expect(sortCards(visible, 'score').map((x) => x.id)).toEqual(['d', 'e', 'b', 'a', 'c']);
  });
  it('по тиру: легендарные сверху, внутри тира — по score, без тира — в конец', () => {
    expect(sortCards(visible, 'tier').map((x) => x.id)).toEqual(['d', 'e', 'b', 'a', 'c']);
    const tie = [c('x', 'rare', 50, 1), c('y', 'rare', 50, 2)];
    expect(sortCards(tie, 'tier').map((x) => x.id)).toEqual(['y', 'x']);
  });
  it('не мутирует вход', () => {
    const copy = [...visible];
    sortCards(visible, 'score');
    expect(visible).toEqual(copy);
  });
});

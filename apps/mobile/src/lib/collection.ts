// Коллекция (spec §8): фильтр по тиру и сортировка — чистые функции. Порядок тиров — из @lithos/shared.
import { type Tier, TIER_RU, TIERS, tierRank } from '@lithos/shared';
import type { CardRow } from './card-types';

export const SORT_MODES = ['newest', 'score', 'tier'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABEL_RU: Record<SortMode, string> = {
  newest: 'Новые',
  score: 'По score',
  tier: 'По тиру',
};

/** Фильтр: конкретный тир, 'none' — карточки без редкости (нет гео), null — все. */
export type TierFilter = Tier | 'none' | null;

export interface TierFilterOption {
  value: TierFilter;
  label: string;
}

/** Чипы фильтра: «Все», тиры от редкого к обычному, «Без редкости». */
export const TIER_FILTER_OPTIONS: readonly TierFilterOption[] = [
  { value: null, label: 'Все' },
  ...[...TIERS].reverse().map((t): TierFilterOption => ({ value: t, label: TIER_RU[t] })),
  { value: 'none', label: 'Без редкости' },
];

type CardLike = Pick<CardRow, 'tier' | 'score' | 'created_at' | 'hidden'>;

export function matchesTier(card: Pick<CardLike, 'tier'>, filter: TierFilter): boolean {
  if (filter === null) return true;
  if (filter === 'none') return card.tier === null;
  return card.tier === filter;
}

/** Видимые карточки (hidden — родители после раскола) с фильтром по тиру. */
export function filterCards<T extends CardLike>(cards: readonly T[], filter: TierFilter): T[] {
  return cards.filter((c) => !c.hidden && matchesTier(c, filter));
}

const byNewest = (a: CardLike, b: CardLike) => Date.parse(b.created_at) - Date.parse(a.created_at);
const rank = (t: Tier | null) => (t === null ? -1 : tierRank(t));

/** Стабильная сортировка: новые; по score (null в конец); по тиру (null в конец) — внутри группы новые сверху. */
export function sortCards<T extends CardLike>(cards: readonly T[], mode: SortMode): T[] {
  const list = [...cards];
  switch (mode) {
    case 'newest':
      return list.sort(byNewest);
    case 'score':
      return list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || byNewest(a, b));
    case 'tier':
      return list.sort((a, b) => rank(b.tier) - rank(a.tier) || (b.score ?? -1) - (a.score ?? -1) || byNewest(a, b));
  }
}

/** Счётчики по чипам (чтобы показывать «Редкий · 3»). */
export function countByFilter<T extends CardLike>(cards: readonly T[]): Map<TierFilter, number> {
  const out = new Map<TierFilter, number>();
  for (const opt of TIER_FILTER_OPTIONS) out.set(opt.value, filterCards(cards, opt.value).length);
  return out;
}

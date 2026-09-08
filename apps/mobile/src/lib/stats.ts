// Статистика профиля (spec §8): распределение по тирам, редчайшая карточка. Чистые функции; список тиров — из shared.
import { type Tier, TIER_RU, TIERS } from '@lithos/shared';
import type { CardRow } from './card-types';

export interface TierBucket {
  tier: Tier | null;
  label: string;
  count: number;
  /** Доля от всех видимых карточек, 0..1 (0 при пустой коллекции). */
  share: number;
}

type CardLike = Pick<CardRow, 'tier' | 'score' | 'created_at' | 'hidden'>;

/** От редкого к обычному + «Без редкости» в конце. Скрытые (родители после раскола) не считаются. */
export function tierDistribution<T extends CardLike>(cards: readonly T[]): TierBucket[] {
  const visible = cards.filter((c) => !c.hidden);
  const counts = new Map<Tier | null, number>();
  for (const c of visible) counts.set(c.tier, (counts.get(c.tier) ?? 0) + 1);
  const order: (Tier | null)[] = [...[...TIERS].reverse(), null];
  return order.map((tier) => {
    const count = counts.get(tier) ?? 0;
    return { tier, label: tier ? TIER_RU[tier] : 'Без редкости', count, share: visible.length ? count / visible.length : 0 };
  });
}

/** Редчайшая карточка — максимум score среди видимых; при равенстве — более ранняя находка. Нет score ни у кого → null. */
export function rarestCard<T extends CardLike>(cards: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of cards) {
    if (c.hidden || c.score === null) continue;
    if (!best || c.score > (best.score ?? -1) || (c.score === best.score && Date.parse(c.created_at) < Date.parse(best.created_at))) best = c;
  }
  return best;
}

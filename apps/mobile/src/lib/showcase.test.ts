import { describe, expect, it } from 'vitest';
import { planShowcaseMigration, toggleShowcase } from './showcase';

type C = { id: string; hidden: boolean; verification: string; published: boolean };
const card = (id: string, over: Partial<Omit<C, 'id'>> = {}): C => ({ id, hidden: false, verification: 'ai', published: false, ...over });

describe('toggleShowcase (локальная витрина, ProfileScreen)', () => {
  it('добавляет, убирает, не превышает лимит', () => {
    expect(toggleShowcase([], 'a', 2)).toEqual({ list: ['a'], status: 'added' });
    expect(toggleShowcase(['a'], 'a', 2)).toEqual({ list: [], status: 'removed' });
    expect(toggleShowcase(['a', 'b'], 'c', 2)).toEqual({ list: ['a', 'b'], status: 'full' });
  });
});

describe('planShowcaseMigration (T6.1 поток E, T6.0 §2.2 — перенос старой витрины)', () => {
  it('предлагает карточки из старого списка, которые сервер примет', () => {
    const cards = [card('a'), card('b'), card('c')];
    expect(planShowcaseMigration(['a', 'c'], cards).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('пропускает hidden (раскол) и pending_review — сервер их отклонит', () => {
    const cards = [card('a', { hidden: true }), card('b', { verification: 'pending_review' }), card('c')];
    expect(planShowcaseMigration(['a', 'b', 'c'], cards).map((c) => c.id)).toEqual(['c']);
  });

  it('пропускает уже опубликованные — предлагать заново нечего', () => {
    const cards = [card('a', { published: true }), card('b')];
    expect(planShowcaseMigration(['a', 'b'], cards).map((c) => c.id)).toEqual(['b']);
  });

  it('id из старого списка, которых больше нет среди карточек (удалены) — молча пропускаются', () => {
    expect(planShowcaseMigration(['gone', 'b'], [card('b')]).map((c) => c.id)).toEqual(['b']);
  });

  it('пустой старый список или пустые карточки → пусто, без ошибок', () => {
    expect(planShowcaseMigration([], [card('a')])).toEqual([]);
    expect(planShowcaseMigration(['a'], [])).toEqual([]);
  });

  it('порядок — как в старом списке, а не как в текущих карточках', () => {
    const cards = [card('b'), card('a')];
    expect(planShowcaseMigration(['a', 'b'], cards).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

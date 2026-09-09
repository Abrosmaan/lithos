import { describe, expect, it } from 'vitest';
import { otherFindPoints } from './public-map';
import type { PublicFindRow } from './publish';

function row(overrides: Partial<PublicFindRow> = {}): PublicFindRow {
  return {
    id: 'find-1',
    rock_class: 'granite',
    tier: 'common',
    score: 12,
    lore: null,
    name: null,
    user_name: null,
    cell_id: 'szrv5f',
    created_at: '2026-09-01T00:00:00Z',
    published_at: '2026-09-01T00:00:00Z',
    author_name: null,
    center: { latitude: 41.674, longitude: 44.823 },
    ...overrides,
  };
}

describe('otherFindPoints', () => {
  it('пусто на входе — пусто на выходе', () => {
    expect(otherFindPoints([], new Set())).toEqual([]);
  });

  it('переносит center в lat/lng для groupByLocation', () => {
    const [p] = otherFindPoints([row()], new Set());
    expect(p).toMatchObject({ id: 'find-1', lat: 41.674, lng: 44.823, cell_id: 'szrv5f' });
  });

  it('отсеивает находки без гео (cell_id/center = null)', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', cell_id: null, center: null })];
    expect(otherFindPoints(rows, new Set()).map((p) => p.id)).toEqual(['a']);
  });

  it('отсеивает собственные публикации по id карточки — не задваивает их как «чужие»', () => {
    const rows = [row({ id: 'mine' }), row({ id: 'theirs' })];
    expect(otherFindPoints(rows, new Set(['mine'])).map((p) => p.id)).toEqual(['theirs']);
  });

  it('несколько находок в одной ячейке получают одинаковый center — группируются вместе выше по стеку', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const points = otherFindPoints(rows, new Set());
    expect(points[0]!.lat).toBe(points[1]!.lat);
    expect(points[0]!.lng).toBe(points[1]!.lng);
  });
});

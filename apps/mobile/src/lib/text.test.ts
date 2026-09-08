import { describe, expect, it } from 'vitest';
import { pluralRu } from './text';

describe('pluralRu', () => {
  it('1/21 — одна форма, 2–4/22–24 — вторая, 5–20/11–14 — третья', () => {
    const f = (n: number) => pluralRu(n, 'точка', 'точки', 'точек');
    expect([1, 21, 101].map(f)).toEqual(['точка', 'точка', 'точка']);
    expect([2, 3, 4, 22, 24].map(f)).toEqual(['точки', 'точки', 'точки', 'точки', 'точки']);
    expect([0, 5, 11, 12, 14, 19, 20, 111].map(f).every((s) => s === 'точек')).toBe(true);
  });
});

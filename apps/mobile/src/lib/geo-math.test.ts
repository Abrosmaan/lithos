import { describe, expect, it } from 'vitest';
import { boundingRegion, farthestFind, fitSpan, formatDistance, groupByLocation, haversineKm, MAX_LAT_DELTA, MAX_LNG_DELTA, MIN_FIT_SPAN } from './geo-math';

const card = (id: string, lat: number | null, lng: number | null, day: number) => ({ id, lat, lng, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z` });

describe('haversineKm', () => {
  it('Москва — Петербург ≈ 634 км, одна точка — 0', () => {
    expect(haversineKm(55.7558, 37.6173, 59.9343, 30.3351)).toBeCloseTo(634, -1);
    expect(haversineKm(10, 20, 10, 20)).toBe(0);
  });
});

describe('farthestFind', () => {
  it('точка отсчёта — первая находка с гео, результат — самая далёкая от неё', () => {
    const cards = [
      card('later-far', 59.9343, 30.3351, 5),
      card('first', 55.7558, 37.6173, 1),
      card('nogeo', null, null, 0),
      card('near', 55.76, 37.62, 3),
    ];
    const r = farthestFind(cards)!;
    expect(r.origin.id).toBe('first');
    expect(r.card.id).toBe('later-far');
    expect(r.km).toBeCloseTo(634, -1);
  });

  it('меньше двух карточек с координатами → null', () => {
    expect(farthestFind([])).toBeNull();
    expect(farthestFind([card('a', 1, 1, 1)])).toBeNull();
    expect(farthestFind([card('a', 1, 1, 1), card('b', null, null, 2)])).toBeNull();
  });
});

describe('formatDistance', () => {
  it('метры до километра, одна десятичная до 10 км, дальше целые', () => {
    expect(formatDistance(0.85)).toBe('850 м');
    expect(formatDistance(2.345)).toBe('2,3 км');
    expect(formatDistance(634.2)).toBe('634 км');
  });
});

describe('boundingRegion', () => {
  it('центр и дельты с запасом; одна точка — минимальное окно; пусто — null', () => {
    const r = boundingRegion([{ lat: 10, lng: 20 }, { lat: 12, lng: 24 }])!;
    expect(r.latitude).toBe(11);
    expect(r.longitude).toBe(22);
    expect(r.latitudeDelta).toBeCloseTo(2.8);
    expect(r.longitudeDelta).toBeCloseTo(5.6);
    const one = boundingRegion([{ lat: 1, lng: 1 }])!;
    expect(one.latitudeDelta).toBe(0.02);
    expect(boundingRegion([])).toBeNull();
  });
  it('антимеридиан: Чукотка и Аляска — узкое окно через 180°, центр нормализован', () => {
    const r = boundingRegion([{ lat: 64.7, lng: 177.5 }, { lat: 64.5, lng: -165.4 }])!;
    expect(r.longitudeDelta).toBeLessThan(30);
    expect(Math.abs(r.longitude)).toBeGreaterThan(170); // центр у 180°, а не посреди Тихого океана (≈ 6°)
    expect(Math.abs(r.longitude)).toBeLessThanOrEqual(180);
  });
  it('дельты ограничены сверху', () => {
    const r = boundingRegion([{ lat: -89, lng: -179 }, { lat: 89, lng: 0 }, { lat: 0, lng: 179 }])!;
    expect(r.latitudeDelta).toBe(MAX_LAT_DELTA);
    expect(r.longitudeDelta).toBeLessThanOrEqual(MAX_LNG_DELTA);
  });
});

describe('fitSpan', () => {
  it('одна точка или пусто — 0 (нечего подгонять, fitToCoordinates не звать)', () => {
    expect(fitSpan([])).toBe(0);
    expect(fitSpan([{ lat: 41.674, lng: 44.823 }])).toBe(0);
  });

  it('две совпадающие точки (дефект 3a — два скана в одном месте) — span ~0, меньше порога', () => {
    const span = fitSpan([{ lat: 41.674, lng: 44.823 }, { lat: 41.674 + 3e-8, lng: 44.823 }]);
    expect(span).toBeLessThan(MIN_FIT_SPAN);
  });

  it('две разнесённые точки — реальный разброс, больше порога', () => {
    const span = fitSpan([{ lat: 41.674, lng: 44.823 }, { lat: 41.7, lng: 44.9 }]);
    expect(span).toBeGreaterThan(MIN_FIT_SPAN);
    expect(span).toBeCloseTo(0.077, 3);
  });

  it('антимеридиан: Чукотка и Аляска — узкий реальный разброс, а не ~343°', () => {
    const span = fitSpan([{ lat: 64.7, lng: 177.5 }, { lat: 64.5, lng: -165.4 }]);
    expect(span).toBeLessThan(20);
  });
});

describe('groupByLocation', () => {
  const at = (id: string, lat: number, lng: number) => ({ id, lat, lng });

  it('разнесённые точки — каждая своя группа, порядок по первому вхождению', () => {
    const groups = groupByLocation([at('a', 41.674, 44.823), at('b', 41.7, 44.9), at('c', 55.75, 37.61)]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('две точки в миллиметрах друг от друга (дефект 3c) — одна группа', () => {
    const groups = groupByLocation([at('a', 41.674, 44.823), at('b', 41.674 + 3e-8, 44.823)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('три и больше сканов в одном месте остаются одной группой целиком — ни один не теряется', () => {
    const same = ['a', 'b', 'c', 'd', 'e'].map((id, i) => at(id, 41.674 + i * 1e-8, 44.823));
    const groups = groupByLocation(same);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(5);
  });

  it('точки по разные стороны нулевого меридиана не расходятся из-за знака нуля', () => {
    expect(groupByLocation([at('a', 51.4778, -1e-9), at('b', 51.4778, 1e-9)])).toHaveLength(1);
  });

  it('пусто — пусто', () => {
    expect(groupByLocation([])).toEqual([]);
  });
});

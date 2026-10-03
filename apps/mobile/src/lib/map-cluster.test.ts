import { describe, expect, it } from 'vitest';
import { clusterByZoom, clusterCellSize, MIN_CLUSTER_CELL } from './map-cluster';

const at = (id: string, lat: number, lng: number) => ({ id, lat, lng });

describe('clusterCellSize', () => {
  it('пропорционален охвату, но не меньше пола', () => {
    expect(clusterCellSize(2.4)).toBeCloseTo(0.1, 5);
    expect(clusterCellSize(0)).toBe(MIN_CLUSTER_CELL);
  });
});

describe('clusterByZoom', () => {
  it('одна точка — один кластер из неё самой', () => {
    const groups = clusterByZoom([at('a', 41.674, 44.823)], 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ lat: 41.674, lng: 44.823 });
    expect(groups[0]!.items.map((p) => p.id)).toEqual(['a']);
  });

  it('две точки рядом при широком охвате карты — один кластер, координата — центроид', () => {
    const groups = clusterByZoom([at('a', 41.6700, 44.8200), at('a2', 41.6705, 44.8203)], 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((p) => p.id).sort()).toEqual(['a', 'a2']);
    expect(groups[0]!.lat).toBeCloseTo((41.6700 + 41.6705) / 2, 5);
    expect(groups[0]!.lng).toBeCloseTo((44.8200 + 44.8203) / 2, 5);
  });

  it('две далёкие точки — разные кластеры даже при широком охвате', () => {
    const groups = clusterByZoom([at('a', 41.0, 44.0), at('b', 55.75, 37.61)], 1);
    expect(groups).toHaveLength(2);
  });

  it('распад кластера при приближении: те же точки, слипшиеся на широком охвате, расходятся на узком', () => {
    const points = [at('a', 41.6700, 44.8200), at('a2', 41.6705, 44.8203)];
    expect(clusterByZoom(points, 1)).toHaveLength(1);
    expect(clusterByZoom(points, 0.001)).toHaveLength(2);
  });

  it('три и больше находок в одной ячейке остаются одним кластером целиком', () => {
    const same = ['a', 'b', 'c', 'd', 'e'].map((id, i) => at(id, 41.674 + i * 1e-6, 44.823));
    const groups = clusterByZoom(same, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(5);
  });

  it('пусто — пусто', () => {
    expect(clusterByZoom([], 1)).toEqual([]);
  });
});

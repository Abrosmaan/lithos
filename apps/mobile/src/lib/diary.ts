// Дневник локации (spec §8): ожидаемые породы ячейки и найденные. Чистые функции + разбор строк lithos.diary
// и lithos.geo_cache.expected_rocks. Полностью закрытый дневник — значок.
import { ROCK_CLASSES } from '@lithos/shared';
import type { CardRow } from './card-types';

export interface DiaryRow {
  cell_id: string;
  expected: string[];
  found: string[];
  updated_at: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Породы, которые не «закрывают» позицию дневника: unknown* (воркер их в found не пишет, T2.1). */
export function isCountableRock(rockClass: string): boolean {
  return (ROCK_CLASSES as readonly string[]).includes(rockClass) && !rockClass.startsWith('unknown');
}

export function parseDiaryRow(raw: unknown): DiaryRow | null {
  if (!isRecord(raw) || typeof raw.cell_id !== 'string' || raw.cell_id.length === 0) return null;
  return {
    cell_id: raw.cell_id,
    expected: uniq(strings(raw.expected)),
    found: uniq(strings(raw.found)),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  };
}

/** geo_cache.expected_rocks = [{rock_class, share}] (GeoContext из shared) → список пород по убыванию доли. */
export function parseExpectedRocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter(isRecord).flatMap((r) => (typeof r.rock_class === 'string' ? [{ rock: r.rock_class, share: typeof r.share === 'number' ? r.share : 0 }] : []));
  rows.sort((a, b) => b.share - a.share);
  return uniq(rows.map((r) => r.rock));
}

function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

export interface DiaryItem {
  rock_class: string;
  found: boolean;
}

export interface DiaryProgress {
  items: DiaryItem[];
  /** Найдено из ожидаемых. */
  foundCount: number;
  total: number;
  /** 100 % — все ожидаемые найдены (и список не пуст). */
  complete: boolean;
  /** Найдено сверх списка (странники, ошибки геологии). */
  extra: string[];
}

export interface DiaryInput {
  /** Ожидаемые породы: diary.expected, а если пусто — geo_cache.expected_rocks. */
  expected: readonly string[];
  /** diary.found (воркер) — объединяется с породами карточек в ячейке. */
  found?: readonly string[];
  /** Карточки пользователя в ячейке (cards.cell_id), включая скрытых родителей — они тоже находки. */
  cards?: readonly Pick<CardRow, 'rock_class'>[];
}

export function diaryProgress(input: DiaryInput): DiaryProgress {
  const expected = uniq([...input.expected]);
  const foundSet = new Set<string>([...(input.found ?? []), ...(input.cards ?? []).map((c) => c.rock_class)].filter(isCountableRock));
  const items = expected.map((rock_class) => ({ rock_class, found: foundSet.has(rock_class) }));
  const foundCount = items.filter((i) => i.found).length;
  const extra = [...foundSet].filter((r) => !expected.includes(r)).sort();
  return { items, foundCount, total: expected.length, complete: expected.length > 0 && foundCount === expected.length, extra };
}

/** Ячейки с полностью закрытым дневником — для подсветки на карте. Карточки группируются по cell_id. */
export function completedCells(diary: readonly DiaryRow[], cards: readonly Pick<CardRow, 'rock_class' | 'cell_id'>[]): string[] {
  const byCell = new Map<string, Pick<CardRow, 'rock_class'>[]>();
  for (const c of cards) {
    if (!c.cell_id) continue;
    const list = byCell.get(c.cell_id) ?? [];
    list.push(c);
    byCell.set(c.cell_id, list);
  }
  return diary
    .filter((d) => diaryProgress({ expected: d.expected, found: d.found, cards: byCell.get(d.cell_id) ?? [] }).complete)
    .map((d) => d.cell_id);
}

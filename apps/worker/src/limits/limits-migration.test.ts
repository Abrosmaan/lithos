// T3.4: единственное разрешённое дублирование балансовых чисел — сид таблицы lithos.limits в миграции.
// Тест читает миграцию и сверяет числа с packages/shared/src/limits.ts (SCAN_LIMIT_SEED).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCAN_LIMIT_SEED } from '@lithos/shared';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../supabase/migrations');

/** Последний сид каждого ключа по всем миграциям (более поздняя миграция переопределяет). */
function seededLimits(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
    // Только тело insert into lithos.limits (key, value) values … ; — не любые пары ('x', N) в файле.
    for (const stmt of sql.matchAll(/insert\s+into\s+lithos\.limits\s*\(\s*key\s*,\s*value\s*\)\s*values([\s\S]*?)(?:on\s+conflict|;)/gi)) {
      for (const m of stmt[1]!.matchAll(/\(\s*'([a-z_]+)'\s*,\s*(\d+)\s*\)/g)) out[m[1]!] = Number(m[2]);
    }
  }
  return out;
}

describe('lithos.limits seed = shared SCAN_LIMIT_SEED', () => {
  it('числа в миграции совпадают с shared', () => {
    const seeded = seededLimits();
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(SCAN_LIMIT_SEED).sort());
    expect(seeded).toEqual(SCAN_LIMIT_SEED);
  });
});

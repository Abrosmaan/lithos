// T1.2, opt-in: реальный Macrostrat + реальный lithos.geo_cache. Запуск: GEO_INTEGRATION=1 pnpm --filter worker test
// (нужен SUPABASE_DB_POOLER_URL/WORKER_DB_URL в .env). Прод-строки не трогает: пишет и удаляет только ячейку test-*.
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

let dir = process.cwd();
for (let i = 0; i < 4 && !existsSync(resolve(dir, '.env')); i++) dir = dirname(dir);
dotenv.config({ path: resolve(dir, '.env') });

const enabled = process.env.GEO_INTEGRATION === '1' && !!(process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL);
const TEST_CELL = 'test-t12';

describe.skipIf(!enabled)('geo integration (реальные Macrostrat и geo_cache)', () => {
  it('fetchRaw → normalize → upsert test-ячейки → чтение с TTL и без → удаление', { timeout: 60_000 }, async () => {
    const { closeDb } = await import('../db.js');
    const { readCache, writeCache, deleteCache, normalize } = await import('../geo.js');
    const { fetchRaw } = await import('./macrostrat.js');
    try {
      const raw = await fetchRaw(41.57, 41.57); // Гонио
      const ctx = normalize(raw);
      expect(ctx).not.toBeNull();
      expect(ctx!.expected_rocks.length).toBeGreaterThan(0);

      await writeCache(TEST_CELL, raw, ctx!);
      await writeCache(TEST_CELL, raw, ctx!); // идемпотентно
      const fresh = await readCache(TEST_CELL);
      expect(fresh).toEqual(ctx);
      const any = await readCache(TEST_CELL, null);
      expect(any).toEqual(ctx);
    } finally {
      await deleteCache(TEST_CELL).catch(() => undefined);
      await closeDb();
    }
  });
});

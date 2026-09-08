// T2.1, opt-in: реальная БД (pooler) + Storage под service-ключом + реальные модели (Anthropic; стоимость — центы).
// Запуск: PIPELINE_INTEGRATION=1 pnpm --filter worker test
// Создаёт тестового user + scan + фото (sharp) в lithos-photos, ставит в scan_interactive, гонит один tick,
// проверяет scans/cards, всё удаляет (user → cascade). Прод-строки не трогает.
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { SCAN_ERROR_CODES } from './constants.js';

let dir = process.cwd();
for (let i = 0; i < 4 && !existsSync(resolve(dir, '.env')); i++) dir = dirname(dir);
dotenv.config({ path: resolve(dir, '.env') });

const enabled =
  process.env.PIPELINE_INTEGRATION === '1' &&
  !!(process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL) &&
  !!process.env.SUPABASE_URL &&
  !!(process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  !!process.env.ANTHROPIC_API_KEY;

/** Синтетический «камень»: тёмно-серый окатанный овал с зернистостью и тенью на песчаном фоне, 800×600. */
async function rockImage(): Promise<Buffer> {
  const w = 800;
  const h = 600;
  const raw = Buffer.alloc(w * h * 3);
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const dx = (x - 400) / 230;
      const dy = (y - 310) / 160;
      const r = dx * dx + dy * dy;
      let R: number;
      let G: number;
      let B: number;
      if (r < 1) {
        const shade = 0.75 + 0.35 * (1 - r) * (0.6 - dx * 0.5 - dy * 0.6);
        const grain = (rnd() - 0.5) * 70;
        const vein = Math.abs(Math.sin((x + y * 0.4) / 9)) > 0.985 ? 60 : 0;
        R = 95 * shade + grain + vein;
        G = 92 * shade + grain + vein;
        B = 88 * shade + grain + vein;
      } else {
        const shadow = r < 1.25 && dy > 0 ? 0.7 : 1;
        const g = (rnd() - 0.5) * 30;
        R = 205 * shadow + g;
        G = 190 * shadow + g;
        B = 160 * shadow + g;
      }
      raw[i] = Math.max(0, Math.min(255, R));
      raw[i + 1] = Math.max(0, Math.min(255, G));
      raw[i + 2] = Math.max(0, Math.min(255, B));
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

interface ScenarioOpts {
  /** Файл реального фото (PIPELINE_INTEGRATION_PHOTO) или синтетика. */
  image: Buffer;
  /** Пред-записать gate=ok в scan_results — идемпотентность пропустит Haiku и пойдёт в S2–S4 (синтетика Gate не проходит). */
  seedGate: boolean;
  label: string;
}

interface Summary {
  ms: number;
  scan: Record<string, unknown>;
  results: Array<Record<string, unknown>>;
  phash: Array<string | null>;
  card: Record<string, unknown> | undefined;
  diary: Array<Record<string, unknown>>;
  still_queued: number;
  user_id: string;
}

async function runScenario(o: ScenarioOpts): Promise<Summary> {
  const { config } = await import('../config.js');
  const { pool } = await import('../db.js');
  const { createClient } = await import('@supabase/supabase-js');
  const { PgPipelineRepo } = await import('./repo.js');
  const { createPhotoStore, PHOTO_BUCKET } = await import('./storage.js');
  const { createPipeline } = await import('../pipeline.js');
  const { createConsumer } = await import('./consumer.js');
  const { readOne, ack, archive, extendLease, send } = await import('../queue.js');
  const { getGeoContext } = await import('../geo.js');
  const { callModel } = await import('../llm/index.js');
  const { log } = await import('../log.js');

  const admin = createClient(config.supabaseUrl, config.supabaseServiceKey, { db: { schema: 'lithos' }, auth: { persistSession: false, autoRefreshToken: false } });
  const deviceId = `test-t21-${Date.now()}`;
  let userId = '';
  let scanId = '';
  let path = '';
  const t0 = Date.now();
  try {
    const u = await pool.query<{ id: string }>('insert into lithos.users (device_id, display_name) values ($1, $2) returning id', [deviceId, 'T2.1 integration']);
    userId = u.rows[0]!.id;
    const sc = await pool.query<{ id: string }>(
      `insert into lithos.scans (id, user_id, lat, lng, accuracy_m, user_tests)
       values (gen_random_uuid(), $1, 41.57, 41.57, 8, $2::jsonb) returning id`,
      [userId, JSON.stringify({ weight: 'normal', scratch: 'coin', wet: false, has_scale_photo: true })],
    );
    scanId = sc.rows[0]!.id;
    path = `${userId}/${scanId}/1.jpg`;
    const up = await admin.storage.from(PHOTO_BUCKET).upload(path, o.image, { contentType: 'image/jpeg', upsert: true });
    expect(up.error).toBeNull();
    await pool.query('insert into lithos.scan_photos (scan_id, storage_path, is_primary) values ($1, $2, true)', [scanId, path]);
    if (o.seedGate) {
      await pool.query(
        `insert into lithos.scan_results (scan_id, stage, provider, model, prompt_version, raw_json, cost_usd)
         values ($1, 'gate', 'test', 'seeded', 'gate-v1', $2::jsonb, 0)`,
        [scanId, JSON.stringify({ result: { is_rock: true, quality: 'ok', multiple_objects: false }, meta: { used_fallback: false, fallback_reason: 'none', repaired: false, attempts: 0 } })],
      );
    }
    const msgId = await send('scan_interactive', { scan_id: scanId, enqueued_at: new Date().toISOString() });
    expect(msgId).toBeTruthy();

    const repo = new PgPipelineRepo(pool);
    const pipeline = createPipeline({ repo, photos: createPhotoStore(config.supabaseUrl, config.supabaseServiceKey), callModel, getGeoContext, log, now: Date.now });
    const consumer = createConsumer({ queue: { readOne, ack, archive, extendLease, send }, repo, runScan: pipeline.runScan, log, now: Date.now });

    // Один tick: сообщение наше (прод-сканов в очереди пока нет). Если цепочка > 90 с — дожидаемся фона.
    expect(await consumer.tick()).toBe(true);
    await consumer.drain();

    const scan = (await pool.query('select stage, error, cost_usd, provider, prompt_version from lithos.scans where id = $1', [scanId])).rows[0] as Record<string, unknown>;
    const results = (await pool.query('select stage, provider, model, cost_usd, latency_ms from lithos.scan_results where scan_id = $1 order by created_at', [scanId])).rows as Array<Record<string, unknown>>;
    const photos = (await pool.query('select phash from lithos.scan_photos where scan_id = $1', [scanId])).rows as Array<{ phash: string | null }>;
    const card = (await pool.query('select * from lithos.cards where scan_id = $1', [scanId])).rows[0] as Record<string, unknown> | undefined;
    const diary = (await pool.query('select cell_id, expected, found from lithos.diary where user_id = $1', [userId])).rows as Array<Record<string, unknown>>;
    const queued = (await pool.query('select count(*)::int as n from pgmq.q_scan_interactive where message->>$1 = $2', ['scan_id', scanId])).rows[0] as { n: number };
    const summary: Summary = { ms: Date.now() - t0, scan, results, phash: photos.map((p) => p.phash), card, diary, still_queued: queued.n, user_id: userId };
    // Вывод для артефакта (без ключей).
    console.log(
      `[${o.label}]`,
      JSON.stringify(
        {
          ...summary,
          user_id: undefined,
          card: card && { rock_class: card.rock_class, tier: card.tier, score: card.score, name: card.name, state: card.state, verification: card.verification, provisional: card.provisional, cell_id: card.cell_id, breakdown: card.score_breakdown, inclusions: card.inclusions, shape: card.shape, lore: card.lore },
        },
        null,
        1,
      ),
    );
    return summary;
  } finally {
    if (path) await admin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined);
    if (userId) await pool.query('delete from lithos.users where id = $1', [userId]).catch(() => undefined); // cascade: scans, photos, results, cards, diary
  }
}

describe.skipIf(!enabled)('pipeline integration (реальные БД, Storage, модели)', () => {
  const photoPath = process.env.PIPELINE_INTEGRATION_PHOTO;

  it('реальный Gate: синтетика → not_rock (или реальное фото из PIPELINE_INTEGRATION_PHOTO → карточка)', { timeout: 240_000 }, async () => {
    const image = photoPath ? await (await import('node:fs/promises')).readFile(photoPath) : await rockImage();
    const s = await runScenario({ image, seedGate: false, label: photoPath ? 'real photo' : 'synthetic, real gate' });
    expect(s.still_queued).toBe(0); // ack
    expect(s.phash.every((p) => /^[0-9a-f]{16}$/.test(p ?? ''))).toBe(true);
    expect(s.results.length).toBeGreaterThanOrEqual(1);
    if (s.scan.stage === 'failed') {
      // Gate отсёк синтетику — штатный исход: код из словаря, карточки нет, Main не вызывался.
      expect(SCAN_ERROR_CODES).toContain(s.scan.error);
      expect(s.card).toBeUndefined();
      expect(s.results.map((r) => r.stage)).toEqual(['gate']);
    } else {
      expect(s.scan.stage).toBe('done');
      expect(s.card).toBeDefined();
    }
  });

  it('(m6) реальная БД без моделей: diary-merge, upsert карточки по scan_id, advisory lock, dlqScan', { timeout: 60_000 }, async () => {
    const { pool } = await import('../db.js');
    const { PgPipelineRepo } = await import('./repo.js');
    const repo = new PgPipelineRepo(pool);
    let userId = '';
    try {
      userId = (await pool.query<{ id: string }>('insert into lithos.users (device_id) values ($1) returning id', [`test-t21-db-${Date.now()}`])).rows[0]!.id;
      const mk = async () => (await pool.query<{ id: string }>('insert into lithos.scans (id, user_id, lat, lng) values (gen_random_uuid(), $1, 41.57, 41.57) returning id', [userId])).rows[0]!.id;
      const s1 = await mk();
      const s2 = await mk();
      const card = (scan_id: string, rock: string) => ({
        scan_id, user_id: userId, rock_class: rock, tier: 'common', score: 10, score_breakdown: { x: 1 }, inclusions: [], shape: {}, lore: null,
        name: rock, state: 'closed' as const, parent_card_id: null, verification: 'ai' as const, provisional: false, cell_id: 'test-t21', lat: 41.57, lng: 41.57,
      });
      const diary = (found: string | null, expected: string[]) => ({ user_id: userId, cell_id: 'test-t21', expected, found });
      const c1 = await repo.upsertCard(card(s1, 'basalt'), { scanStage: 'done', diary: diary('basalt', ['basalt', 'limestone']) });
      const c1b = await repo.upsertCard(card(s1, 'andesite'), { scanStage: 'done', diary: diary('andesite', ['limestone']) });
      expect(c1b.id).toBe(c1.id); // upsert по scan_id — тот же id
      expect(c1b.rock_class).toBe('andesite');
      await repo.upsertCard(card(s2, 'basalt'), { scanStage: 'done', diary: diary('basalt', ['limestone']) });
      await repo.upsertCard(card(s2, 'basalt'), { scanStage: 'done', diary: diary(null, ['limestone']) });
      const d = (await pool.query('select expected, found from lithos.diary where user_id = $1 and cell_id = $2', [userId, 'test-t21'])).rows[0] as { expected: string[]; found: string[] };
      expect(d.expected).toEqual(['limestone']); // перезаписывается
      expect([...d.found].sort()).toEqual(['andesite', 'basalt']); // объединяется без дублей
      expect((await pool.query('select stage from lithos.scans where id = $1', [s1])).rows[0]).toMatchObject({ stage: 'done' });

      // advisory lock: второй захват того же scan_id не проходит, после release — проходит
      const lock = await repo.tryLockScan(s1);
      expect(lock).not.toBeNull();
      expect(await repo.tryLockScan(s1)).toBeNull();
      await lock!.release();
      const again = await repo.tryLockScan(s1);
      expect(again).not.toBeNull();
      await again!.release();

      // dlqScan: с карточкой → done_with_card (+ provisional), без карточки → failed/dlq
      await pool.query(`update lithos.scans set stage = 'main' where id = $1`, [s1]);
      expect(await repo.dlqScan(s1)).toBe('done_with_card');
      expect((await pool.query('select provisional from lithos.cards where scan_id = $1', [s1])).rows[0]).toMatchObject({ provisional: true });
      const s3 = await mk();
      expect(await repo.dlqScan(s3)).toBe('failed');
      expect((await pool.query('select stage, error from lithos.scans where id = $1', [s3])).rows[0]).toMatchObject({ stage: 'failed', error: 'dlq' });
      expect(await repo.dlqScan(s3)).toBe('noop');
      console.log('[db-only] diary:', JSON.stringify(d), 'lock/dlq: ok');
    } finally {
      if (userId) await pool.query('delete from lithos.users where id = $1', [userId]).catch(() => undefined);
    }
  });

  it('S2–S4 на реальном стеке (gate пред-записан): карточка, дневник, cost = сумма ступеней, ack', { timeout: 240_000 }, async () => {
    const s = await runScenario({ image: await rockImage(), seedGate: true, label: 'synthetic, seeded gate' });
    expect(s.still_queued).toBe(0);
    expect(s.scan.stage).toBe('done');
    expect(s.scan.error).toBeNull();
    const stages = s.results.map((r) => r.stage);
    expect(stages[0]).toBe('gate');
    expect(stages).toContain('main');
    expect(s.card).toBeDefined();
    expect(s.card!.user_id).toBe(s.user_id);
    expect(s.card!.cell_id).toBe('szms3z'); // Гонио
    expect(s.card!.state).toBe('closed');
    expect(typeof s.card!.name).toBe('string');
    const sum = s.results.reduce((a, r) => a + Number(r.cost_usd), 0);
    expect(Number(s.scan.cost_usd)).toBeCloseTo(sum, 6);
    expect(Number(s.scan.cost_usd)).toBeGreaterThan(0);
    // Дневник: expected из гео; found — только если порода определена (unknown_* не пишется).
    if ((s.card!.rock_class as string).startsWith('unknown')) expect(s.diary.length).toBeLessThanOrEqual(1);
    else expect(s.diary[0]!.found).toContain(s.card!.rock_class);
  });
});

// закрыть пул после всех сценариев
afterAll(async () => {
  if (!enabled) return;
  const { closeDb } = await import('../db.js');
  await closeDb();
});

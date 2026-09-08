// T4.1 — чек-лист ai-pipeline §11 п.2–5 на настоящем воркере, opt-in:
//   RESILIENCE_INTEGRATION=1 pnpm --filter worker exec vitest run src/resilience
// Воркер запускается как отдельный процесс (`node --import tsx src/index.ts`) с переопределённым env
// (ANTHROPIC_API_KEY=invalid…, DAILY_BUDGET_USD=…) — как на VPS через env_file; его JSON-лог читается из stdout/stderr.
// Предусловие: приложение никто не использует и VPS-воркер остановлен (`docker compose stop worker` на flat-vps) —
// иначе два воркера делят очереди; перед каждым стартом проверяется, что в очередях только сканы теста.
// Реальные БД + Storage. Модели вызываются только в п.3 (один Sonnet, при триггерах — Opus; ≈ $0.03–0.08):
// п.2 — только 401, п.4/5 — без вызовов (gate/main пред-записаны в scan_results). Всё тестовое удаляется
// (users → cascade, объекты Storage, сообщения очередей и архива).
import { spawn, type ChildProcess } from 'node:child_process';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanResult } from '@lithos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PIPELINE, SCAN_ERROR_CODES } from './pipeline/constants.js';
import { rockImage, rockImageRetake } from './pipeline/__fixtures__/synthetic.js';

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let envDir = process.cwd();
for (let i = 0; i < 4 && !existsSync(resolve(envDir, '.env')); i++) envDir = dirname(envDir);
dotenv.config({ path: resolve(envDir, '.env') });

const enabled =
  process.env.RESILIENCE_INTEGRATION === '1' &&
  !!(process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL) &&
  !!process.env.SUPABASE_URL &&
  !!(process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  !!process.env.ANTHROPIC_API_KEY;

const INVALID_KEY = 'sk-ant-invalid-t41-resilience';
const QUEUES = ['scan_interactive', 'scan_dispute', 'scan_batch'] as const;

// ---------------------------------------------------------------------------
// Воркер как процесс
// ---------------------------------------------------------------------------

interface LogRecord {
  ts: string;
  level: string;
  msg: string;
  [k: string]: unknown;
}

interface WorkerProc {
  label: string;
  records: LogRecord[];
  /** Все строки вывода как есть (для проверки, что ключ не утёк). */
  raw: string[];
  waitUntil(cond: (records: LogRecord[]) => boolean, timeoutMs: number, what: string): Promise<void>;
  /** SIGTERM → graceful (drain, closeDb). */
  stop(): Promise<void>;
  /** SIGKILL — «убить воркер» без drain. */
  kill(): Promise<void>;
}

/** Секреты процесса, которых в логе воркера быть не должно (ключи читаются только резолвером/Storage-клиентом). */
function secretValues(): string[] {
  return [INVALID_KEY, process.env.ANTHROPIC_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.SUPABASE_SERVICE_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
    (v): v is string => typeof v === 'string' && v.length >= 8,
  );
}

/** m1: перед стартом настоящего воркера в очередях — только наши сканы (иначе он возьмёт чужое сообщение). */
async function assertQueuesOnlyOurs(): Promise<void> {
  for (const q of QUEUES) {
    const rows = (await ctx.pool.query<{ scan_id: string | null }>(`select message->>'scan_id' as scan_id from pgmq.q_${q}`)).rows;
    const foreign = rows.filter((r) => !r.scan_id || !ctx.scans.includes(r.scan_id));
    if (foreign.length) throw new Error(`queue ${q} has ${foreign.length} message(s) not from this test; refuse to start a real worker`);
  }
}

/** Остановить воркер и проверить лог: без секретов (m2) и без чужих scan_id (m1). */
async function stopChecked(w: WorkerProc): Promise<void> {
  await w.stop();
  const text = w.raw.join('\n');
  for (const secret of secretValues()) expect(text, `${w.label}: secret leaked to log`).not.toContain(secret);
  const foreign = w.records.filter((r) => typeof r.scan_id === 'string' && !ctx.scans.includes(r.scan_id));
  expect(foreign.map(brief), `${w.label}: worker touched scans outside the test`).toEqual([]);
}

async function startWorker(label: string, env: Record<string, string>): Promise<WorkerProc> {
  await assertQueuesOnlyOurs();
  const tsxLoader = createRequire(import.meta.url).resolve('tsx');
  // Один процесс (не `tsx` CLI, который форкает ребёнка и глотал бы SIGKILL): kill() бьёт именно воркер.
  const child: ChildProcess = spawn(process.execPath, ['--import', tsxLoader, 'src/index.ts'], {
    cwd: WORKER_DIR,
    env: { ...process.env, ...env, LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const records: LogRecord[] = [];
  const raw: string[] = [];
  const waiters = new Set<() => void>();
  const onLine = (line: string) => {
    if (!line.trim()) return;
    raw.push(line);
    try {
      const r = JSON.parse(line) as LogRecord;
      if (r && typeof r.msg === 'string') records.push(r);
      else raw.push(line);
    } catch {
      /* не JSON (stack trace и т.п.) — только в raw */
    }
    for (const w of waiters) w();
  };
  const attach = (stream: NodeJS.ReadableStream | null) => {
    let buf = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    stream?.on('end', () => onLine(buf));
  };
  attach(child.stdout);
  attach(child.stderr);
  const exited = new Promise<void>((r) => child.on('exit', () => r()));

  return {
    label,
    records,
    raw,
    waitUntil(cond, timeoutMs, what) {
      return new Promise<void>((res, rej) => {
        const check = () => {
          if (cond(records)) {
            waiters.delete(check);
            clearTimeout(t);
            res();
          }
        };
        const t = setTimeout(() => {
          waiters.delete(check);
          rej(new Error(`[${label}] timeout ${timeoutMs} ms waiting for: ${what}\nlast log:\n${records.slice(-8).map(brief).join('\n')}`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const forced = setTimeout(() => child.kill('SIGKILL'), 20_000);
      await exited;
      clearTimeout(forced);
    },
    async kill() {
      if (child.exitCode !== null) return;
      child.kill('SIGKILL');
      await exited;
    },
  };
}

/** Строка лога для артефакта: время, уровень, сообщение и поля без scan_id/msg_id-шума. */
function brief(r: LogRecord): string {
  const { ts, level, msg, ...rest } = r;
  const fields = Object.entries(rest)
    .filter(([k]) => !['queue', 'msg_id', 'new_msg_id'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${ts.slice(11, 23)} ${level.padEnd(5)} ${msg} ${fields}`.trim();
}

function excerpt(w: WorkerProc, filter: (r: LogRecord) => boolean = () => true): string {
  return w.records
    .filter(filter)
    .map(brief)
    .join('\n');
}

const llmCalls = (w: WorkerProc, stage?: string) => w.records.filter((r) => r.msg === 'llm call' && (stage === undefined || r.stage === stage));

// ---------------------------------------------------------------------------
// Фикстуры в БД / Storage
// ---------------------------------------------------------------------------

type Db = typeof import('./db.js');

/** supabase-js под service-ключом — только Storage (загрузка/удаление тестовых фото). */
async function createAdmin(url: string, serviceKey: string) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, serviceKey, { db: { schema: 'lithos' }, auth: { persistSession: false, autoRefreshToken: false } });
}
type Admin = Awaited<ReturnType<typeof createAdmin>>;

const ctx = {} as {
  pool: Db['pool'];
  closeDb: Db['closeDb'];
  admin: Admin;
  bucket: string;
  send: typeof import('./queue.js').send;
  users: string[];
  scans: string[];
  paths: string[];
};

const GATE_OK = { result: { is_rock: true, quality: 'ok', multiple_objects: false }, meta: { used_fallback: false, fallback_reason: 'none', repeated: false, attempts: 0 } };

/** Пред-записанный ответ Main: известняк на побережье Гонио (геоконтекст T1.2: limestone 0.7) — без гео-аномалии. */
function mainResult(confidence: number): ScanResult {
  return {
    rock_class: { primary: 'limestone', confidence, alternatives: [{ name: 'mudstone', confidence: 0.05 }] },
    inclusions: [],
    shape: { tags: ['rounded'], natural_hole: false, recognizable_silhouette: null },
    surface: 'weathered',
    provenance: { matches_local_geology: true, wanderer_mechanism: null },
    split_recommendation: { recommended: false, reason: null },
    lore: 'Тестовый известняк с побережья (T4.1).',
    flags: [],
    revision_note: null,
  };
}

async function createUser(label: string): Promise<string> {
  const r = await ctx.pool.query<{ id: string }>('insert into lithos.users (device_id, display_name) values ($1, $2) returning id', [
    `test-t41-${label}-${Date.now()}`,
    'T4.1 resilience test',
  ]);
  ctx.users.push(r.rows[0]!.id);
  return r.rows[0]!.id;
}

interface ScanOpts {
  image: Buffer;
  seedGate?: boolean;
  /** Пред-записать main (S2) — S3/S4 без вызовов моделей. */
  seedMain?: ScanResult;
}

async function createScan(userId: string, o: ScanOpts): Promise<string> {
  const sc = await ctx.pool.query<{ id: string }>(
    `insert into lithos.scans (id, user_id, lat, lng, accuracy_m, user_tests)
     values (gen_random_uuid(), $1, 41.57, 41.57, 8, $2::jsonb) returning id`,
    [userId, JSON.stringify({ weight: 'normal', scratch: 'coin', wet: false, has_scale_photo: false })],
  );
  const scanId = sc.rows[0]!.id;
  ctx.scans.push(scanId);
  const path = `${userId}/${scanId}/1.jpg`;
  const up = await ctx.admin.storage.from(ctx.bucket).upload(path, o.image, { contentType: 'image/jpeg', upsert: true });
  expect(up.error).toBeNull();
  ctx.paths.push(path);
  await ctx.pool.query('insert into lithos.scan_photos (scan_id, storage_path, is_primary) values ($1, $2, true)', [scanId, path]);
  const seed = async (stage: 'gate' | 'main', raw: unknown, version: string) =>
    ctx.pool.query(
      `insert into lithos.scan_results (scan_id, stage, provider, model, prompt_version, raw_json, cost_usd)
       values ($1, $2, 'test', 'seeded', $3, $4::jsonb, 0)`,
      [scanId, stage, version, JSON.stringify(raw)],
    );
  if (o.seedGate || o.seedMain) await seed('gate', GATE_OK, 'gate-v1');
  if (o.seedMain) await seed('main', { result: o.seedMain, meta: { used_fallback: false, fallback_reason: 'none', repaired: false, attempts: 1 } }, 'main-v1');
  return scanId;
}

/** «Уже потраченный сегодня» скан — только строка scans с cost_usd (без фото), для бюджетного предохранителя. */
async function createSpentScan(userId: string, costUsd: number): Promise<string> {
  const r = await ctx.pool.query<{ id: string }>(
    `insert into lithos.scans (id, user_id, stage, cost_usd) values (gen_random_uuid(), $1, 'done', $2) returning id`,
    [userId, costUsd],
  );
  ctx.scans.push(r.rows[0]!.id);
  return r.rows[0]!.id;
}

async function enqueue(scanId: string): Promise<string> {
  return ctx.send('scan_interactive', { scan_id: scanId, enqueued_at: new Date().toISOString() });
}

async function scanRow(scanId: string) {
  return (await ctx.pool.query('select stage, error, cost_usd::float8 as cost_usd, provider, prompt_version from lithos.scans where id = $1', [scanId])).rows[0] as {
    stage: string;
    error: string | null;
    cost_usd: number;
    provider: string | null;
    prompt_version: string | null;
  };
}

async function resultRows(scanId: string) {
  return (await ctx.pool.query('select stage, provider, model, cost_usd::float8 as cost_usd from lithos.scan_results where scan_id = $1 order by created_at', [scanId])).rows as Array<{
    stage: string;
    provider: string | null;
    model: string | null;
    cost_usd: number;
  }>;
}

async function cardRow(scanId: string) {
  return (await ctx.pool.query('select id, rock_class, tier, score, name, provisional, score_breakdown from lithos.cards where scan_id = $1', [scanId])).rows[0] as
    | { id: string; rock_class: string; tier: string | null; score: number | null; name: string; provisional: boolean; score_breakdown: Record<string, unknown> }
    | undefined;
}

async function queued(scanId: string) {
  return (await ctx.pool.query("select msg_id, read_ct, vt, (vt > now()) as delayed, extract(epoch from (vt - now()))::int as delay_s from pgmq.q_scan_interactive where message->>'scan_id' = $1", [scanId])).rows as Array<{
    msg_id: string;
    read_ct: number;
    delayed: boolean;
    delay_s: number;
  }>;
}

async function archived(scanId: string): Promise<number> {
  return (await ctx.pool.query<{ n: number }>("select count(*)::int as n from pgmq.a_scan_interactive where message->>'scan_id' = $1", [scanId])).rows[0]!.n;
}

async function spentTodayUsd(): Promise<number> {
  const { pgSpentTodayUsd } = await import('./limits/budget.js');
  return pgSpentTodayUsd(ctx.pool)();
}

// ---------------------------------------------------------------------------

describe.skipIf(!enabled)('T4.1 resilience (реальный воркер-процесс, БД, Storage)', () => {
  beforeAll(async () => {
    const { config } = await import('./config.js');
    const db = await import('./db.js');
    const { PHOTO_BUCKET } = await import('./pipeline/storage.js');
    const { send } = await import('./queue.js');
    ctx.pool = db.pool;
    ctx.closeDb = db.closeDb;
    ctx.admin = await createAdmin(config.supabaseUrl, config.supabaseServiceKey);
    ctx.bucket = PHOTO_BUCKET;
    ctx.send = send;
    ctx.users = [];
    ctx.scans = [];
    ctx.paths = [];
    // Очереди должны быть пусты: воркер-процесс возьмёт любое сообщение.
    for (const q of QUEUES) {
      const n = (await ctx.pool.query<{ n: number }>(`select count(*)::int as n from pgmq.q_${q}`)).rows[0]!.n;
      if (n > 0) throw new Error(`queue ${q} is not empty (${n}); refuse to run a real worker against it`);
    }
  });

  afterAll(async () => {
    if (!ctx.pool) return;
    // Очереди и архив (DLQ) — только сообщения тестовых сканов; фото; users → cascade (scans, photos, results, cards, diary).
    if (ctx.scans.length) {
      for (const q of QUEUES) {
        await ctx.pool.query(`delete from pgmq.q_${q} where message->>'scan_id' = any($1::text[])`, [ctx.scans]);
        await ctx.pool.query(`delete from pgmq.a_${q} where message->>'scan_id' = any($1::text[])`, [ctx.scans]);
      }
    }
    if (ctx.paths.length) await ctx.admin.storage.from(ctx.bucket).remove(ctx.paths).catch(() => undefined);
    if (ctx.users.length) await ctx.pool.query('delete from lithos.users where id = any($1::uuid[])', [ctx.users]);
    const left = (await ctx.pool.query("select id from lithos.users where device_id like 'test-t41-%'")).rows.length;
    const metrics = (await ctx.pool.query("select queue_name, queue_length from pgmq.metrics_all() where queue_name like 'scan_%' order by 1")).rows as Array<{ queue_name: string; queue_length: string }>;
    console.log(`[cleanup] test users left: ${left}; queues: ${metrics.map((m) => `${m.queue_name}=${m.queue_length}`).join(', ')}`);
    await ctx.closeDb();
  });

  it('§11 п.2 circuit breaker: ANTHROPIC_API_KEY=invalid → 401 без retry, breaker open, fallback без ключа → DLQ, пользователю код', { timeout: 180_000 }, async () => {
    const userId = await createUser('p2');
    const image = await rockImage();
    const s1 = await createScan(userId, { image });
    const s2 = await createScan(userId, { image });
    await enqueue(s1);
    await enqueue(s2);

    // Gate — на Anthropic (в .env gate может стоять на Google без ключа; здесь проверяем именно отказ Anthropic → fallback Google).
    const w = await startWorker('p2', { ANTHROPIC_API_KEY: INVALID_KEY, STAGE_GATE: 'anthropic:claude-haiku-4-5' });
    try {
      await w.waitUntil((rs) => rs.filter((r) => r.msg === 'scan sent to DLQ').length >= 2, 150_000, '2 × scan sent to DLQ');
    } finally {
      await stopChecked(w);
    }
    console.log(`[p2] worker log:\n${excerpt(w, (r) => r.msg !== 'queues empty')}`);

    const auth = w.records.filter((r) => r.msg === 'llm call failed (auth): provider key rejected, breaker opened');
    expect(auth.length).toBeGreaterThanOrEqual(1);
    expect(auth.length).toBeLessThanOrEqual(2); // максимум по одному на параллельный скан; дальше breaker
    for (const r of auth) {
      expect(r.provider).toBe('anthropic');
      expect((r.error as { status: number }).status).toBe(401);
      expect(r.breaker).toBe('open');
    }
    // Ни одного retry с backoff (401 — не 429/5xx): «will_retry» не встречается
    expect(w.records.filter((r) => r.msg === 'llm call failed' && r.will_retry === true)).toHaveLength(0);
    // Все последующие попытки — breaker_open без HTTP
    const primaryFailed = w.records.filter((r) => r.msg === 'llm primary provider failed, trying fallback');
    expect(primaryFailed.length).toBeGreaterThanOrEqual(auth.length + 1);
    expect(primaryFailed.map((r) => r.reason).filter((x) => x === 'breaker_open').length).toBeGreaterThanOrEqual(1);
    expect(new Set(primaryFailed.map((r) => r.reason))).toEqual(new Set(['auth', 'breaker_open']));
    // Fallback Google: ключа нет → LlmUnavailableError → сообщение в retry → DLQ после 3 чтений
    const unavailable = w.records.filter((r) => r.msg === 'llm stage unavailable');
    expect(unavailable.length).toBeGreaterThanOrEqual(6); // 2 скана × 3 попытки (4-е чтение — сразу DLQ)
    for (const r of unavailable) {
      const causes = r.causes as Array<{ provider: string; kind: string }>;
      expect(causes[0]!.provider).toBe('anthropic');
      expect(['auth', 'breaker_open']).toContain(causes[0]!.kind);
      expect(causes[1]).toMatchObject({ provider: 'google', kind: 'no_api_key' });
    }
    expect(w.records.filter((r) => r.msg === 'pipeline failed, message will be retried').length).toBeGreaterThanOrEqual(6);
    expect(w.records.filter((r) => r.msg === 'scan sent to DLQ').map((r) => r.scan_id).sort()).toEqual([s1, s2].sort());
    expect(llmCalls(w)).toHaveLength(0);
    // Ключ не утёк в лог
    expect(w.raw.join('\n')).not.toContain(INVALID_KEY);

    for (const id of [s1, s2]) {
      const s = await scanRow(id);
      expect(s).toMatchObject({ stage: 'failed', error: 'dlq' });
      expect(SCAN_ERROR_CODES).toContain(s.error);
      expect(await cardRow(id)).toBeUndefined();
      expect(await queued(id)).toHaveLength(0);
      expect(await archived(id)).toBe(1);
      console.log(`[p2] scan ${id}: ${JSON.stringify(s)} archived=1`);
    }
  });

  it('§11 п.3 idempotency: SIGKILL после записи Main → повтор без нового вызова Main, cost не растёт', { timeout: 400_000 }, async () => {
    const userId = await createUser('p3');
    const scanId = await createScan(userId, { image: await rockImage(), seedGate: true });
    const msgId = await enqueue(scanId);

    const w1 = await startWorker('p3-run1', {});
    try {
      await w1.waitUntil((rs) => rs.some((r) => r.msg === 'pipeline stage' && r.stage === 'main' && r.cached === false && r.scan_id === scanId), 240_000, 'main written');
    } finally {
      await w1.kill(); // «убить воркер» сразу после записи scan_results.main, до карточки
    }
    for (const secret of secretValues()) expect(w1.raw.join('\n')).not.toContain(secret);
    expect(w1.records.filter((r) => typeof r.scan_id === 'string' && !ctx.scans.includes(r.scan_id))).toEqual([]);
    console.log(`[p3] run 1 (killed after main written):\n${excerpt(w1, (r) => r.msg !== 'queues empty')}`);
    const afterKill = await scanRow(scanId);
    const resultsAfterKill = await resultRows(scanId);
    console.log(`[p3] after kill: scan=${JSON.stringify(afterKill)} results=${JSON.stringify(resultsAfterKill)} card=${JSON.stringify(await cardRow(scanId))}`);
    expect(llmCalls(w1, 'main')).toHaveLength(1);
    expect(resultsAfterKill.map((r) => r.stage)).toContain('main');
    const mainCost = resultsAfterKill.find((r) => r.stage === 'main')!.cost_usd;
    expect(mainCost).toBeGreaterThan(0);

    // Сообщение осталось под lease (heartbeat не успел его продлить/снять) — делаем видимым сразу, не ждём 60 с.
    await ctx.pool.query('select pgmq.set_vt($1, $2::bigint, 0)', ['scan_interactive', msgId]);

    const w2 = await startWorker('p3-run2', {});
    try {
      await w2.waitUntil((rs) => rs.some((r) => r.msg === 'scan processed' && r.scan_id === scanId), 300_000, 'scan processed');
    } finally {
      await stopChecked(w2);
    }
    console.log(`[p3] run 2 (replay):\n${excerpt(w2, (r) => r.msg !== 'queues empty')}`);

    expect(llmCalls(w2, 'main')).toHaveLength(0);
    expect(llmCalls(w2, 'gate')).toHaveLength(0);
    expect(w2.records.some((r) => r.msg === 'pipeline stage' && r.stage === 'main' && r.cached === true && r.scan_id === scanId)).toBe(true);
    const final = await scanRow(scanId);
    const results = await resultRows(scanId);
    const card = await cardRow(scanId);
    console.log(`[p3] final: scan=${JSON.stringify(final)} results=${JSON.stringify(results)} card=${JSON.stringify(card && { id: card.id, rock_class: card.rock_class, tier: card.tier, score: card.score, provisional: card.provisional, escalation: (card.score_breakdown.meta as { escalation: string }).escalation })}`);
    expect(final.stage).toBe('done');
    expect(card).toBeDefined();
    expect(results.filter((r) => r.stage === 'main')).toHaveLength(1);
    expect(results.find((r) => r.stage === 'main')!.cost_usd).toBe(mainCost);
    // cost = сумма ступеней; Main оплачен ровно один раз (S3, если сработали триггеры, — первый и единственный вызов Opus)
    expect(final.cost_usd).toBeCloseTo(results.reduce((a, r) => a + r.cost_usd, 0), 6);
    expect(llmCalls(w2).every((r) => r.stage === 'escalation')).toBe(true);
    expect(await queued(scanId)).toHaveLength(0);
  });

  it('§11 п.4 бюджет hard: DAILY_BUDGET_USD=0.001 → budget_paused, сообщение отложено без учёта попытки, 0 вызовов', { timeout: 120_000 }, async () => {
    const userId = await createUser('p4h');
    await createSpentScan(userId, 0.05); // «сегодня уже потрачено»
    const scanId = await createScan(userId, { image: await rockImage(), seedMain: mainResult(0.9) });
    const oldMsg = await enqueue(scanId);

    const w = await startWorker('p4-hard', { DAILY_BUDGET_USD: '0.001' });
    try {
      await w.waitUntil((rs) => rs.some((r) => r.msg === 'scan paused: daily budget exhausted, requeued' && r.scan_id === scanId), 90_000, 'scan paused');
    } finally {
      await stopChecked(w);
    }
    console.log(`[p4 hard] worker log:\n${excerpt(w, (r) => r.msg !== 'queues empty')}`);

    const limit = w.records.find((r) => r.msg === 'budget: daily limit reached, pausing scans');
    expect(limit).toMatchObject({ level: 'error', budget_level: 'hard', prev_level: 'ok', daily_budget_usd: 0.001 });
    expect(Number(limit!.spent_usd)).toBeGreaterThanOrEqual(0.05);
    expect(w.records.some((r) => r.msg === 'pipeline: daily budget exhausted, scan paused' && r.scan_id === scanId)).toBe(true);
    expect(llmCalls(w)).toHaveLength(0);
    expect(w.records.filter((r) => r.msg === 'pipeline stage')).toHaveLength(0);

    const s = await scanRow(scanId);
    expect(s).toMatchObject({ stage: 'preflight', error: 'budget_paused' });
    const q = await queued(scanId);
    console.log(`[p4 hard] scan=${JSON.stringify(s)} queue=${JSON.stringify(q)}`);
    expect(q).toHaveLength(1);
    expect(q[0]!.msg_id).not.toBe(oldMsg); // новое сообщение, старое подтверждено
    expect(q[0]!.read_ct).toBe(0);
    expect(q[0]!.delayed).toBe(true);
    expect(q[0]!.delay_s).toBeGreaterThan(PIPELINE.budgetPauseSeconds - 60);
    expect(await cardRow(scanId)).toBeUndefined();
  });

  it('§11 п.4 бюджет soft: DAILY_BUDGET_USD = расход/0.9 → S3 пропущен (skipped_budget), тир ≤ rare, 0 вызовов', { timeout: 180_000 }, async () => {
    const userId = await createUser('p4s');
    await createSpentScan(userId, 0.05);
    const spent = await spentTodayUsd();
    const budget = spent / 0.9; // 90 % — между soft (80 %) и hard (100 %)
    // confidence 0.55 — в полосе ESCALATION_CONFIDENCE_BAND → триггер S3
    const scanId = await createScan(userId, { image: await rockImage(), seedMain: mainResult(0.55) });
    await enqueue(scanId);

    const w = await startWorker('p4-soft', { DAILY_BUDGET_USD: budget.toFixed(6) });
    try {
      await w.waitUntil((rs) => rs.some((r) => r.msg === 'scan processed' && r.scan_id === scanId), 150_000, 'scan processed');
    } finally {
      await stopChecked(w);
    }
    console.log(`[p4 soft] spent_today=$${spent.toFixed(4)} DAILY_BUDGET_USD=${budget.toFixed(6)}\n${excerpt(w, (r) => r.msg !== 'queues empty')}`);

    const soft = w.records.find((r) => r.msg === 'budget: soft limit reached, escalation disabled');
    expect(soft).toMatchObject({ level: 'warn', budget_level: 'soft' });
    const skipped = w.records.find((r) => r.msg === 'pipeline: escalation skipped (daily budget ≥ soft limit)' && r.scan_id === scanId);
    expect(skipped).toBeDefined();
    expect(skipped!.triggers).toEqual(['confidence_band']);
    expect(llmCalls(w)).toHaveLength(0);

    const s = await scanRow(scanId);
    const card = await cardRow(scanId);
    const meta = card?.score_breakdown.meta as { escalation: string; budget_soft: boolean; triggers: string[] };
    console.log(`[p4 soft] scan=${JSON.stringify(s)} card=${JSON.stringify(card && { rock_class: card.rock_class, tier: card.tier, score: card.score, provisional: card.provisional, meta })}`);
    expect(s).toMatchObject({ stage: 'done', error: null });
    expect(card).toBeDefined();
    expect(meta.escalation).toBe('skipped_budget');
    expect(meta.budget_soft).toBe(true);
    expect(['common', 'uncommon', 'rare']).toContain(card!.tier);
    expect(card!.provisional).toBe(false);
    expect(await resultRows(scanId)).toHaveLength(2); // gate + main (seeded), без escalation
  });

  it('§11 п.5 pHash: пересъёмка того же камня (+5 % яркости, кроп 1 %) → phash_hit, копия карточки, 0 вызовов', { timeout: 240_000 }, async () => {
    const userId = await createUser('p5');
    const first = await createScan(userId, { image: await rockImage(), seedMain: mainResult(0.9) });
    await enqueue(first);

    const w = await startWorker('p5', {});
    let second = '';
    try {
      await w.waitUntil((rs) => rs.some((r) => r.msg === 'scan processed' && r.scan_id === first), 120_000, 'first scan processed');
      second = await createScan(userId, { image: await rockImageRetake() }); // без пред-записи: только pHash спасает от вызовов
      await enqueue(second);
      await w.waitUntil((rs) => rs.some((r) => r.msg === 'scan processed' && r.scan_id === second), 90_000, 'second scan processed');
    } finally {
      await stopChecked(w);
    }
    console.log(`[p5] worker log:\n${excerpt(w, (r) => r.msg !== 'queues empty')}`);

    expect(llmCalls(w)).toHaveLength(0);
    const hit = w.records.find((r) => r.msg === 'pipeline stage' && r.stage === 'preflight' && r.phash_hit === true && r.scan_id === second);
    expect(hit).toBeDefined();
    expect(hit!.source_scan_id).toBe(first);
    expect(Number(hit!.distance)).toBeLessThanOrEqual(PIPELINE.phashMaxDistance);

    const c1 = await cardRow(first);
    const c2 = await cardRow(second);
    const s2 = await scanRow(second);
    const r2 = await resultRows(second);
    const hashes = (await ctx.pool.query('select scan_id, phash from lithos.scan_photos where scan_id = any($1::uuid[]) order by scan_id', [[first, second]])).rows;
    console.log(`[p5] distance=${hit!.distance} phash=${JSON.stringify(hashes)} scan2=${JSON.stringify(s2)} results2=${JSON.stringify(r2)} card2=${JSON.stringify(c2 && { rock_class: c2.rock_class, tier: c2.tier, score: c2.score, name: c2.name, phash_hit: c2.score_breakdown.phash_hit })}`);
    expect(s2).toMatchObject({ stage: 'done', error: null, cost_usd: 0 });
    expect(r2).toEqual([{ stage: 'preflight', provider: 'phash_cache', model: null, cost_usd: 0 }]);
    expect(c2).toBeDefined();
    expect(c2!.id).not.toBe(c1!.id);
    expect(c2!.rock_class).toBe(c1!.rock_class);
    expect(c2!.name).toBe(c1!.name);
    expect(c2!.score).toBe(c1!.score);
    expect(c2!.score_breakdown.phash_hit).toMatchObject({ source_scan_id: first, source_card_id: c1!.id });
    // Дневник не задвоился
    const diary = (await ctx.pool.query('select count(*)::int as n from lithos.diary where user_id = $1', [userId])).rows[0] as { n: number };
    expect(diary.n).toBeLessThanOrEqual(1);
  });
});

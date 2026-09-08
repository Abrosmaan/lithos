// T3.4, opt-in: лимит сканов на реальной БД через реальный RPC lithos.enqueue_scan (миграция 0005).
// Запуск: PIPELINE_INTEGRATION=1 pnpm --filter worker test -- rate-limit
// Пользователь эмулируется как в PostgREST: set local role authenticated + request.jwt.claims.sub.
// Создаёт тестового user, вставляет сканы, зовёт RPC, всё удаляет (user → cascade). Прод-строки не трогает.
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { MAX_SCANS_PER_DAY, NEW_ACCOUNT_HOURS, NEW_ACCOUNT_SCANS_PER_DAY } from '@lithos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir = process.cwd();
for (let i = 0; i < 4 && !existsSync(resolve(dir, '.env')); i++) dir = dirname(dir);
dotenv.config({ path: resolve(dir, '.env') });

const url = process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL;
const enabled = process.env.PIPELINE_INTEGRATION === '1' && !!url;

describe.skipIf(!enabled)('enqueue_scan: лимит сканов (реальная БД)', { timeout: 120_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2, options: '-c search_path=lithos,public' });
  const users: string[] = [];
  const sentMsgs: string[] = [];

  /** Выполнить запрос от имени authenticated-пользователя (RLS + auth.uid()), как через PostgREST. */
  async function asUser(authId: string, sql: string, params: unknown[] = []) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authId, role: 'authenticated' })]);
      const r = await c.query(sql, params);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async function createUser(ageHours: number) {
    const authId = randomUUID();
    const { rows } = await pool.query<{ id: string }>(
      `insert into lithos.users (auth_user_id, device_id, created_at) values ($1, $2, now() - make_interval(hours => $3::int)) returning id`,
      [authId, `t34-${authId}`, ageHours],
    );
    users.push(rows[0]!.id);
    return { authId, userId: rows[0]!.id };
  }

  async function insertScan(u: { authId: string; userId: string }) {
    const id = randomUUID();
    const { rows } = await asUser(u.authId, `insert into lithos.scans (id, user_id) values ($1, $2) returning stage, error`, [id, u.userId]);
    return { id, ...(rows[0] as { stage: string; error: string | null }) };
  }

  async function enqueue(u: { authId: string }, scanId: string) {
    const { rows } = await asUser(u.authId, 'select lithos.enqueue_scan($1) as msg', [scanId]);
    const msg = String(rows[0]!.msg);
    if (msg !== '-1') sentMsgs.push(msg);
    return msg;
  }

  beforeAll(async () => {
    await pool.query('select 1');
  });

  afterAll(async () => {
    for (const m of sentMsgs) await pool.query(`select pgmq.delete('scan_interactive', $1::bigint)`, [m]).catch(() => undefined);
    for (const id of users) await pool.query('delete from lithos.users where id = $1', [id]);
    await pool.end();
  });

  it(`старый аккаунт: ${MAX_SCANS_PER_DAY} сканов ок, ${MAX_SCANS_PER_DAY + 1}-й → rate_limited (P0001) + scans failed/rate_limited`, async () => {
    const u = await createUser(NEW_ACCOUNT_HOURS + 24);
    for (let i = 0; i < MAX_SCANS_PER_DAY; i++) {
      const s = await insertScan(u);
      expect(s.stage, `scan #${i + 1}`).toBe('preflight');
    }
    const eleventh = await insertScan(u);
    expect(eleventh).toMatchObject({ stage: 'failed', error: 'rate_limited' });

    let err: unknown;
    await enqueue(u, eleventh.id).catch((e) => (err = e));
    expect(err).toBeInstanceOf(Error);
    expect((err as pg.DatabaseError).code).toBe('P0001');
    expect((err as Error).message).toBe('rate_limited');

    // Отклонённые лимитом сканы не считаются: ещё один → тоже rate_limited, а не «12 из 10».
    const twelfth = await insertScan(u);
    expect(twelfth).toMatchObject({ stage: 'failed', error: 'rate_limited' });
    const { rows } = await pool.query<{ n: string }>(`select count(*) n from lithos.scans where user_id = $1 and error = 'rate_limited'`, [u.userId]);
    expect(Number(rows[0]!.n)).toBe(2);
    console.log(`[T3.4] old account: ${MAX_SCANS_PER_DAY} ok, #${MAX_SCANS_PER_DAY + 1} → ${(err as pg.DatabaseError).code} ${(err as Error).message}, scans.error=${eleventh.error}`);
  });

  it(`новый аккаунт: ${NEW_ACCOUNT_SCANS_PER_DAY} сканов ок, ${NEW_ACCOUNT_SCANS_PER_DAY + 1}-й → rate_limited`, async () => {
    const u = await createUser(1);
    for (let i = 0; i < NEW_ACCOUNT_SCANS_PER_DAY; i++) {
      const s = await insertScan(u);
      expect(s.stage, `scan #${i + 1}`).toBe('preflight');
    }
    const extra = await insertScan(u);
    expect(extra).toMatchObject({ stage: 'failed', error: 'rate_limited' });
    await expect(enqueue(u, extra.id)).rejects.toThrow('rate_limited');
    console.log(`[T3.4] new account: ${NEW_ACCOUNT_SCANS_PER_DAY} ok, #${NEW_ACCOUNT_SCANS_PER_DAY + 1} → rate_limited`);
  });

  it('enqueue идемпотентен: повтор → -1, одно сообщение, лимит не тратится; страховка в RPC при откате stage', async () => {
    const u = await createUser(NEW_ACCOUNT_HOURS + 24);
    const s = await insertScan(u);
    const first = await enqueue(u, s.id);
    expect(first).not.toBe('0');
    expect(await enqueue(u, s.id)).toBe('-1');
    const { rows } = await pool.query<{ n: string }>(`select count(*) n from pgmq.q_scan_interactive where message->>'scan_id' = $1`, [s.id]);
    expect(Number(rows[0]!.n)).toBe(1);
    const scan = await pool.query<{ enqueued_at: Date | null }>('select enqueued_at from lithos.scans where id = $1', [s.id]);
    expect(scan.rows[0]!.enqueued_at).not.toBeNull();

    // Ещё 9 сканов → лимит 10 исчерпан; 11-й отклонён триггером. Stage «вернули» в preflight (как postgres — клиенту
    // после 0006 нельзя) → enqueue_scan всё равно бросает rate_limited (проверка в RPC, не только в триггере).
    for (let i = 0; i < MAX_SCANS_PER_DAY - 1; i++) await insertScan(u);
    const over = await insertScan(u);
    expect(over.error).toBe('rate_limited');
    await pool.query(`update lithos.scans set stage = 'preflight', error = null where id = $1`, [over.id]);
    await expect(enqueue(u, over.id)).rejects.toThrow('rate_limited');
    console.log('[T3.4] idempotent enqueue: second call → -1, one message in queue; RPC re-check after stage reset → rate_limited');
  });

  it('0006: authenticated не может менять scans.stage/error, users кроме display_name, cards кроме user_name (permission denied)', async () => {
    const u = await createUser(48);
    const s = await insertScan(u);
    const denied = async (sql: string, params: unknown[]) => {
      let err: unknown;
      await asUser(u.authId, sql, params).catch((e) => (err = e));
      expect((err as pg.DatabaseError | undefined)?.code, sql).toBe('42501');
    };
    await denied(`update lithos.scans set stage = 'done' where id = $1`, [s.id]);
    await denied(`update lithos.scans set error = null where id = $1`, [s.id]);
    await denied(`update lithos.scans set cost_usd = 0 where id = $1`, [s.id]);
    await denied(`update lithos.users set created_at = now() where id = $1`, [u.userId]);
    await denied(`update lithos.users set device_id = 'x' where id = $1`, [u.userId]);
    // Разрешённые колонки — как в клиенте (scan.ts шаг 1, profile.ts, cards.ts).
    await asUser(u.authId, `update lithos.scans set lat = 1, lng = 2, accuracy_m = 3, user_tests = '{}'::jsonb, parent_card_id = null where id = $1 and stage = 'preflight'`, [s.id]);
    await asUser(u.authId, `update lithos.users set display_name = 'T3.4' where id = $1`, [u.userId]);
    const { rows } = await pool.query<{ id: string }>(
      `insert into lithos.cards (scan_id, user_id, rock_class, tier, score, score_breakdown) values ($1, $2, 'granite', 'common', 1, '{}'::jsonb) returning id`,
      [s.id, u.userId],
    );
    await denied(`update lithos.cards set tier = 'legendary' where id = $1`, [rows[0]!.id]);
    await denied(`update lithos.cards set verification = 'expert' where id = $1`, [rows[0]!.id]);
    await asUser(u.authId, `update lithos.cards set user_name = 'Мой' where id = $1`, [rows[0]!.id]);
    console.log('[T3.4] 0006 column grants: stage/error/cost/created_at/device_id/tier/verification → 42501; lat..parent_card_id, display_name, user_name → ok');
  });

  it('чужой скан → not owned; неизвестная очередь → ошибка', async () => {
    const a = await createUser(48);
    const b = await createUser(48);
    const s = await insertScan(a);
    await expect(enqueue(b, s.id)).rejects.toThrow(/not found or not owned/);
    await expect(asUser(a.authId, `select lithos.enqueue_scan($1, 'nope')`, [s.id])).rejects.toThrow(/unknown queue/);
  });
});

import { BUDGET_SOFT_RATIO } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import { createBudgetGuard, pgSpentTodayUsd } from './budget.js';

function harness(dailyBudgetUsd: number, spent: () => number | Promise<number>) {
  const clock = { t: 1_000_000 };
  const logs: Array<{ level: string; msg: string }> = [];
  const fields: Array<Record<string, unknown> | undefined> = [];
  let queries = 0;
  const guard = createBudgetGuard(
    { dailyBudgetUsd, cacheMs: 30_000 },
    {
      spentTodayUsd: async () => {
        queries++;
        return spent();
      },
      now: () => clock.t,
      log: {
        info: (msg, f) => (logs.push({ level: 'info', msg }), fields.push(f)),
        warn: (msg, f) => (logs.push({ level: 'warn', msg }), fields.push(f)),
        error: (msg, f) => (logs.push({ level: 'error', msg }), fields.push(f)),
      },
    },
  );
  return { guard, clock, logs, fields, queries: () => queries };
}

describe('budget guard (лимит $1)', () => {
  it('< 80 % → ok; ≥ 80 % → soft; ≥ 100 % → hard', async () => {
    let spent = 0.5;
    const h = harness(1, () => spent);
    expect(await h.guard.level()).toBe('ok');
    spent = 0.8;
    h.guard.invalidate();
    expect(await h.guard.level()).toBe('soft');
    expect(h.logs.at(-1)).toEqual({ level: 'warn', msg: 'budget: soft limit reached, escalation disabled' });
    spent = 1.0;
    h.guard.invalidate();
    expect(await h.guard.level()).toBe('hard');
    expect(h.logs.at(-1)).toEqual({ level: 'error', msg: 'budget: daily limit reached, pausing scans' });
    // T4.1: поле `level` перекрывало уровень записи в log.ts (в JSON-логе было level=hard вместо error)
    expect(h.fields.at(-1)).toEqual({ budget_level: 'hard', prev_level: 'soft', spent_usd: 1, daily_budget_usd: 1 });
    expect(h.fields.at(-1)).not.toHaveProperty('level');
    expect(h.guard.snapshot()).toMatchObject({ level: 'hard', spentUsd: 1, dailyBudgetUsd: 1 });
    expect(BUDGET_SOFT_RATIO).toBe(0.8);
  });

  it('кэш 30 с: повторные вызовы не ходят в БД, после 30 с — ходят; параллельные вызовы — один запрос', async () => {
    let spent = 0;
    const h = harness(1, () => spent);
    await Promise.all([h.guard.level(), h.guard.level(), h.guard.level()]);
    expect(h.queries()).toBe(1);
    spent = 5;
    h.clock.t += 29_999;
    expect(await h.guard.level()).toBe('ok');
    expect(h.queries()).toBe(1);
    h.clock.t += 1;
    expect(await h.guard.level()).toBe('hard');
    expect(h.queries()).toBe(2);
  });

  it('новые UTC-сутки (расход снова мал) → уровень возвращается к ok с логом', async () => {
    let spent = 2;
    const h = harness(1, () => spent);
    expect(await h.guard.level()).toBe('hard');
    spent = 0;
    h.clock.t += 31_000;
    expect(await h.guard.level()).toBe('ok');
    expect(h.logs.at(-1)).toEqual({ level: 'info', msg: 'budget: back to normal' });
  });

  it('ошибка запроса → последний известный уровень + warn, конвейер не останавливается', async () => {
    let fail = false;
    const h = harness(1, () => {
      if (fail) throw new Error('db down');
      return 0.9;
    });
    expect(await h.guard.level()).toBe('soft');
    fail = true;
    h.clock.t += 31_000;
    expect(await h.guard.level()).toBe('soft');
    expect(h.logs.at(-1)).toEqual({ level: 'warn', msg: 'budget: spend query failed, keeping last level' });
    expect(h.fields.at(-1)).toMatchObject({ budget_level: 'soft' });
    expect(h.fields.at(-1)).not.toHaveProperty('level');
  });

  it('бюджет 0 → предохранитель выключен, БД не опрашивается', async () => {
    const h = harness(0, () => 1_000_000);
    expect(await h.guard.level()).toBe('ok');
    expect(h.queries()).toBe(0);
  });
});

describe('pgSpentTodayUsd', () => {
  it('суммирует scans.cost_usd за UTC-сутки, пусто → 0', async () => {
    const sqls: string[] = [];
    const read = pgSpentTodayUsd({
      query: async (sql) => {
        sqls.push(sql);
        return { rows: [{ usd: '1.25' }] };
      },
    });
    expect(await read()).toBe(1.25);
    expect(sqls[0]).toMatch(/sum\(cost_usd\)/);
    expect(sqls[0]).toMatch(/at time zone 'utc'/);
    expect(await pgSpentTodayUsd({ query: async () => ({ rows: [] }) })()).toBe(0);
  });
});

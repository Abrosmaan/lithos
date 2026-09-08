// Бюджетный предохранитель (ai-pipeline §7 «Что ещё», dev-plan T3.4): дневной расход = sum(scans.cost_usd) за текущие
// UTC-сутки против DAILY_BUDGET_USD. ≥ BUDGET_SOFT_RATIO → 'soft' (S3 выключен, тир ≤ FALLBACK_MAX_TIER);
// ≥ 100 % → 'hard' (сканы не обрабатываются: scans.error='budget_paused', сообщение — обратно в очередь на 10 мин).
// Пороги — @lithos/shared (budgetLevel); здесь только кэш (30 с) и запрос к БД.
import { budgetLevel, type BudgetLevel } from '@lithos/shared';
import type { Logger } from '../pipeline/types.js';

export type { BudgetLevel } from '@lithos/shared';

export interface BudgetGuardOptions {
  /** 0 → предохранитель выключен (всегда 'ok'). */
  dailyBudgetUsd: number;
  /** Кэш расхода; чаще в БД не ходим. */
  cacheMs: number;
}

export interface BudgetGuardDeps {
  /** sum(scans.cost_usd) за текущие UTC-сутки. */
  spentTodayUsd: () => Promise<number>;
  now: () => number;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export interface BudgetSnapshot {
  level: BudgetLevel;
  spentUsd: number;
  dailyBudgetUsd: number;
  checkedAt: number | null;
}

export interface BudgetGuard {
  level(): Promise<BudgetLevel>;
  snapshot(): BudgetSnapshot;
  /** Сбросить кэш (после записи стоимости ступени — чтобы порог сработал без задержки). */
  invalidate(): void;
}

export function createBudgetGuard(opts: BudgetGuardOptions, deps: BudgetGuardDeps): BudgetGuard {
  const enabled = opts.dailyBudgetUsd > 0 && Number.isFinite(opts.dailyBudgetUsd);
  let cached: BudgetSnapshot = { level: 'ok', spentUsd: 0, dailyBudgetUsd: opts.dailyBudgetUsd, checkedAt: null };
  let pending: Promise<BudgetSnapshot> | null = null;

  async function refresh(): Promise<BudgetSnapshot> {
    try {
      const spentUsd = await deps.spentTodayUsd();
      const level = budgetLevel(spentUsd, opts.dailyBudgetUsd);
      if (level !== cached.level) {
        // Не `level`: поле перекрыло бы уровень записи лога (`log.ts` кладёт fields поверх {ts, level, msg}) — T4.1.
        const fields = { budget_level: level, prev_level: cached.level, spent_usd: Number(spentUsd.toFixed(4)), daily_budget_usd: opts.dailyBudgetUsd };
        if (level === 'hard') deps.log.error('budget: daily limit reached, pausing scans', fields);
        else if (level === 'soft') deps.log.warn('budget: soft limit reached, escalation disabled', fields);
        else deps.log.info('budget: back to normal', fields);
      }
      cached = { level, spentUsd, dailyBudgetUsd: opts.dailyBudgetUsd, checkedAt: deps.now() };
    } catch (e) {
      // Не смогли прочитать расход — не останавливаем конвейер, держим последний известный уровень.
      deps.log.warn('budget: spend query failed, keeping last level', { budget_level: cached.level, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      cached = { ...cached, checkedAt: deps.now() };
    }
    return cached;
  }

  return {
    async level() {
      if (!enabled) return 'ok';
      const fresh = cached.checkedAt !== null && deps.now() - cached.checkedAt < opts.cacheMs;
      if (fresh) return cached.level;
      pending ??= refresh().finally(() => (pending = null));
      return (await pending).level;
    },
    snapshot: () => ({ ...cached }),
    invalidate: () => {
      cached = { ...cached, checkedAt: null };
    },
  };
}

/** Расход за текущие UTC-сутки по scans.cost_usd (обновляется воркером после каждой ступени, T2.1). */
export function pgSpentTodayUsd(db: { query: (sql: string) => Promise<{ rows: Array<{ usd: number | string | null }> }> }): () => Promise<number> {
  return async () => {
    const { rows } = await db.query(
      `select coalesce(sum(cost_usd), 0)::float8 as usd
         from lithos.scans
        where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')`,
    );
    return Number(rows[0]?.usd ?? 0);
  };
}

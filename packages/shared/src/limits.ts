// Лимиты и антифрод — ai-pipeline §4 «Лимиты», §7 «Бюджетный предохранитель», spec §11 «Антифрод», §13.
// ЕДИНСТВЕННОЕ место с балансовыми числами лимитов (dev-plan §5.3). Хардкод в воркере/клиенте — дефект.
//
// Исключение (единственное разрешённое дублирование): SQL-функция lithos.enqueue_scan не может импортировать
// TypeScript, поэтому числа сканов/день сидятся в таблицу lithos.limits миграцией 0005 из SCAN_LIMIT_SEED.
// Тест apps/worker/src/limits/limits-migration.test.ts читает миграцию и сверяет её числа с этим файлом.
import type { Tier } from './enums.js';
import { tierRank } from './score.js';

/** Сканов в сутки на устройство (free, spec §13). Скользящее окно 24 ч. */
export const MAX_SCANS_PER_DAY = 10;
/** Новый аккаунт первые NEW_ACCOUNT_HOURS часов — больше сканов, независимо от тарифа (ai-pipeline §4). */
export const NEW_ACCOUNT_SCANS_PER_DAY = 20;
export const NEW_ACCOUNT_HOURS = 24;

/** Доля дневного бюджета, после которой S3 Escalation выключается, тир ограничен FALLBACK_MAX_TIER (ai-pipeline §7). */
export const BUDGET_SOFT_RATIO = 0.8;

/** Гео-аномалия (порода невозможна в точке, механизма нет) отправляется на ревью только от этого тира (spec §11). */
export const ANOMALY_REVIEW_MIN_TIER: Tier = 'epic';

/** Ключи таблицы lithos.limits и их значения — источник для сида миграции. */
export const SCAN_LIMIT_SEED = {
  max_scans_per_day: MAX_SCANS_PER_DAY,
  new_account_scans_per_day: NEW_ACCOUNT_SCANS_PER_DAY,
  new_account_hours: NEW_ACCOUNT_HOURS,
} as const;
export type ScanLimitKey = keyof typeof SCAN_LIMIT_SEED;

const HOUR_MS = 3_600_000;

/** Лимит сканов/сутки для аккаунта по его возрасту (та же логика, что в lithos.scan_limit_exceeded). */
export function scanLimitFor(accountCreatedAt: Date | string | number, now: Date | number = Date.now()): number {
  const created = new Date(accountCreatedAt).getTime();
  const at = typeof now === 'number' ? now : now.getTime();
  return at - created < NEW_ACCOUNT_HOURS * HOUR_MS ? NEW_ACCOUNT_SCANS_PER_DAY : MAX_SCANS_PER_DAY;
}

/** S4: гео-аномалия + внутренний тир ≥ ANOMALY_REVIEW_MIN_TIER → cards.verification='pending_review', тир как «?». */
export function needsAnomalyReview(geoAnomaly: boolean, internalTier: Tier): boolean {
  return geoAnomaly && tierRank(internalTier) >= tierRank(ANOMALY_REVIEW_MIN_TIER);
}

export type BudgetLevel = 'ok' | 'soft' | 'hard';

/** Уровень бюджетного предохранителя по расходу за сутки: ≥ 100 % → hard (пауза), ≥ BUDGET_SOFT_RATIO → soft (без S3). */
export function budgetLevel(spentUsd: number, dailyBudgetUsd: number): BudgetLevel {
  if (!(dailyBudgetUsd > 0) || !Number.isFinite(dailyBudgetUsd)) return 'ok';
  if (spentUsd >= dailyBudgetUsd) return 'hard';
  if (spentUsd >= dailyBudgetUsd * BUDGET_SOFT_RATIO) return 'soft';
  return 'ok';
}

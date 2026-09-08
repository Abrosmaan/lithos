// Конфиг лимитов воркера (T3.4): RPM провайдеров для token bucket и дневной бюджет USD (dev-plan §6).
// Чистая функция без чтения .env — .env грузит apps/worker/src/config.ts. Балансовые числа игры — в @lithos/shared.
import { PROVIDERS, type Provider } from '../llm/config.js';

export interface LimitsConfig {
  /** Запросов в минуту на провайдера (ai-pipeline §4: глобальный token bucket под лимиты провайдера). 0 → без лимита. */
  providerRpm: Record<Provider, number>;
  /** Дневной лимит расхода на API, USD (ai-pipeline §7). 0 → предохранитель выключен. */
  dailyBudgetUsd: number;
}

export const LIMITS_DEFAULTS = {
  providerRpm: 50,
  dailyBudgetUsd: 50,
} as const;

function num(raw: string | undefined, name: string, fallback: number): number {
  const s = raw?.trim();
  if (!s) return fallback;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name}: expected a non-negative number, got "${s}"`);
  return v;
}

export function loadLimitsConfig(env: NodeJS.ProcessEnv = process.env): LimitsConfig {
  const providerRpm = {} as Record<Provider, number>;
  for (const p of PROVIDERS) providerRpm[p] = num(env[`PROVIDER_RPM_${p.toUpperCase()}`], `PROVIDER_RPM_${p.toUpperCase()}`, LIMITS_DEFAULTS.providerRpm);
  return { providerRpm, dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 'DAILY_BUDGET_USD', LIMITS_DEFAULTS.dailyBudgetUsd) };
}

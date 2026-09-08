import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadLimitsConfig } from './limits/config.js';
import { loadLlmConfig } from './llm/config.js';

// .env лежит в корне монорепо; воркер запускается из apps/worker (dev) или /app/apps/worker (docker).
// Ищем вверх по дереву — первый найденный. На VPS env_file подаёт переменные напрямую.
function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) {
      dotenv.config({ path: p });
      return;
    }
    dir = dirname(dir);
  }
}
loadEnv();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// T1.3: ступени, fallback и ключи моделей — разбор в llm/config.ts (чистая функция, тестируется без .env).
const llm = loadLlmConfig(process.env);
// T3.4: RPM провайдеров (PROVIDER_RPM_ANTHROPIC / PROVIDER_RPM_GOOGLE) и дневной бюджет (DAILY_BUDGET_USD).
const limits = loadLimitsConfig(process.env);

export const config = {
  // Pooler (IPv4, session mode) работает и с мака, и с VPS; direct — IPv6-only. Порядок: явный → pooler → direct.
  // Getter: ошибка «Missing env» возникает при первом обращении, а не при импорте модуля —
  // так llm/smoke и тесты не требуют БД-переменных.
  get dbUrl(): string {
    return process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL ?? req('SUPABASE_DB_URL');
  },
  dbSchema: process.env.DB_SCHEMA ?? 'lithos',
  // T2.1: Storage под service-ключом (только воркер; в лог и клиент не попадает). Ленивые getter'ы — как dbUrl.
  get supabaseUrl(): string {
    return req('SUPABASE_URL');
  },
  get supabaseServiceKey(): string {
    return process.env.SUPABASE_SERVICE_KEY ?? req('SUPABASE_SERVICE_ROLE_KEY');
  },
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 1000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // ---- Модели (T1.3) ----
  stageGate: llm.stages.gate,
  stageMain: llm.stages.main,
  stageEscalation: llm.stages.escalation,
  fallbackProvider: llm.fallbackProvider,
  /** Полный конфиг провайдерного слоя (ступени + fallback + ключи). Ключи не логировать. */
  llm,

  // ---- Лимиты (T3.4) ----
  /** Token bucket под RPM провайдера и дневной бюджет USD; балансовые числа лимитов — в @lithos/shared. */
  limits,
};

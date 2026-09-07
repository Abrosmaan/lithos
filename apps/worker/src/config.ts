import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

export const config = {
  // Pooler (IPv4, session mode) работает и с мака, и с VPS; direct — IPv6-only. Порядок: явный → pooler → direct.
  dbUrl: process.env.WORKER_DB_URL ?? process.env.SUPABASE_DB_POOLER_URL ?? req('SUPABASE_DB_URL'),
  dbSchema: process.env.DB_SCHEMA ?? 'lithos',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 1000),
  leaseSeconds: 60,
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

// Прогон SQL-миграций из supabase/migrations по порядку имён. Идемпотентно:
// журнал — lithos.schema_migrations. Подключение: SUPABASE_DB_POOLER_URL (IPv4, мак)
// или SUPABASE_DB_URL (IPv6, VPS). Секреты не печатаются.
//   node scripts/db-migrate.mjs           # применить pending
//   node scripts/db-migrate.mjs --status  # показать статус
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));
const url = process.env.SUPABASE_DB_POOLER_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Нет SUPABASE_DB_POOLER_URL / SUPABASE_DB_URL в .env');
  process.exit(1);
}
const statusOnly = process.argv.includes('--status');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('create schema if not exists lithos');
  await client.query(
    'create table if not exists lithos.schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set((await client.query('select name from lithos.schema_migrations')).rows.map((r) => r.name));
  const dir = root + 'supabase/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (statusOnly) {
    for (const f of files) console.log(applied.has(f) ? 'applied ' : 'pending ', f);
    process.exit(0);
  }
  for (const f of files) {
    if (applied.has(f)) {
      console.log('skip ', f);
      continue;
    }
    const sql = readFileSync(dir + '/' + f, 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into lithos.schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
      console.log('apply', f);
    } catch (e) {
      await client.query('rollback');
      throw new Error(f + ': ' + e.message);
    }
  }
  console.log('Миграции применены.');
} finally {
  await client.end();
}

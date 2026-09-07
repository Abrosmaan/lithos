import pg from 'pg';
import { config } from './config.js';

// Один пул на процесс. search_path — схема проекта, затем public (pgmq живёт в схеме pgmq).
export const pool = new pg.Pool({
  connectionString: config.dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 4,
  // T2.1: залипший запрос не должен держать слот конвейера вечно (см. consumer: жёсткий дедлайн задачи).
  connectionTimeoutMillis: 10_000,
  query_timeout: 60_000,
  options: `-c search_path=${config.dbSchema},public -c statement_timeout=60000`,
});

export async function closeDb(): Promise<void> {
  await pool.end();
}

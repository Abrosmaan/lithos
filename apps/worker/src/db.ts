import pg from 'pg';
import { config } from './config.js';

// Один пул на процесс. search_path — схема проекта, затем public (pgmq живёт в схеме pgmq).
export const pool = new pg.Pool({
  connectionString: config.dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 4,
  options: `-c search_path=${config.dbSchema},public`,
});

export async function closeDb(): Promise<void> {
  await pool.end();
}

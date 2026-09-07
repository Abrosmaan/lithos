import type { ScanQueue, ScanQueueMessage } from '@lithos/shared';
import { pool } from './db.js';

export interface QueueMessage {
  msgId: string;
  readCount: number;
  payload: ScanQueueMessage;
}

/** Читает одно сообщение с lease (visibility timeout) в секундах. null — очередь пуста. */
export async function readOne(queue: ScanQueue, leaseSeconds: number): Promise<QueueMessage | null> {
  const { rows } = await pool.query<{ msg_id: string; read_ct: number; message: ScanQueueMessage }>(
    'select msg_id, read_ct, message from pgmq.read($1, $2, 1)',
    [queue, leaseSeconds],
  );
  const row = rows[0];
  if (!row) return null;
  return { msgId: row.msg_id, readCount: row.read_ct, payload: row.message };
}

export async function ack(queue: ScanQueue, msgId: string): Promise<void> {
  await pool.query('select pgmq.delete($1, $2::bigint)', [queue, msgId]);
}

/** Продлить lease (pgmq.set_vt): сообщение снова видно через seconds. Используется и как heartbeat, и для короткого retry. */
export async function extendLease(queue: ScanQueue, msgId: string, seconds: number): Promise<void> {
  await pool.query('select pgmq.set_vt($1, $2::bigint, $3::int)', [queue, msgId, seconds]);
}

export async function archive(queue: ScanQueue, msgId: string): Promise<void> {
  await pool.query('select pgmq.archive($1, $2::bigint)', [queue, msgId]);
}

export async function send(queue: ScanQueue, payload: ScanQueueMessage): Promise<string> {
  const { rows } = await pool.query<{ send: string }>('select pgmq.send($1, $2::jsonb)', [queue, JSON.stringify(payload)]);
  return rows[0]!.send;
}

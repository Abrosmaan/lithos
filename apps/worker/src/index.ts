import { SCAN_QUEUES } from '@lithos/shared';
import { config } from './config.js';
import { closeDb, pool } from './db.js';
import { log } from './log.js';
import { readOne, ack } from './queue.js';

// T0.1: hello-цикл. Читает очереди в порядке приоритета, логирует сообщение и подтверждает.
// Настоящий конвейер (S0–S4) появится в T2.1 и заменит handle().

let running = true;

async function handle(queue: string, scanId: string): Promise<void> {
  log.info('scan received (no pipeline yet)', { queue, scan_id: scanId });
}

async function tick(): Promise<boolean> {
  for (const queue of SCAN_QUEUES) {
    const msg = await readOne(queue, config.leaseSeconds);
    if (!msg) continue;
    await handle(queue, msg.payload.scan_id);
    await ack(queue, msg.msgId);
    return true;
  }
  return false;
}

async function main() {
  await pool.query('select 1');
  log.info('worker started', { schema: config.dbSchema, queues: SCAN_QUEUES });
  let idleTicks = 0;
  while (running) {
    try {
      const busy = await tick();
      if (busy) {
        idleTicks = 0;
        continue;
      }
      idleTicks++;
      if (idleTicks % 30 === 1) log.info('queues empty', { idle_ticks: idleTicks });
    } catch (e) {
      log.error('tick failed', { error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
  await closeDb();
  log.info('worker stopped');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    running = false;
  });
}

main().catch((e) => {
  log.error('fatal', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});

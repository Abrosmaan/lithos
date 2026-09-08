import { SCAN_QUEUES } from '@lithos/shared';
import { config } from './config.js';
import { closeDb, pool } from './db.js';
import { getGeoContext } from './geo.js';
import { createBudgetGuard, pgSpentTodayUsd } from './limits/budget.js';
import { createProviderRateLimiter, withProviderRateLimit } from './limits/rate.js';
import { callModel } from './llm/index.js';
import { log } from './log.js';
import { createPipeline } from './pipeline.js';
import { createConsumer } from './pipeline/consumer.js';
import { PIPELINE } from './pipeline/constants.js';
import { PgPipelineRepo } from './pipeline/repo.js';
import { createPhotoStore } from './pipeline/storage.js';
import { ack, archive, extendLease, readOne, send } from './queue.js';

// T2.1: конвейер S0–S4 (pipeline.ts) за потребителем очередей (pipeline/consumer.ts).

let running = true;

async function main() {
  await pool.query('select 1');
  const repo = new PgPipelineRepo(pool);
  // T3.4: token bucket под RPM провайдера (перед каждым callModel) и бюджетный предохранитель (sum scans.cost_usd за UTC-сутки).
  const limiter = createProviderRateLimiter(config.limits.providerRpm);
  const budget = createBudgetGuard(
    { dailyBudgetUsd: config.limits.dailyBudgetUsd, cacheMs: PIPELINE.budgetCacheMs },
    { spentTodayUsd: pgSpentTodayUsd(pool), now: Date.now, log },
  );
  const pipeline = createPipeline({
    repo,
    photos: createPhotoStore(config.supabaseUrl, config.supabaseServiceKey),
    callModel: withProviderRateLimit(callModel, limiter, (stage) => config.llm.stages[stage].provider, log),
    getGeoContext,
    log,
    now: Date.now,
    budget,
  });
  const consumer = createConsumer({
    queue: { readOne, ack, archive, extendLease, send },
    repo,
    runScan: pipeline.runScan,
    log,
    now: Date.now,
  });

  log.info('worker started', {
    schema: config.dbSchema,
    queues: SCAN_QUEUES,
    stages: { gate: config.stageGate, main: config.stageMain, escalation: config.stageEscalation },
    fallback: config.fallbackProvider,
    lease_s: PIPELINE.leaseSeconds,
    chain_timeout_ms: PIPELINE.chainTimeoutMs,
    provider_rpm: config.limits.providerRpm,
    daily_budget_usd: config.limits.dailyBudgetUsd,
  });
  let idleTicks = 0;
  while (running) {
    try {
      const busy = await consumer.tick();
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
  if (consumer.inflightCount() > 0) log.info('waiting for in-flight scans', { inflight: consumer.inflightCount() });
  await consumer.drain();
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

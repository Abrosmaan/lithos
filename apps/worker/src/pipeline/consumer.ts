// Потребитель очередей: scan_interactive → scan_dispute → scan_batch, lease 60 с + heartbeat (pgmq.set_vt),
// DLQ после read_ct > 3, таймаут цепочки 90 с (дальше — в фоне, до maxInflight одновременно),
// жёсткий дедлайн задачи (heartbeat прекращается, слот освобождается, сообщение возвращается по lease).
import { SCAN_QUEUES, type ScanQueue, type ScanQueueMessage } from '@lithos/shared';
import type { QueueMessage } from '../queue.js';
import { PIPELINE } from './constants.js';
import type { Logger, PipelineRepo, RunOutcome } from './types.js';

export interface QueueOps {
  readOne(queue: ScanQueue, leaseSeconds: number): Promise<QueueMessage | null>;
  ack(queue: ScanQueue, msgId: string): Promise<void>;
  archive(queue: ScanQueue, msgId: string): Promise<void>;
  extendLease(queue: ScanQueue, msgId: string, seconds: number): Promise<void>;
  /** Новое сообщение (read_ct = 0), видимое через delaySeconds — T3.4 пауза по бюджету. */
  send(queue: ScanQueue, payload: ScanQueueMessage, delaySeconds: number): Promise<string>;
}

export interface Timer {
  clear(): void;
}

export interface ConsumerDeps {
  queue: QueueOps;
  repo: Pick<PipelineRepo, 'dlqScan'>;
  runScan: (scanId: string, queue: ScanQueue) => Promise<RunOutcome>;
  log: Logger;
  now: () => number;
  /** Инжектируется в тестах (реальные таймеры не нужны). */
  setTimer?: (fn: () => void, ms: number) => Timer;
}

export type MessageOutcome =
  | { kind: 'processed'; outcome: RunOutcome }
  | { kind: 'deferred'; scanId: string }
  | { kind: 'paused'; scanId: string }
  | { kind: 'dlq'; scanId: string }
  | { kind: 'retry'; scanId: string; error: string }
  | { kind: 'abandoned'; scanId: string };

function defaultTimer(fn: () => void, ms: number): Timer {
  const t = setTimeout(fn, ms);
  return { clear: () => clearTimeout(t) };
}

function errorSummary(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);
}

export function createConsumer(deps: ConsumerDeps) {
  const timer = deps.setTimer ?? defaultTimer;
  const inflight = new Set<Promise<MessageOutcome>>();

  function race<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
    let t: Timer | null = null;
    const timeout = new Promise<'timeout'>((r) => {
      t = timer(() => r('timeout'), ms);
    });
    return Promise.race([p, timeout]).finally(() => t?.clear());
  }

  async function handleMessage(queue: ScanQueue, msg: QueueMessage): Promise<MessageOutcome> {
    const scanId = msg.payload?.scan_id;
    const base = { queue, msg_id: msg.msgId, read_ct: msg.readCount, scan_id: scanId };
    if (!scanId) {
      deps.log.error('queue message without scan_id, archiving', base);
      await deps.queue.archive(queue, msg.msgId);
      return { kind: 'dlq', scanId: '' };
    }
    if (msg.readCount > PIPELINE.maxReads) {
      const dlq = await deps.repo.dlqScan(scanId).catch((e) => {
        deps.log.error('dlq: scan update failed', { ...base, error: errorSummary(e) });
        return 'noop' as const;
      });
      await deps.queue.archive(queue, msg.msgId);
      deps.log.error('scan sent to DLQ', { ...base, scan_outcome: dlq });
      return { kind: 'dlq', scanId };
    }

    // Heartbeat: продлеваем lease, пока ступени идут (Opus до 45 с × retry > 60 с), но не дольше jobDeadlineMs.
    const startedAt = deps.now();
    const heartbeat = { handle: null as Timer | null, active: true };
    const stopHeartbeat = () => {
      heartbeat.active = false;
      heartbeat.handle?.clear();
      heartbeat.handle = null;
    };
    const beat = () => {
      if (!heartbeat.active) return;
      heartbeat.handle = timer(() => {
        if (!heartbeat.active) return;
        if (deps.now() - startedAt > PIPELINE.jobDeadlineMs) {
          stopHeartbeat(); // lease истечёт сам — сообщение вернётся в очередь и дойдёт до DLQ
          return;
        }
        deps.queue
          .extendLease(queue, msg.msgId, PIPELINE.leaseSeconds)
          .catch((e) => deps.log.warn('lease extend failed', { ...base, error: errorSummary(e) }))
          .finally(beat);
      }, PIPELINE.leaseHeartbeatMs);
    };
    beat();

    const work = deps.runScan(scanId, queue);
    try {
      const outcome = await race(work, PIPELINE.jobDeadlineMs);
      stopHeartbeat();
      if (outcome === 'timeout') {
        // Зависшая задача: результат (если он когда-нибудь придёт) не подтверждаем — сообщение уже могло уйти другому.
        deps.log.error('pipeline job exceeded hard deadline, abandoning (message returns to queue by lease)', { ...base, deadline_ms: PIPELINE.jobDeadlineMs });
        work.catch(() => undefined);
        return { kind: 'abandoned', scanId };
      }
      if (outcome.status === 'deferred' && outcome.reason === 'budget_paused') {
        // T3.4: бюджет ≥ 100 % — не попытка. Новое сообщение с задержкой (read_ct = 0), старое — ack. Порядок: send → ack,
        // упадём между ними — дубликат, а не потеря (advisory lock + идемпотентность ступеней это переживут).
        const newId = await deps.queue.send(queue, msg.payload, PIPELINE.budgetPauseSeconds);
        await deps.queue.ack(queue, msg.msgId);
        deps.log.warn('scan paused: daily budget exhausted, requeued', { ...base, new_msg_id: newId, delay_s: PIPELINE.budgetPauseSeconds });
        return { kind: 'paused', scanId };
      }
      if (outcome.status === 'deferred') {
        // Скан держит другой процесс: вернуть через полный lease (он успеет доделать → следующее чтение будет no-op/ack).
        // pgmq считает read_ct и на это чтение; если дубликат дойдёт до DLQ, dlqScan увидит lock → 'busy' и скан не тронет.
        await deps.queue.extendLease(queue, msg.msgId, PIPELINE.leaseSeconds).catch(() => undefined);
        deps.log.info('scan deferred', { ...base, reason: outcome.reason });
        return { kind: 'deferred', scanId };
      }
      await deps.queue.ack(queue, msg.msgId);
      deps.log.info('scan processed', { ...base, status: outcome.status, reason: outcome.reason, card_id: outcome.cardId, ms: outcome.ms });
      return { kind: 'processed', outcome };
    } catch (e) {
      stopHeartbeat();
      const error = errorSummary(e);
      deps.log.error('pipeline failed, message will be retried', { ...base, error });
      await deps.queue.extendLease(queue, msg.msgId, PIPELINE.retryDelaySeconds).catch(() => undefined);
      return { kind: 'retry', scanId, error };
    } finally {
      stopHeartbeat();
    }
  }

  /**
   * Один тик: взять первое сообщение по приоритету очередей, обработать. Если цепочка дольше chainTimeoutMs —
   * вернуться (карточка «в обработке»), обработка продолжается в фоне; новые сообщения берутся, пока inflight < maxInflight.
   * Слот в inflight гарантированно освобождается не позже jobDeadlineMs (handleMessage сам отпускает зависшую задачу).
   */
  async function tick(): Promise<boolean> {
    if (inflight.size >= PIPELINE.maxInflight) {
      await Promise.race(inflight);
      return true;
    }
    for (const queue of SCAN_QUEUES) {
      const msg = await deps.queue.readOne(queue, PIPELINE.leaseSeconds);
      if (!msg) continue;
      const job: Promise<MessageOutcome> = handleMessage(queue, msg).finally(() => inflight.delete(job));
      inflight.add(job);
      const winner = await race(job, PIPELINE.chainTimeoutMs);
      if (winner === 'timeout') {
        deps.log.warn('pipeline exceeded chain timeout, continuing in background', { queue, msg_id: msg.msgId, scan_id: msg.payload?.scan_id, timeout_ms: PIPELINE.chainTimeoutMs });
      }
      return true;
    }
    return false;
  }

  /** Дождаться фоновых задач (graceful shutdown), но не дольше timeoutMs. */
  async function drain(timeoutMs: number = PIPELINE.drainTimeoutMs): Promise<boolean> {
    const all = (async () => {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
      return true as const;
    })();
    const r = await race(all, timeoutMs);
    if (r === 'timeout') deps.log.warn('drain timed out, leaving jobs to lease/DLQ', { inflight: inflight.size });
    return r !== 'timeout';
  }

  return { handleMessage, tick, drain, inflightCount: () => inflight.size };
}

export type Consumer = ReturnType<typeof createConsumer>;

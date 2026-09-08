// Глобальный token bucket под RPM провайдера (ai-pipeline §4 «Лимиты»): всплеск сканов не должен отдать 429 всем сразу.
// Один bucket на провайдера на процесс; ёмкость = RPM (burst до минуты), пополнение RPM/мин.
// Токен берётся перед callModel обёрткой withProviderRateLimit — снаружи llm/ (внутри — retry/fallback по §7).
// Время и sleep инжектируются (тесты без реальных таймеров).
import type { CallModelInput, CallModelOutput } from '../llm/types.js';
import type { LlmStage, Provider } from '../llm/config.js';
import type { Logger } from '../pipeline/types.js';

export interface ClockDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const MINUTE_MS = 60_000;

/** Токен не появится в отведённое время (m7): вызывающий решает — retry через очередь, не бесконечное ожидание. */
export class RateLimitWaitError extends Error {
  constructor(
    readonly provider: string | null,
    readonly waitMs: number,
    readonly maxWaitMs: number,
  ) {
    super(`rate limit: next token in ${waitMs} ms exceeds max wait ${maxWaitMs} ms`);
    this.name = 'RateLimitWaitError';
  }
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  readonly capacity: number;
  readonly refillPerMinute: number;

  /** capacity/refillPerMinute ≤ 0 или не число → bucket без ограничения. */
  constructor(capacity: number, refillPerMinute: number, private readonly deps: ClockDeps) {
    const unlimited = !(capacity > 0) || !(refillPerMinute > 0);
    this.capacity = unlimited ? Number.POSITIVE_INFINITY : capacity;
    this.refillPerMinute = unlimited ? Number.POSITIVE_INFINITY : refillPerMinute;
    this.tokens = this.capacity;
    this.last = deps.now();
  }

  get unlimited(): boolean {
    return this.capacity === Number.POSITIVE_INFINITY;
  }

  private refill(): void {
    if (this.unlimited) return;
    const t = this.deps.now();
    if (t <= this.last) return;
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.refillPerMinute) / MINUTE_MS);
    this.last = t;
  }

  /** Сколько токенов доступно сейчас (после пополнения по времени). */
  available(): number {
    this.refill();
    return this.tokens;
  }

  tryTake(): boolean {
    if (this.unlimited) return true;
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Через сколько мс появится целый токен (0 — уже есть). */
  msUntilToken(): number {
    if (this.unlimited) return 0;
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) * MINUTE_MS) / this.refillPerMinute);
  }

  /**
   * Ждать и взять токен. Возвращает, сколько мс ждали. Если ближайший токен дальше, чем осталось от maxWaitMs —
   * RateLimitWaitError (без сна): не держим слот конвейера бесконечно.
   */
  async take(maxWaitMs: number = Number.POSITIVE_INFINITY, provider: string | null = null): Promise<number> {
    const t0 = this.deps.now();
    while (!this.tryTake()) {
      const wait = Math.max(1, this.msUntilToken());
      const elapsed = this.deps.now() - t0;
      if (elapsed + wait > maxWaitMs) throw new RateLimitWaitError(provider, wait, maxWaitMs);
      await this.deps.sleep(wait);
    }
    return this.deps.now() - t0;
  }
}

export interface ProviderRateLimiter {
  /** Ждать токен провайдера; возвращает время ожидания в мс. maxWaitMs превышен → RateLimitWaitError. */
  acquire(provider: Provider, maxWaitMs?: number): Promise<number>;
  stats(): Record<Provider, { available: number; capacity: number }>;
}

const defaultClock: ClockDeps = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export function createProviderRateLimiter(rpm: Record<Provider, number>, deps: ClockDeps = defaultClock): ProviderRateLimiter {
  const buckets = new Map<Provider, TokenBucket>();
  for (const [p, n] of Object.entries(rpm) as Array<[Provider, number]>) buckets.set(p, new TokenBucket(n, n, deps));
  const bucket = (p: Provider) => {
    let b = buckets.get(p);
    if (!b) {
      b = new TokenBucket(0, 0, deps); // неизвестный провайдер — без лимита
      buckets.set(p, b);
    }
    return b;
  };
  return {
    acquire: (p, maxWaitMs) => bucket(p).take(maxWaitMs, p),
    stats: () => {
      const out = {} as Record<Provider, { available: number; capacity: number }>;
      for (const [p, b] of buckets) out[p] = { available: b.available(), capacity: b.capacity };
      return out;
    },
  };
}

export type CallModelFn = (input: CallModelInput) => Promise<CallModelOutput>;

/** Дольше токена не ждём: сообщение вернётся через очередь (retry), слот конвейера освободится. */
export const MAX_TOKEN_WAIT_MS = 120_000;

/**
 * Обёртка callModel: перед вызовом ждёт токен основного провайдера ступени (не дольше maxWaitMs → RateLimitWaitError
 * наружу = временная ошибка → retry через очередь). Fallback и retry внутри llm/ не ограничиваются — при отказе
 * основного провайдера трафик и так падает (breaker), а fallback-провайдер редко под нагрузкой.
 */
export function withProviderRateLimit(
  inner: CallModelFn,
  limiter: ProviderRateLimiter,
  providerFor: (stage: LlmStage) => Provider,
  log?: Pick<Logger, 'info'>,
  maxWaitMs: number = MAX_TOKEN_WAIT_MS,
): CallModelFn {
  return async (input) => {
    const provider = providerFor(input.stage);
    const waitedMs = await limiter.acquire(provider, maxWaitMs);
    if (waitedMs > 0) log?.info('rate limit wait', { scan_id: input.scanId, stage: input.stage, provider, waited_ms: waitedMs });
    return inner(input);
  };
}

// Circuit breaker на провайдера (ai-pipeline §7): скользящее окно 60 с, > 25 % ошибок при ≥ 4 вызовах →
// open на 2 мин → half-open с 10 % пробных вызовов; успех пробы → closed, провал → снова open.
import type { Provider } from './config.js';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  windowMs?: number;
  openMs?: number;
  /** Доля ошибок, выше которой breaker открывается (строго больше). */
  errorRate?: number;
  /** Минимум вызовов в окне, чтобы доля ошибок что-то значила. */
  minCalls?: number;
  /** Доля пропускаемых вызовов в half-open. */
  probeRate?: number;
  now?: () => number;
  random?: () => number;
}

export const BREAKER_DEFAULTS = {
  windowMs: 60_000,
  openMs: 120_000,
  errorRate: 0.25,
  minCalls: 4,
  probeRate: 0.1,
} as const;

interface Sample {
  t: number;
  ok: boolean;
}

export class CircuitBreaker {
  private readonly windowMs: number;
  private readonly openMs: number;
  private readonly errorRate: number;
  private readonly minCalls: number;
  private readonly probeRate: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private samples: Sample[] = [];
  private _state: BreakerState = 'closed';
  private openedAt = 0;

  constructor(opts: BreakerOptions = {}) {
    this.windowMs = opts.windowMs ?? BREAKER_DEFAULTS.windowMs;
    this.openMs = opts.openMs ?? BREAKER_DEFAULTS.openMs;
    this.errorRate = opts.errorRate ?? BREAKER_DEFAULTS.errorRate;
    this.minCalls = opts.minCalls ?? BREAKER_DEFAULTS.minCalls;
    this.probeRate = opts.probeRate ?? BREAKER_DEFAULTS.probeRate;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  get state(): BreakerState {
    this.tick();
    return this._state;
  }

  /** Можно ли делать вызов сейчас. В half-open пропускает ~probeRate вызовов. */
  allow(): boolean {
    this.tick();
    switch (this._state) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half_open':
        return this.random() < this.probeRate;
    }
  }

  onSuccess(): void {
    this.tick();
    if (this._state === 'half_open') {
      this.close();
      return;
    }
    this.record(true);
  }

  onFailure(): void {
    this.tick();
    if (this._state === 'half_open') {
      this.open();
      return;
    }
    this.record(false);
    this.evaluate();
  }

  /**
   * Невалидный вывод модели (схема/пустой ответ): провайдер ответил, это не отказ.
   * Учитывается в знаменателе (вызов), не в числителе (ошибка). В half-open состояние не меняет.
   */
  onSchemaFailure(): void {
    this.tick();
    if (this._state === 'half_open') return;
    this.record(true);
  }

  /** Ручное переключение (мониторинг, ai-pipeline §7). */
  forceOpen(): void {
    this.open();
  }
  forceClose(): void {
    this.close();
  }

  /** Снимок для мониторинга. */
  stats(): { state: BreakerState; calls: number; failures: number } {
    this.tick();
    const failures = this.samples.filter((s) => !s.ok).length;
    return { state: this._state, calls: this.samples.length, failures };
  }

  private tick(): void {
    const t = this.now();
    this.samples = this.samples.filter((s) => t - s.t <= this.windowMs);
    if (this._state === 'open' && t - this.openedAt >= this.openMs) this._state = 'half_open';
  }

  private record(ok: boolean): void {
    this.samples.push({ t: this.now(), ok });
  }

  private evaluate(): void {
    if (this._state !== 'closed') return;
    const calls = this.samples.length;
    if (calls < this.minCalls) return;
    const failures = this.samples.filter((s) => !s.ok).length;
    if (failures / calls > this.errorRate) this.open();
  }

  private open(): void {
    this._state = 'open';
    this.openedAt = this.now();
    this.samples = [];
  }

  private close(): void {
    this._state = 'closed';
    this.samples = [];
  }
}

/** Реестр breaker'ов по провайдеру; один экземпляр на процесс воркера. */
export class BreakerRegistry {
  private readonly breakers = new Map<Provider, CircuitBreaker>();
  constructor(private readonly opts: BreakerOptions = {}) {}

  get(provider: Provider): CircuitBreaker {
    let b = this.breakers.get(provider);
    if (!b) {
      b = new CircuitBreaker(this.opts);
      this.breakers.set(provider, b);
    }
    return b;
  }

  snapshot(): Record<string, ReturnType<CircuitBreaker['stats']>> {
    const out: Record<string, ReturnType<CircuitBreaker['stats']>> = {};
    for (const [p, b] of this.breakers) out[p] = b.stats();
    return out;
  }
}

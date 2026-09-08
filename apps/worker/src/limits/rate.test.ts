import { describe, expect, it } from 'vitest';
import type { CallModelInput, CallModelOutput } from '../llm/types.js';
import { loadLimitsConfig, LIMITS_DEFAULTS } from './config.js';
import { createProviderRateLimiter, RateLimitWaitError, TokenBucket, withProviderRateLimit, type ClockDeps } from './rate.js';

/** Виртуальные часы: sleep двигает время, реальных таймеров нет. */
function clock(start = 0): ClockDeps & { t: number; sleeps: number[] } {
  const c = {
    t: start,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

describe('TokenBucket', () => {
  it('burst до ёмкости, потом ждёт пополнения (60/мин → 1 токен/с)', async () => {
    const c = clock();
    const b = new TokenBucket(2, 60, c);
    expect(await b.take()).toBe(0);
    expect(await b.take()).toBe(0);
    expect(b.tryTake()).toBe(false);
    expect(b.msUntilToken()).toBe(1000);
    const waited = await b.take();
    expect(waited).toBe(1000);
    expect(c.sleeps).toEqual([1000]);
    expect(c.t).toBe(1000);
  });

  it('частичное пополнение: через 500 мс при 60/мин — полтокена, ждём остаток', async () => {
    const c = clock();
    const b = new TokenBucket(1, 60, c);
    expect(b.tryTake()).toBe(true);
    c.t += 500;
    expect(b.available()).toBeCloseTo(0.5);
    expect(b.msUntilToken()).toBe(500);
    expect(await b.take()).toBe(500);
  });

  it('пополнение не превышает ёмкость', () => {
    const c = clock();
    const b = new TokenBucket(3, 60, c);
    c.t += 10 * 60_000;
    expect(b.available()).toBe(3);
  });

  it('take(maxWaitMs): токен дальше лимита ожидания → RateLimitWaitError без сна; в пределах — ждёт', async () => {
    const c = clock();
    const b = new TokenBucket(1, 60, c);
    expect(b.tryTake()).toBe(true);
    await expect(b.take(999, 'anthropic')).rejects.toBeInstanceOf(RateLimitWaitError);
    await expect(b.take(999)).rejects.toMatchObject({ waitMs: 1000, maxWaitMs: 999 });
    expect(c.sleeps).toEqual([]);
    expect(await b.take(1000)).toBe(1000);
  });

  it('rpm=0 → без ограничения', async () => {
    const c = clock();
    const b = new TokenBucket(0, 0, c);
    expect(b.unlimited).toBe(true);
    for (let i = 0; i < 1000; i++) expect(b.tryTake()).toBe(true);
    expect(await b.take()).toBe(0);
    expect(c.sleeps).toEqual([]);
  });

  it('несколько ожидающих: токенов выдаётся не больше, чем пополнилось', async () => {
    const c = clock();
    const b = new TokenBucket(1, 60, c);
    expect(b.tryTake()).toBe(true);
    await Promise.all([b.take(), b.take(), b.take()]);
    // 3 токена при 1/с → минимум 3 с виртуального времени; ничего лишнего не осталось.
    expect(c.t).toBeGreaterThanOrEqual(3000);
    expect(b.available()).toBeLessThan(1);
    expect(b.tryTake()).toBe(false);
  });
});

describe('createProviderRateLimiter + withProviderRateLimit', () => {
  const input = (stage: CallModelInput['stage']): CallModelInput => ({ stage, images: [], userLanguage: 'ru', scanId: 's1' });
  const output = {} as CallModelOutput;

  it('bucket на провайдера: anthropic исчерпан, google свободен', async () => {
    const c = clock();
    const limiter = createProviderRateLimiter({ anthropic: 1, google: 1 }, c);
    expect(await limiter.acquire('anthropic')).toBe(0);
    expect(await limiter.acquire('google')).toBe(0);
    expect(await limiter.acquire('anthropic')).toBe(60_000);
    expect(limiter.stats().google.available).toBe(1);
  });

  it('обёртка ждёт токен основного провайдера ступени и логирует ожидание', async () => {
    const c = clock();
    const limiter = createProviderRateLimiter({ anthropic: 1, google: 50 }, c);
    const calls: string[] = [];
    const logs: Record<string, unknown>[] = [];
    const wrapped = withProviderRateLimit(
      async (i) => {
        calls.push(`${i.stage}@${c.t}`);
        return output;
      },
      limiter,
      (stage) => (stage === 'gate' ? 'google' : 'anthropic'),
      { info: (_m, f) => logs.push(f ?? {}) },
    );
    await wrapped(input('main'));
    await wrapped(input('gate'));
    await wrapped(input('main'));
    expect(calls).toEqual(['main@0', 'gate@0', 'main@60000']);
    expect(logs).toEqual([{ scan_id: 's1', stage: 'main', provider: 'anthropic', waited_ms: 60_000 }]);
  });

  it('обёртка: ожидание дольше maxWaitMs → RateLimitWaitError, модель не вызвана', async () => {
    const c = clock();
    const limiter = createProviderRateLimiter({ anthropic: 1, google: 1 }, c);
    let called = 0;
    const wrapped = withProviderRateLimit(async () => (called++, output), limiter, () => 'anthropic', undefined, 30_000);
    await wrapped(input('main'));
    await expect(wrapped(input('main'))).rejects.toMatchObject({ name: 'RateLimitWaitError', provider: 'anthropic', waitMs: 60_000, maxWaitMs: 30_000 });
    expect(called).toBe(1);
    expect(c.t).toBe(0);
  });
});

describe('loadLimitsConfig', () => {
  it('дефолты: 50 RPM на провайдера, бюджет $50', () => {
    expect(loadLimitsConfig({})).toEqual({ providerRpm: { anthropic: 50, google: 50 }, dailyBudgetUsd: 50 });
    expect(LIMITS_DEFAULTS).toEqual({ providerRpm: 50, dailyBudgetUsd: 50 });
  });
  it('env переопределяет; мусор → ошибка', () => {
    expect(loadLimitsConfig({ PROVIDER_RPM_ANTHROPIC: '10', PROVIDER_RPM_GOOGLE: '0', DAILY_BUDGET_USD: '1' })).toEqual({
      providerRpm: { anthropic: 10, google: 0 },
      dailyBudgetUsd: 1,
    });
    expect(() => loadLimitsConfig({ DAILY_BUDGET_USD: 'abc' })).toThrow(/DAILY_BUDGET_USD/);
    expect(() => loadLimitsConfig({ PROVIDER_RPM_GOOGLE: '-5' })).toThrow(/PROVIDER_RPM_GOOGLE/);
  });
});

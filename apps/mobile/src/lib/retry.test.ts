import { describe, expect, it, vi } from 'vitest';
import { isPermanentError, MSG, toUserMessage, UserError } from './errors';
import { TimeoutError, withRetry, withTimeout } from './retry';

describe('withRetry', () => {
  it('повторяет 3 раза и отдаёт последнюю ошибку', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('net'));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('net');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('успех со второй попытки', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValue('ok');
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('не повторяет UserError с retryable=false (4xx / RLS)', async () => {
    const fn = vi.fn().mockRejectedValue(new UserError(MSG.submitFailed, { cause: { code: '42501', status: 403 } }));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toBeInstanceOf(UserError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('таймаут отменяет через AbortSignal и повторяет', async () => {
    const signals: AbortSignal[] = [];
    const fn = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => {});
    });
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1, timeoutMs: 5 })).rejects.toBeInstanceOf(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

describe('withTimeout', () => {
  it('пропускает быстрый результат', async () => {
    await expect(withTimeout(async () => 1, 50, 't')).resolves.toBe(1);
  });
});

describe('isPermanentError / UserError.retryable', () => {
  it('4xx кроме 408/429 и коды PGRST1xx/42xxx/23xxx — постоянные', () => {
    expect(isPermanentError({ status: 403 })).toBe(true);
    expect(isPermanentError({ statusCode: '404' })).toBe(true);
    expect(isPermanentError({ code: 'PGRST106' })).toBe(true);
    expect(isPermanentError({ code: '42501' })).toBe(true);
    expect(isPermanentError({ code: '23505' })).toBe(true);
    expect(isPermanentError({ status: 408 })).toBe(false);
    expect(isPermanentError({ status: 429 })).toBe(false);
    expect(isPermanentError({ status: 503 })).toBe(false);
    expect(isPermanentError(new Error('network'))).toBe(false);
    expect(isPermanentError(null)).toBe(false);
  });

  it('UserError выводит retryable из причины, явный флаг важнее', () => {
    expect(new UserError('x', { cause: { status: 401 } }).retryable).toBe(false);
    expect(new UserError('x', { cause: new Error('fetch failed') }).retryable).toBe(true);
    expect(new UserError('x', { cause: { status: 401 }, retryable: true }).retryable).toBe(true);
  });

  it('toUserMessage никогда не отдаёт текст сервера', () => {
    expect(toUserMessage(new Error('permission denied for schema lithos'))).toBe(MSG.submitFailed);
    expect(toUserMessage(new UserError(MSG.uploadFailed))).toBe(MSG.uploadFailed);
  });
});

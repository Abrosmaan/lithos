// Внешние вызовы: таймаут + retry (3 попытки, экспоненциальный backoff) — CLAUDE.md «Правила».
// Таймаут отменяет запрос через AbortSignal (supabase-js: .abortSignal(signal)).
import { UserError } from './errors';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 500;

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout ${label} after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, ms));
    }, ms);
    run(controller.signal).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  label?: string;
}

export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const base = opts.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label ?? 'call';
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs, label);
    } catch (e) {
      lastError = e;
      if (e instanceof UserError && !e.retryable) throw e;
      if (attempt < attempts) await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

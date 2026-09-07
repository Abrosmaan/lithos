// T2.1: Storage — таймаут на fetch, retry на временных ошибках, стоп без retry на 404.
import { describe, expect, it, vi } from 'vitest';
import { createPhotoStore } from './storage.js';
import { PhotoUnavailableError } from './types.js';

type FetchArgs = Parameters<typeof fetch>;

function store(fetchImpl: (...args: FetchArgs) => Promise<Response>) {
  return createPhotoStore('https://example.invalid', 'sb_secret_test', { fetch: vi.fn(fetchImpl) as unknown as typeof fetch, sleep: async () => {}, attempts: 3, timeoutMs: 50 });
}

describe('photo store', () => {
  it('503 ×2 → retry → 200: байты возвращаются, запросов 3', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n < 3 ? new Response('busy', { status: 503 }) : new Response(Buffer.from([1, 2, 3]), { status: 200 })));
    const s = store(f);
    const b = await s.download('u/s/1.jpg');
    expect([...b]).toEqual([1, 2, 3]);
    expect(f).toHaveBeenCalledTimes(3);
    const init = (f.mock.calls[0] as unknown as FetchArgs)[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal); // таймаут на каждом запросе
  });

  it('404 → PhotoUnavailableError без retry', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    await expect(store(f).download('u/s/1.jpg')).rejects.toBeInstanceOf(PhotoUnavailableError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('постоянно 503 → временная ошибка после 3 попыток (наружу, для retry через очередь)', async () => {
    const f = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(store(f).download('u/s/1.jpg')).rejects.toThrow(/503|failed/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('зависший ответ → AbortSignal.timeout → retry', async () => {
    let n = 0;
    const f = vi.fn(
      (_i: FetchArgs[0], init?: FetchArgs[1]) =>
        new Promise<Response>((resolve, reject) => {
          if (++n === 1) init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
          else resolve(new Response(Buffer.from([9]), { status: 200 }));
        }),
    );
    const b = await store(f).download('u/s/1.jpg');
    expect([...b]).toEqual([9]);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

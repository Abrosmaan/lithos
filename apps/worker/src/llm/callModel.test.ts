import { APICallError, NoOutputGeneratedError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { ScanResult } from '@lithos/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BreakerRegistry } from './breaker.js';
import { LlmUnavailableError, REPAIR_INSTRUCTION, callModel, type CallModelDeps } from './callModel.js';
import { loadLlmConfig, type ModelSpec, type Provider } from './config.js';
import { MissingApiKeyError } from './providers.js';

// ---- фикстуры ----

const VALID_GATE = { is_rock: true, quality: 'ok', multiple_objects: false };

const VALID_SCAN: ScanResult = {
  rock_class: { primary: 'amygdaloidal_basalt', confidence: 0.78, alternatives: [{ name: 'andesite', confidence: 0.15 }] },
  inclusions: [{ mineral: 'zeolite', confidence: 0.7, extent: 'noticeable', location: 'in_vesicles', evidence: 'white rounded fillings' }],
  shape: { tags: ['rounded', 'asymmetric'], natural_hole: false, recognizable_silhouette: null },
  surface: 'fresh_split',
  provenance: { matches_local_geology: true, wanderer_mechanism: null },
  split_recommendation: { recommended: false, reason: null },
  lore: 'Застывшая лава с пузырьками газа.',
  flags: [],
  revision_note: null,
};

type Usage = { noCache?: number; cacheRead?: number; cacheWrite?: number; out?: number };
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

function ok(obj: unknown, u: Usage = {}): GenerateResult {
  const noCache = u.noCache ?? 1000;
  const cacheRead = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: noCache + cacheRead + cacheWrite, noCache, cacheRead, cacheWrite },
      outputTokens: { total: u.out ?? 100, text: u.out ?? 100, reasoning: 0 },
    },
    warnings: [],
  };
}

/** Пустой вывод (обрезан / content-filter) — генерирует NoObjectGeneratedError без текста. */
function empty(): GenerateResult {
  return { ...ok(''), content: [], finishReason: { unified: 'length', raw: 'max_tokens' } };
}

/** Сырое base64 в теле запроса — чтобы проверить, что оно не утекает в LlmUnavailableError.causes. */
const FAKE_BODY = { messages: [{ content: 'A'.repeat(5000) }] };

function httpError(status: number): APICallError {
  return new APICallError({
    message: `HTTP ${status}`,
    url: 'https://example.invalid',
    requestBodyValues: FAKE_BODY,
    statusCode: status,
    isRetryable: status === 429 || status >= 500,
  });
}

function timeoutError(): Error {
  return new DOMException('total timeout of 30000ms exceeded', 'TimeoutError');
}

type Step = GenerateResult | Error;

/** Мок-модель: последовательность ответов/ошибок; последний шаг повторяется. */
function mockModel(provider: Provider, steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV4({
    provider,
    modelId: `${provider}-mock`,
    doGenerate: async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      if (step instanceof Error) throw step;
      return step!;
    },
  });
}

type LogFn = (msg: string, f?: Record<string, unknown>) => void;
type TestDeps = Omit<CallModelDeps, 'sleep' | 'log'> & {
  sleep: Mock<(ms: number) => Promise<void>>;
  log: { info: Mock<LogFn>; warn: Mock<LogFn>; error: Mock<LogFn> };
};

function makeDeps(models: Partial<Record<Provider, MockLanguageModelV4>>, extra: Partial<Omit<CallModelDeps, 'sleep' | 'log'>> = {}): TestDeps {
  let t = 1_000_000;
  const now = () => t;
  const sleep = vi.fn<(ms: number) => Promise<void>>(async (ms) => {
    t += ms;
  });
  return {
    config: loadLlmConfig({ STAGE_GATE: 'anthropic:claude-haiku-4-5' }),
    resolveModel: (spec: ModelSpec) => {
      const m = models[spec.provider];
      if (!m) throw new MissingApiKeyError(spec.provider);
      return m as unknown as LanguageModel;
    },
    breakers: new BreakerRegistry({ now, random: () => 0.5 }),
    now,
    random: () => 0.5,
    noKeyWarned: new Set(),
    ...extra,
    sleep,
    log: { info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() },
  };
}

const IMG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' };
const mainInput = { stage: 'main' as const, images: [IMG, IMG], userLanguage: 'ru' as const, scanId: 'scan-1', geo: null, userTests: null };

describe('callModel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('429 ×3 → 3 retries with 1/2/4 s backoff + jitter → success on the 4th call, no fallback', async () => {
    const anthropic = mockModel('anthropic', [httpError(429), httpError(429), httpError(429), ok(VALID_SCAN)]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.usedFallback).toBe(false);
    expect(out.fallbackReason).toBe('none');
    expect(out.attempts).toBe(4);
    expect(out.provider).toBe('anthropic');
    expect(out.model).toBe('claude-sonnet-5');
    expect(out.promptVersion).toBe('main-v1');
    expect(out.result).toMatchObject({ rock_class: { primary: 'amygdaloidal_basalt' } });
    expect(anthropic.doGenerateCalls).toHaveLength(4);
    expect(google.doGenerateCalls).toHaveLength(0);
    expect(deps.sleep.mock.calls.map((c) => c[0])).toEqual([1250, 2250, 4250]); // 1/2/4 с + 0.5×500 jitter
    expect(out.latencyMs).toBe(7750); // время двигает только sleep
    // ограниченный thinking для Anthropic main
    expect(anthropic.doGenerateCalls[0]!.providerOptions).toEqual({ anthropic: { thinking: { type: 'adaptive' }, effort: 'low' } });
  });

  it('4 failures (5xx / timeout) on primary → fallback, usedFallback=true, fallbackReason=provider_error', async () => {
    const anthropic = mockModel('anthropic', [httpError(529), timeoutError(), httpError(503), httpError(500)]);
    const google = mockModel('google', [ok(VALID_SCAN, { noCache: 4000, out: 500 })]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.usedFallback).toBe(true);
    expect(out.fallbackReason).toBe('provider_error');
    expect(out.provider).toBe('google');
    expect(out.model).toBe('gemini-3.7-flash');
    expect(out.attempts).toBe(5);
    expect(anthropic.doGenerateCalls).toHaveLength(4);
    expect(google.doGenerateCalls).toHaveLength(1);
    // 4000×0.75 + 500×3.75 = 3000 + 1875 µ$
    expect(out.costUsd).toBeCloseTo(0.004875, 9);
    expect(deps.log.info).toHaveBeenCalledWith(
      'llm call',
      expect.objectContaining({ used_fallback: true, fallback_reason: 'provider_error', provider: 'google', scan_id: 'scan-1' }),
    );
    expect(deps.log.warn).toHaveBeenCalledWith('llm primary provider failed, trying fallback', expect.objectContaining({ reason: 'retryable', attempts: 4 }));
  });

  it('consecutive errors → breaker open → next request goes to fallback without touching primary', async () => {
    const anthropic = mockModel('anthropic', [httpError(500)]); // всегда 500
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    // 1-й скан: 4 вызова = 4 ошибки в окне → breaker открылся на последней
    const r1 = await callModel({ ...mainInput, scanId: 's1' }, deps);
    expect(r1.usedFallback).toBe(true);
    expect(r1.fallbackReason).toBe('provider_error');
    expect(anthropic.doGenerateCalls).toHaveLength(4);
    expect(deps.breakers.get('anthropic').state).toBe('open');

    // 2-й скан: breaker открыт → ноль вызовов к anthropic, сразу fallback
    const r2 = await callModel({ ...mainInput, scanId: 's2' }, deps);
    expect(r2.usedFallback).toBe(true);
    expect(r2.fallbackReason).toBe('breaker_open');
    expect(r2.attempts).toBe(1);
    expect(anthropic.doGenerateCalls).toHaveLength(4);
    expect(deps.log.warn).toHaveBeenCalledWith(
      'llm primary provider failed, trying fallback',
      expect.objectContaining({ reason: 'breaker_open', scan_id: 's2', breaker: 'open' }),
    );
  });

  it('breaker opening mid-retry stops the remaining retries', async () => {
    const anthropic = mockModel('anthropic', [httpError(500)]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });
    // 3 ошибки заранее: следующая (4-я) откроет breaker на 1-й попытке следующего скана
    for (let i = 0; i < 3; i++) deps.breakers.get('anthropic').onFailure();

    const out = await callModel(mainInput, deps);

    expect(out.fallbackReason).toBe('breaker_open');
    expect(anthropic.doGenerateCalls).toHaveLength(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('invalid JSON → one repair call on the same model → valid', async () => {
    const anthropic = mockModel('anthropic', [ok('{"rock_class": {"primary": "granite", "confidence": 0.9', { noCache: 3000, out: 50 }), ok(VALID_SCAN, { noCache: 3100, out: 400 })]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.repaired).toBe(true);
    expect(out.usedFallback).toBe(false);
    expect(out.fallbackReason).toBe('none');
    expect(out.attempts).toBe(2);
    expect(anthropic.doGenerateCalls).toHaveLength(2);
    // repair-диалог: исходный user → assistant (сырой текст) → user (REPAIR_INSTRUCTION)
    const repairPrompt = anthropic.doGenerateCalls[1]!.prompt;
    expect(repairPrompt.map((m) => m.role).slice(-2)).toEqual(['assistant', 'user']);
    expect(JSON.stringify(repairPrompt.at(-1)!.content)).toContain(REPAIR_INSTRUCTION);
    // токены суммируются по обоим вызовам
    expect(out.tokensIn).toBe(6100);
    expect(out.tokensOut).toBe(450);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('empty / truncated output → one re-ask (repair without raw text) → valid', async () => {
    const anthropic = mockModel('anthropic', [empty(), ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic });

    const out = await callModel(mainInput, deps);

    expect(out.repaired).toBe(true);
    expect(out.attempts).toBe(2);
    // без сырого текста нечего чинить — повторяем исходный диалог
    expect(anthropic.doGenerateCalls[1]!.prompt.map((m) => m.role)).toEqual(anthropic.doGenerateCalls[0]!.prompt.map((m) => m.role));
    expect(deps.log.warn).toHaveBeenCalledWith('llm output invalid, repairing', expect.objectContaining({ has_text: false }));
  });

  it('NoOutputGeneratedError is schema_invalid: repair, then fallback', async () => {
    const anthropic = mockModel('anthropic', [new NoOutputGeneratedError({ message: 'no output' })]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.usedFallback).toBe(true);
    expect(out.fallbackReason).toBe('schema_invalid');
    expect(anthropic.doGenerateCalls).toHaveLength(2);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('schema violation (bad enum) → repair fails → fallback; schema failures count as calls, not failures', async () => {
    const bad = { ...VALID_SCAN, rock_class: { ...VALID_SCAN.rock_class, primary: 'kryptonite' } };
    const anthropic = mockModel('anthropic', [ok(bad), ok(bad)]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.usedFallback).toBe(true);
    expect(out.fallbackReason).toBe('schema_invalid');
    expect(out.attempts).toBe(3);
    expect(anthropic.doGenerateCalls).toHaveLength(2);
    expect(deps.breakers.get('anthropic').stats()).toEqual({ state: 'closed', calls: 2, failures: 0 });
  });

  it('cost is computed from tokens incl. prompt-cache read/write', async () => {
    const anthropic = mockModel('anthropic', [ok(VALID_SCAN, { noCache: 700, cacheRead: 200, cacheWrite: 100, out: 50 })]);
    const deps = makeDeps({ anthropic });

    const out = await callModel(mainInput, deps);

    expect(out.tokensIn).toBe(1000);
    expect(out.tokensOut).toBe(50);
    expect(out.costUsd).toBeCloseTo(0.003285, 9);
    expect(deps.log.info).toHaveBeenCalledWith(
      'llm call',
      expect.objectContaining({
        scan_id: 'scan-1',
        stage: 'main',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        prompt_version: 'main-v1',
        tokens_in: 1000,
        tokens_out: 50,
        cost_usd: 0.003285,
        latency_ms: expect.any(Number),
      }),
    );
  });

  it('gate: one image, gate schema, gate-v1, no thinking options on Haiku', async () => {
    const anthropic = mockModel('anthropic', [ok(VALID_GATE)]);
    const deps = makeDeps({ anthropic });

    const out = await callModel({ stage: 'gate', images: [IMG, IMG, IMG], userLanguage: 'ru', scanId: 'g1' }, deps);

    expect(out.result).toEqual(VALID_GATE);
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.promptVersion).toBe('gate-v1');
    const call = anthropic.doGenerateCalls[0]!;
    const user = call.prompt.find((m) => m.role === 'user')!;
    expect(Array.isArray(user.content) ? user.content.filter((p) => p.type === 'file').length : 0).toBe(1);
    expect(call.prompt[0]!.role).toBe('system');
    expect(call.providerOptions ?? {}).toEqual({});
  });

  it('escalation: main system (cached) + addendum with S2 result, up to 3 images, effort medium', async () => {
    const anthropic = mockModel('anthropic', [ok({ ...VALID_SCAN, revision_note: 'confirmed' })]);
    const deps = makeDeps({ anthropic });

    const out = await callModel({ ...mainInput, stage: 'escalation', images: [IMG, IMG, IMG, IMG], priorResult: VALID_SCAN, scanId: 'e1' }, deps);

    expect(out.model).toBe('claude-opus-5');
    expect(out.promptVersion).toBe('escalation-v1');
    expect((out.result as ScanResult).revision_note).toBe('confirmed');
    const call = anthropic.doGenerateCalls[0]!;
    const systems = call.prompt.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(2);
    expect(String(systems[0]!.content)).toContain('You are a field geologist');
    expect(String(systems[0]!.content)).toContain('in Russian for a curious non-expert');
    expect(systems[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(String(systems[1]!.content)).toContain('First-pass result:');
    expect(String(systems[1]!.content)).toContain('"amygdaloidal_basalt"');
    const user = call.prompt.find((m) => m.role === 'user')!;
    const parts = Array.isArray(user.content) ? user.content : [];
    expect(parts.filter((p) => p.type === 'file')).toHaveLength(3);
    const text = parts.find((p) => p.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('Photos: 3 images follow. Photo 1 includes a scale reference: none.');
    expect(call.providerOptions).toEqual({ anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' } });
  });

  it('escalation without priorResult is a programming error, not a retry', async () => {
    const anthropic = mockModel('anthropic', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic });
    await expect(callModel({ ...mainInput, stage: 'escalation' }, deps)).rejects.toThrow(/priorResult/);
    expect(anthropic.doGenerateCalls).toHaveLength(0);
  });

  it('both providers down → LlmUnavailableError with sanitized causes (no request bodies)', async () => {
    const anthropic = mockModel('anthropic', [httpError(500)]);
    const google = mockModel('google', [httpError(503)]);
    const deps = makeDeps({ anthropic, google });

    const err = await callModel(mainInput, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    const e = err as LlmUnavailableError;
    expect(e.attempts).toBe(8);
    expect(e.causes).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-5', kind: 'retryable', message: 'HTTP 500: HTTP 500' },
      { provider: 'google', model: 'gemini-3.7-flash', kind: 'retryable', message: 'HTTP 503: HTTP 503' },
    ]);
    expect(JSON.stringify(e.causes)).not.toContain('AAAA');
    expect(deps.log.error).toHaveBeenCalledWith('llm stage unavailable', expect.objectContaining({ stage: 'main', attempts: 8 }));
  });

  it('fatal 4xx is not retried and goes straight to fallback', async () => {
    const anthropic = mockModel('anthropic', [httpError(400)]);
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ anthropic, google });

    const out = await callModel(mainInput, deps);

    expect(out.usedFallback).toBe(true);
    expect(out.fallbackReason).toBe('provider_error');
    expect(anthropic.doGenerateCalls).toHaveLength(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('primary not configured (no API key): fallback answers, usedFallback=false, fallbackReason=no_api_key, warn once per process', async () => {
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ google }); // anthropic → MissingApiKeyError

    const r1 = await callModel({ ...mainInput, scanId: 'k1' }, deps);
    const r2 = await callModel({ ...mainInput, scanId: 'k2' }, deps);

    for (const r of [r1, r2]) {
      expect(r.provider).toBe('google');
      expect(r.usedFallback).toBe(false);
      expect(r.fallbackReason).toBe('no_api_key');
      expect(r.attempts).toBe(1);
    }
    const noKeyWarns = deps.log.warn.mock.calls.filter((c) => c[0] === 'llm provider not configured (no API key), skipping');
    expect(noKeyWarns).toHaveLength(1);
    expect(noKeyWarns[0]![1]).toEqual({ provider: 'anthropic', env: 'ANTHROPIC_API_KEY' });
    expect(deps.log.warn).not.toHaveBeenCalledWith('llm primary provider failed, trying fallback', expect.anything());
    expect(deps.breakers.get('anthropic').stats().calls).toBe(0);
  });

  it('fallback provider not configured → LlmUnavailableError with kind no_api_key', async () => {
    const anthropic = mockModel('anthropic', [httpError(500)]);
    const deps = makeDeps({ anthropic }); // google → MissingApiKeyError

    const err = (await callModel(mainInput, deps).catch((e: unknown) => e)) as LlmUnavailableError;
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.causes[1]).toMatchObject({ provider: 'google', kind: 'no_api_key' });
    expect(deps.log.warn).toHaveBeenCalledWith('llm provider not configured (no API key), skipping', expect.objectContaining({ provider: 'google' }));
  });

  it('unexpected (non-§7) error from primary → fallback with provider_error; if fallback also fails, the original error is rethrown', async () => {
    const boom = new TypeError('boom from resolver');
    const google = mockModel('google', [ok(VALID_SCAN)]);
    const deps = makeDeps({ google }, {
      resolveModel: (spec: ModelSpec) => {
        if (spec.provider === 'anthropic') throw boom;
        return google as unknown as LanguageModel;
      },
    });

    const out = await callModel(mainInput, deps);
    expect(out.provider).toBe('google');
    expect(out.usedFallback).toBe(true);
    expect(out.fallbackReason).toBe('provider_error');
    expect(deps.log.warn).toHaveBeenCalledWith('llm primary provider threw unexpected error, trying fallback', expect.objectContaining({ error: { name: 'TypeError', message: 'boom from resolver' } }));

    const googleDown = mockModel('google', [httpError(500)]);
    const deps2 = makeDeps({ google: googleDown }, {
      resolveModel: (spec: ModelSpec) => {
        if (spec.provider === 'anthropic') throw boom;
        return googleDown as unknown as LanguageModel;
      },
    });
    await expect(callModel(mainInput, deps2)).rejects.toBe(boom);
  });
});

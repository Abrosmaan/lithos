// Провайдерный слой (dev-plan T1.3, ai-pipeline §7): один вызов ступени с retry, repair, circuit breaker и fallback.
import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import { GateResultSchema, ScanResultSchema, type GateResult, type ScanResult } from '@lithos/shared';
import type { z } from 'zod';
import { config as workerConfig } from '../config.js';
import { log as defaultLog } from '../log.js';
import { BreakerRegistry } from './breaker.js';
import {
  RETRY,
  STAGE_MAX_OUTPUT_TOKENS,
  STAGE_TIMEOUT_MS,
  ZERO_USAGE,
  addUsage,
  estimateCostUsd,
  fallbackSpec,
  priceFor,
  type LlmConfig,
  type LlmStage,
  type ModelSpec,
  type Provider,
  type TokenUsage,
} from './config.js';
import { API_KEY_ENV, MissingApiKeyError, createModelResolverFromEnv, providerOptionsFor, type ModelResolver } from './providers.js';
import { PROMPT_VERSION as ESCALATION_PROMPT_VERSION, buildEscalationPrompt } from './prompts/escalation.js';
import { PROMPT_VERSION as GATE_PROMPT_VERSION, buildGatePrompt, type BuiltPrompt } from './prompts/gate.js';
import { PROMPT_VERSION as MAIN_PROMPT_VERSION, buildMainPrompt } from './prompts/main.js';
import type { CallModelInput, CallModelOutput, FallbackReason } from './types.js';

export type { CallModelInput, CallModelOutput, FallbackReason } from './types.js';

/** Текст repair-вызова (ai-pipeline §7). */
export const REPAIR_INSTRUCTION = 'Fix this output to match the schema, change nothing else.';

type Logger = Pick<typeof defaultLog, 'info' | 'warn' | 'error'>;

export interface CallModelDeps {
  config: LlmConfig;
  resolveModel: ModelResolver;
  breakers: BreakerRegistry;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  log: Logger;
  /** Провайдеры, про отсутствие ключа у которых уже предупредили (один warn на процесс). */
  noKeyWarned: Set<Provider>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let defaultDeps: CallModelDeps | undefined;
function getDefaultDeps(): CallModelDeps {
  // Единый источник конфига — apps/worker/src/config.ts (он же грузит .env). Ключи — только в резолвере.
  defaultDeps ??= {
    config: workerConfig.llm,
    resolveModel: createModelResolverFromEnv(process.env),
    breakers: new BreakerRegistry(),
    sleep: defaultSleep,
    now: Date.now,
    random: Math.random,
    log: defaultLog,
    noKeyWarned: new Set(),
  };
  return defaultDeps;
}

/** Причина отказа одного провайдера — без сырых ошибок SDK (в них тело запроса с base64 фото). */
export interface LlmFailureCause {
  provider: Provider;
  model: string;
  kind: string;
  message: string;
}

/** Все провайдеры ступени отказали (после retry, repair и fallback). Текст — не для пользователя (ai-pipeline §7). */
export class LlmUnavailableError extends Error {
  constructor(
    readonly stage: LlmStage,
    readonly attempts: number,
    readonly causes: LlmFailureCause[],
  ) {
    super(`LLM stage "${stage}" failed on all providers after ${attempts} attempts`);
    this.name = 'LlmUnavailableError';
  }
}

/**
 * retryable — 429/529/5xx/timeout/сеть (retry с backoff, учёт в breaker);
 * schema    — невалидный/пустой вывод (repair, в breaker — вызов без ошибки);
 * auth      — 401: ключ невалиден/отозван — отказ провайдера целиком, без retry, breaker открывается сразу (T4.1 §11 п.2);
 * fatal     — прочие 4xx (400 bad request, 403 permission/модель недоступна, 404…): без retry, сразу fallback,
 *             в breaker не учитывается — может быть наш запрос/конфиг, а не отказ провайдера.
 */
type FailureKind = 'retryable' | 'schema' | 'auth' | 'fatal';

/** Классификация ошибки вызова (ai-pipeline §7, таблица «Ошибки модели по типу»). */
export function classifyError(err: unknown): FailureKind {
  if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) return 'schema';
  if (APICallError.isInstance(err)) {
    const s = err.statusCode;
    if (s === 401) return 'auth';
    if (s === 429 || s === 529 || s === 408 || (s !== undefined && s >= 500)) return 'retryable';
    if (s === undefined && err.isRetryable) return 'retryable'; // сетевая ошибка без статуса
    return 'fatal';
  }
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'retryable';
    if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(err.message)) return 'retryable';
  }
  return 'fatal';
}

function usageOf(u: LanguageModelUsage | undefined): TokenUsage {
  if (!u) return ZERO_USAGE;
  const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;
  const noCache = u.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { inputTokens: noCache, outputTokens: u.outputTokens ?? 0, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
}

function backoffMs(attempt: number, random: () => number): number {
  const base = RETRY.backoffMs[Math.min(attempt, RETRY.backoffMs.length - 1)] ?? 0;
  return base + Math.floor(random() * RETRY.jitterMs);
}

type StageFailureKind = FailureKind | 'breaker_open' | 'no_api_key';

const FALLBACK_REASON: Record<StageFailureKind, FallbackReason> = {
  retryable: 'provider_error',
  auth: 'provider_error',
  fatal: 'provider_error',
  schema: 'schema_invalid',
  breaker_open: 'breaker_open',
  no_api_key: 'no_api_key',
};

class StageFailure extends Error {
  constructor(
    readonly kind: StageFailureKind,
    readonly attempts: number,
    readonly usage: TokenUsage,
    override readonly cause: unknown,
  ) {
    super(`stage failure: ${kind}`);
    this.name = 'StageFailure';
  }
}

interface StageSuccess<T> {
  object: T;
  usage: TokenUsage;
  attempts: number;
  repaired: boolean;
}

interface StageCtx {
  stage: LlmStage;
  scanId: string;
  promptVersion: string;
}

/**
 * Одна ступень на одном провайдере: исходный вызов + до 3 ретраев на 429/529/5xx/timeout,
 * один repair-вызов на невалидную схему/пустой вывод. Любой другой исход — StageFailure (→ fallback у вызывающего).
 */
async function runOnProvider<S extends z.ZodTypeAny>(
  spec: ModelSpec,
  prompt: BuiltPrompt,
  schema: S,
  ctx: StageCtx,
  deps: CallModelDeps,
): Promise<StageSuccess<z.infer<S>>> {
  const breaker = deps.breakers.get(spec.provider);
  if (!breaker.allow()) throw new StageFailure('breaker_open', 0, ZERO_USAGE, undefined);

  let model;
  try {
    model = deps.resolveModel(spec);
  } catch (e) {
    if (e instanceof MissingApiKeyError) throw new StageFailure('no_api_key', 0, ZERO_USAGE, e);
    throw e;
  }

  const base = {
    model,
    instructions: prompt.instructions,
    output: Output.object({ schema }),
    maxRetries: 0, // retry — наш, с breaker'ом и логом
    timeout: { totalMs: STAGE_TIMEOUT_MS[ctx.stage] },
    maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS[ctx.stage],
    providerOptions: providerOptionsFor(spec, ctx.stage),
  };
  const logCtx = { scan_id: ctx.scanId, stage: ctx.stage, provider: spec.provider, model: spec.model };

  let attempts = 0;
  let usage: TokenUsage = ZERO_USAGE;
  for (let attempt = 0; attempt < RETRY.maxAttempts; attempt++) {
    attempts++;
    try {
      const r = await generateText({ ...base, messages: prompt.messages });
      const object = r.output as z.infer<S>; // getter бросает NoOutputGeneratedError на пустом выводе
      breaker.onSuccess();
      usage = addUsage(usage, usageOf(r.usage));
      return { object, usage, attempts, repaired: false };
    } catch (err) {
      const kind = classifyError(err);
      if (kind === 'schema') {
        breaker.onSchemaFailure();
        const raw = NoObjectGeneratedError.isInstance(err) ? err.text?.trim() : undefined;
        if (NoObjectGeneratedError.isInstance(err)) usage = addUsage(usage, usageOf(err.usage));
        deps.log.warn('llm output invalid, repairing', { ...logCtx, attempt: attempts, has_text: Boolean(raw), error: errorSummary(err) });
        attempts++;
        try {
          // Есть сырой текст → просим починить его; пустой/обрезанный вывод → один повторный запрос.
          const messages: ModelMessage[] = raw
            ? [...prompt.messages, { role: 'assistant', content: raw }, { role: 'user', content: REPAIR_INSTRUCTION }]
            : prompt.messages;
          const r = await generateText({ ...base, messages });
          const object = r.output as z.infer<S>;
          breaker.onSuccess();
          usage = addUsage(usage, usageOf(r.usage));
          return { object, usage, attempts, repaired: true };
        } catch (err2) {
          const kind2 = classifyError(err2);
          if (NoObjectGeneratedError.isInstance(err2)) usage = addUsage(usage, usageOf(err2.usage));
          if (kind2 === 'schema') breaker.onSchemaFailure();
          else if (kind2 === 'retryable') breaker.onFailure();
          deps.log.warn('llm repair failed', { ...logCtx, attempt: attempts, error: errorSummary(err2) });
          throw new StageFailure('schema', attempts, usage, err2);
        }
      }
      if (kind === 'retryable') {
        breaker.onFailure();
        const last = attempt === RETRY.maxAttempts - 1;
        deps.log.warn('llm call failed', { ...logCtx, attempt: attempts, error: errorSummary(err), will_retry: !last });
        if (last) throw new StageFailure('retryable', attempts, usage, err);
        // Breaker мог открыться на этой ошибке — дальше не долбим провайдера, сразу fallback.
        if (!breaker.allow()) throw new StageFailure('breaker_open', attempts, usage, err);
        await deps.sleep(backoffMs(attempt, deps.random));
        continue;
      }
      if (kind === 'auth') {
        // Ключ невалиден/отозван: провайдер недоступен целиком, а не один запрос. Retry бесполезен (тот же ключ),
        // ждать minCalls breaker'а незачем — каждый следующий вызов упал бы так же. Открываем сразу: трафик → fallback,
        // через openMs half-open проверит, вернули ли ключ. Текст ответа провайдера — только в лог, не пользователю.
        breaker.forceOpen();
        deps.log.error('llm call failed (auth): provider key rejected, breaker opened', { ...logCtx, attempt: attempts, error: errorSummary(err), breaker: breaker.state });
        throw new StageFailure('auth', attempts, usage, err);
      }
      deps.log.warn('llm call failed (fatal)', { ...logCtx, attempt: attempts, error: errorSummary(err) });
      throw new StageFailure('fatal', attempts, usage, err);
    }
  }
  throw new StageFailure('retryable', attempts, usage, undefined); // недостижимо
}

/** Короткое описание ошибки для лога/причин: без тела запроса (в APICallError лежит base64 фото). */
function errorSummary(err: unknown): { name: string; status?: number; message: string } {
  if (APICallError.isInstance(err)) return { name: err.name, status: err.statusCode, message: err.message.slice(0, 200) };
  if (err instanceof Error) return { name: err.name, message: err.message.slice(0, 200) };
  return { name: 'unknown', message: String(err).slice(0, 200) };
}

function toCause(spec: ModelSpec, kind: string, err: unknown): LlmFailureCause {
  const s = errorSummary(err);
  const message = err === undefined ? kind : s.status !== undefined ? `HTTP ${s.status}: ${s.message}` : `${s.name}: ${s.message}`;
  return { provider: spec.provider, model: spec.model, kind, message: message.slice(0, 200) };
}

interface StagePlan {
  prompt: BuiltPrompt;
  schema: typeof GateResultSchema | typeof ScanResultSchema;
  promptVersion: string;
}

function planStage(input: CallModelInput): StagePlan {
  const first = input.images[0];
  if (!first) throw new Error(`callModel(${input.stage}): at least one image required`);
  const mainArgs = {
    images: input.images,
    geo: input.geo,
    userTests: input.userTests,
    userLanguage: input.userLanguage,
    scaleObject: input.scaleObject,
  };
  switch (input.stage) {
    case 'gate':
      return { prompt: buildGatePrompt(first), schema: GateResultSchema, promptVersion: GATE_PROMPT_VERSION };
    case 'main':
      return { prompt: buildMainPrompt(mainArgs), schema: ScanResultSchema, promptVersion: MAIN_PROMPT_VERSION };
    case 'escalation': {
      if (!input.priorResult) throw new Error('callModel(escalation): priorResult is required');
      return {
        prompt: buildEscalationPrompt({ ...mainArgs, priorResult: input.priorResult }),
        schema: ScanResultSchema,
        promptVersion: ESCALATION_PROMPT_VERSION,
      };
    }
  }
}

/**
 * Вызов модели для ступени. Основной провайдер из config; при отказе или отсутствии ключа — второй провайдер той же роли.
 * usedFallback=true только при реальном отказе основного (breaker_open / provider_error / schema_invalid) — по нему
 * S4 ставит «предварительно» и ограничивает тир (ai-pipeline §7). Несконфигурированный провайдер — fallbackReason='no_api_key'.
 * Бросает LlmUnavailableError, если отказали оба (вызывающий ставит карточку «в обработке», §7 «Деградация»).
 */
export async function callModel(input: CallModelInput, depsOverride?: Partial<CallModelDeps>): Promise<CallModelOutput> {
  const deps: CallModelDeps = { ...getDefaultDeps(), ...depsOverride };
  const startedAt = deps.now();
  const plan = planStage(input);
  const primary = deps.config.stages[input.stage];
  const fallback = fallbackSpec(input.stage, primary, deps.config.fallbackProvider);
  const ctx: StageCtx = { stage: input.stage, scanId: input.scanId, promptVersion: plan.promptVersion };
  const baseLog = { scan_id: input.scanId, stage: input.stage };

  let attempts = 0;

  const succeed = (spec: ModelSpec, r: StageSuccess<unknown>, reason: FallbackReason): CallModelOutput => {
    attempts += r.attempts;
    const result = plan.schema.parse(r.object) as GateResult | ScanResult;
    const costUsd = estimateCostUsd(spec.model, r.usage);
    const latencyMs = deps.now() - startedAt;
    const tokensIn = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
    const usedFallback = reason !== 'none' && reason !== 'no_api_key';
    deps.log.info('llm call', {
      ...baseLog,
      provider: spec.provider,
      model: spec.model,
      prompt_version: plan.promptVersion,
      tokens_in: tokensIn,
      tokens_out: r.usage.outputTokens,
      cache_read_tokens: r.usage.cacheReadTokens,
      cache_write_tokens: r.usage.cacheWriteTokens,
      cost_usd: Number(costUsd.toFixed(6)),
      price_known: priceFor(spec.model) !== undefined,
      latency_ms: latencyMs,
      attempts,
      used_fallback: usedFallback,
      fallback_reason: reason,
      repaired: r.repaired,
    });
    return {
      result,
      provider: spec.provider,
      model: spec.model,
      promptVersion: plan.promptVersion,
      tokensIn,
      tokensOut: r.usage.outputTokens,
      costUsd,
      latencyMs,
      usedFallback,
      fallbackReason: reason,
      attempts,
      repaired: r.repaired,
    };
  };

  const reportFailure = (spec: ModelSpec, role: 'primary' | 'fallback', f: StageFailure) => {
    attempts += f.attempts;
    if (f.kind === 'no_api_key') {
      if (!deps.noKeyWarned.has(spec.provider)) {
        deps.noKeyWarned.add(spec.provider);
        deps.log.warn('llm provider not configured (no API key), skipping', { provider: spec.provider, env: API_KEY_ENV[spec.provider] });
      }
      return;
    }
    deps.log.warn(role === 'primary' ? 'llm primary provider failed, trying fallback' : 'llm fallback provider failed', {
      ...baseLog,
      provider: spec.provider,
      model: spec.model,
      reason: f.kind,
      attempts: f.attempts,
      breaker: deps.breakers.get(spec.provider).state,
    });
  };

  // ---- основной провайдер ----
  let primaryFailure: StageFailure | undefined;
  let unexpected: unknown;
  try {
    return succeed(primary, await runOnProvider(primary, plan.prompt, plan.schema, ctx, deps), 'none');
  } catch (err) {
    if (err instanceof StageFailure) {
      primaryFailure = err;
      reportFailure(primary, 'primary', err);
    } else {
      // Неожиданная ошибка (не из таблицы §7) — тоже пробуем второй провайдер, потом пробрасываем её.
      unexpected = err;
      deps.log.warn('llm primary provider threw unexpected error, trying fallback', { ...baseLog, provider: primary.provider, model: primary.model, error: errorSummary(err) });
    }
  }

  // ---- fallback ----
  const reason: FallbackReason = primaryFailure ? FALLBACK_REASON[primaryFailure.kind] : 'provider_error';
  try {
    return succeed(fallback, await runOnProvider(fallback, plan.prompt, plan.schema, ctx, deps), reason);
  } catch (err) {
    if (!(err instanceof StageFailure)) throw unexpected ?? err;
    reportFailure(fallback, 'fallback', err);
    if (unexpected) throw unexpected;
    const causes = [
      primaryFailure ? toCause(primary, primaryFailure.kind, primaryFailure.cause) : toCause(primary, 'unexpected', undefined),
      toCause(fallback, err.kind, err.cause),
    ];
    deps.log.error('llm stage unavailable', { ...baseLog, attempts, latency_ms: deps.now() - startedAt, causes });
    throw new LlmUnavailableError(input.stage, attempts, causes);
  }
}

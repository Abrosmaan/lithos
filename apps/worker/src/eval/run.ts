// Прогон одной ступени на одной модели по позициям golden set: callModel из T1.3 без fallback на другого провайдера
// (иначе метрика модели A незаметно смешалась бы с ответами модели B), сырые ответы — в runs/<ts>/<stage>/<provider>__<model>/<id>.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GateResult, GeoContext, ScanResult } from '@lithos/shared';
import { BreakerRegistry } from '../llm/breaker.js';
import { LlmUnavailableError, callModel, type CallModelDeps } from '../llm/callModel.js';
import { formatModelSpec, otherProvider, type LlmConfig, type LlmStage, type ModelSpec } from '../llm/config.js';
import { MissingApiKeyError, createModelResolverFromEnv, hasApiKey, type ModelResolver } from '../llm/providers.js';
import type { ImageInput } from '../llm/types.js';
import type { GoldenLabel } from './labels.js';
import { failedOutcome, gateOutcome, scanOutcome, type GateOutcome, type Outcome, type ScanOutcome } from './metrics.js';

export interface EvalItem {
  label: GoldenLabel;
  image: ImageInput;
  geo: GeoContext | null;
}

export type ModelRunStatus = 'ran' | 'no_key' | 'no_prior';

export interface ModelRun {
  stage: LlmStage;
  spec: ModelSpec;
  status: ModelRunStatus;
  outcomes: Outcome[];
  /** Валидные ответы main/escalation по id — prior для escalation той же семьи. */
  results: Map<string, ScanResult>;
  promptVersion: string | null;
}

export interface RunOptions {
  concurrency: number;
  runDir: string;
  /** Prior для escalation (main той же семьи). */
  priors?: Map<string, ScanResult>;
  progress?: (line: string) => void;
  /** Для тестов: подмена callModel. */
  call?: typeof callModel;
  resolveModel?: ModelResolver;
}

export function modelDirName(spec: ModelSpec): string {
  return `${spec.provider}__${spec.model}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

/** Резолвер, который знает только провайдера тестируемой модели: fallback на другого провайдера → MissingApiKeyError. */
export function restrictResolver(base: ModelResolver, provider: ModelSpec['provider']): ModelResolver {
  return (spec) => {
    if (spec.provider !== provider) throw new MissingApiKeyError(spec.provider);
    return base(spec);
  };
}

/** Тихий логгер: info callModel («llm call» на каждый вызов) не засоряет отчёт, warn/error — в stderr. */
const quietLog: CallModelDeps['log'] = {
  info: () => {},
  warn: (msg, f) => process.stderr.write(`warn: ${msg} ${JSON.stringify(f ?? {})}\n`),
  error: (msg, f) => process.stderr.write(`error: ${msg} ${JSON.stringify(f ?? {})}\n`),
};

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

function errorInfo(e: unknown): Record<string, unknown> {
  if (e instanceof LlmUnavailableError) return { name: e.name, message: e.message, stage: e.stage, attempts: e.attempts, causes: e.causes };
  if (e instanceof Error) return { name: e.name, message: e.message.slice(0, 300) };
  return { name: 'unknown', message: String(e).slice(0, 300) };
}

export async function runStageModel(stage: LlmStage, spec: ModelSpec, items: EvalItem[], opts: RunOptions): Promise<ModelRun> {
  const run: ModelRun = { stage, spec, status: 'ran', outcomes: [], results: new Map(), promptVersion: null };
  if (!hasApiKey(spec.provider)) {
    run.status = 'no_key';
    return run;
  }
  if (stage === 'escalation' && !opts.priors) {
    run.status = 'no_prior';
    return run;
  }

  const config: LlmConfig = { stages: { gate: spec, main: spec, escalation: spec }, fallbackProvider: otherProvider(spec.provider) };
  const deps: Partial<CallModelDeps> = {
    config,
    resolveModel: restrictResolver(opts.resolveModel ?? createModelResolverFromEnv(process.env), spec.provider),
    breakers: new BreakerRegistry(),
    log: quietLog,
    noKeyWarned: new Set(),
  };
  const call = opts.call ?? callModel;
  const dir = resolve(opts.runDir, stage, modelDirName(spec));
  await mkdir(dir, { recursive: true });
  const tag = `[${stage} ${formatModelSpec(spec)}]`;
  let done = 0;

  const outcomes = await mapLimit(items, opts.concurrency, async ({ label, image, geo }): Promise<Outcome | null> => {
    const prior = stage === 'escalation' ? opts.priors?.get(label.id) : undefined;
    if (stage === 'escalation' && !prior) {
      opts.progress?.(`${tag} ${label.id}: нет prior (main той же семьи не ответил) — пропуск`);
      return null;
    }
    const startedAt = Date.now();
    const scanId = `eval-${stage}-${label.id}`;
    try {
      const out = await call(
        { stage, images: [image], geo, userTests: null, userLanguage: 'ru', priorResult: prior, scaleObject: null, scanId },
        deps,
      );
      run.promptVersion ??= out.promptVersion;
      const meta = { costUsd: out.costUsd, latencyMs: out.latencyMs, repaired: out.repaired, attempts: out.attempts };
      const raw = {
        id: label.id,
        stage,
        provider: out.provider,
        model: out.model,
        prompt_version: out.promptVersion,
        geo_cell: geo?.cell_id ?? null,
        geo_source: geo?.source ?? null,
        expected: { rock_class: label.rock_class, acceptable_alternatives: label.acceptable_alternatives, inclusions: label.inclusions, is_rock: label.is_rock, trap: label.trap },
        tokens_in: out.tokensIn,
        tokens_out: out.tokensOut,
        cost_usd: out.costUsd,
        latency_ms: out.latencyMs,
        attempts: out.attempts,
        repaired: out.repaired,
        used_fallback: out.usedFallback,
        fallback_reason: out.fallbackReason,
        prior: prior ?? null,
        result: out.result,
        ts: new Date().toISOString(),
      };
      await writeFile(resolve(dir, `${label.id}.json`), JSON.stringify(raw, null, 2));
      done++;
      opts.progress?.(`${tag} ${done}/${items.length} ${label.id} ok ${(out.latencyMs / 1000).toFixed(1)}s $${out.costUsd.toFixed(4)}`);
      if (stage === 'gate') return gateOutcome(out.result as GateResult, label, meta);
      const result = out.result as ScanResult;
      run.results.set(label.id, result);
      return scanOutcome(result, label, meta, stage, prior);
    } catch (e) {
      const info = errorInfo(e);
      await writeFile(resolve(dir, `${label.id}.json`), JSON.stringify({ id: label.id, stage, model: formatModelSpec(spec), error: info, ts: new Date().toISOString() }, null, 2));
      done++;
      opts.progress?.(`${tag} ${done}/${items.length} ${label.id} FAILED ${String(info.name)}: ${String(info.message)}`);
      return failedOutcome(label.id, stage, { costUsd: 0, latencyMs: Date.now() - startedAt, repaired: false, attempts: 0 }, label);
    }
  });
  run.outcomes = outcomes.filter((o): o is Outcome => o !== null);
  return run;
}

export function isScanOutcomes(outcomes: Outcome[]): outcomes is ScanOutcome[] {
  return outcomes.every((o) => o.stage !== 'gate');
}

export function isGateOutcomes(outcomes: Outcome[]): outcomes is GateOutcome[] {
  return outcomes.every((o) => o.stage === 'gate');
}

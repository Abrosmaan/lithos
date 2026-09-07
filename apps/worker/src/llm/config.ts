// Конфиг провайдерного слоя (ai-pipeline §2, §2a, §7; dev-plan §6).
// Чистые функции: без побочных эффектов и без чтения .env — .env грузит apps/worker/src/config.ts.

export const PROVIDERS = ['anthropic', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const LLM_STAGES = ['gate', 'main', 'escalation'] as const;
export type LlmStage = (typeof LLM_STAGES)[number];

export interface ModelSpec {
  provider: Provider;
  model: string;
}

/** Дефолты ступеней — dev-plan §6 (.env.example). Переопределяются STAGE_* после T2.4 (golden set). */
export const STAGE_DEFAULTS: Record<LlmStage, string> = {
  gate: 'google:gemini-3.1-flash-lite',
  main: 'anthropic:claude-sonnet-5',
  escalation: 'anthropic:claude-opus-5',
};

export const DEFAULT_FALLBACK_PROVIDER: Provider = 'google';

/** Таймаут одного вызова модели по ступени (ai-pipeline §7: 30 с Sonnet, 45 с Opus; gate — 20 с). */
export const STAGE_TIMEOUT_MS: Record<LlmStage, number> = {
  gate: 20_000,
  main: 30_000,
  escalation: 45_000,
};

/** Потолок выходных токенов (включая thinking у Anthropic/Gemini). Gate ≤ 60 полезных токенов, main ~600. */
export const STAGE_MAX_OUTPUT_TOKENS: Record<LlmStage, number> = {
  gate: 1024,
  main: 8192,
  escalation: 8192,
};

/** Retry-политика (ai-pipeline §7): исходный вызов + 3 ретрая (4 HTTP-вызова), backoff 1/2/4 с + jitter. */
export const RETRY = {
  maxAttempts: 4,
  backoffMs: [1000, 2000, 4000] as const,
  jitterMs: 500,
};

/**
 * Модель по роли ступени у каждого провайдера (ai-pipeline §2 / §2a).
 * Используется для fallback: anthropic:main ↔ google:main и т.д.
 */
export const ROLE_MODELS: Record<Provider, Record<LlmStage, string>> = {
  anthropic: { gate: 'claude-haiku-4-5', main: 'claude-sonnet-5', escalation: 'claude-opus-5' },
  google: { gate: 'gemini-3.1-flash-lite', main: 'gemini-3.7-flash', escalation: 'gemini-3.1-pro' },
};

/** Цены, $ за 1M токенов. Anthropic — skill claude-api + ai-pipeline §2a (Sonnet 5 с 1.09.2026 — $3/$15); Google — §2a. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Чтение из prompt cache (Anthropic: ×0.1 от input). */
  cacheRead?: number;
  /** Запись в prompt cache, TTL 5 мин (Anthropic: ×1.25 от input). */
  cacheWrite?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Gemini: thinking-токены тарифицируются как output (уже входят в outputTokens). Вводные цены до 31.12.2026.
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.1-pro': { input: 2, output: 12 },
};

export interface TokenUsage {
  /** Некэшированные входные токены (полная цена). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export function priceFor(model: string): ModelPrice | undefined {
  return MODEL_PRICES[model];
}

/** Стоимость вызова в USD. Неизвестная модель → 0 (вызывающий логирует price_known=false). */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  if (!p) return 0;
  const perToken = 1 / 1_000_000;
  const cacheRead = p.cacheRead ?? p.input;
  const cacheWrite = p.cacheWrite ?? p.input;
  const usd =
    usage.inputTokens * p.input +
    usage.cacheReadTokens * cacheRead +
    usage.cacheWriteTokens * cacheWrite +
    usage.outputTokens * p.output;
  return usd * perToken;
}

export function isProvider(s: string): s is Provider {
  return (PROVIDERS as readonly string[]).includes(s);
}

/** `provider:model` → ModelSpec. Ошибка на неизвестном провайдере или пустой модели. */
export function parseModelSpec(s: string): ModelSpec {
  const idx = s.indexOf(':');
  if (idx <= 0) throw new Error(`Bad model spec "${s}": expected provider:model`);
  const provider = s.slice(0, idx).trim();
  const model = s.slice(idx + 1).trim();
  if (!isProvider(provider)) throw new Error(`Bad model spec "${s}": unknown provider "${provider}"`);
  if (!model) throw new Error(`Bad model spec "${s}": empty model`);
  return { provider, model };
}

export function formatModelSpec(spec: ModelSpec): string {
  return `${spec.provider}:${spec.model}`;
}

export function otherProvider(p: Provider): Provider {
  return p === 'anthropic' ? 'google' : 'anthropic';
}

/**
 * Fallback для ступени: второй провайдер, модель той же роли (ROLE_MODELS).
 * Если основной провайдер и есть FALLBACK_PROVIDER — берём противоположный, чтобы fallback всегда был другим провайдером.
 */
export function fallbackSpec(stage: LlmStage, primary: ModelSpec, fallbackProvider: Provider): ModelSpec {
  const provider = primary.provider === fallbackProvider ? otherProvider(fallbackProvider) : fallbackProvider;
  return { provider, model: ROLE_MODELS[provider][stage] };
}

/** Конфиг ступеней. Ключей API здесь нет — они живут только внутри резолвера провайдеров (providers.ts). */
export interface LlmConfig {
  stages: Record<LlmStage, ModelSpec>;
  fallbackProvider: Provider;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const fb = env.FALLBACK_PROVIDER?.trim() || DEFAULT_FALLBACK_PROVIDER;
  if (!isProvider(fb)) throw new Error(`FALLBACK_PROVIDER: unknown provider "${fb}"`);
  return {
    stages: {
      gate: parseModelSpec(env.STAGE_GATE?.trim() || STAGE_DEFAULTS.gate),
      main: parseModelSpec(env.STAGE_MAIN?.trim() || STAGE_DEFAULTS.main),
      escalation: parseModelSpec(env.STAGE_ESCALATION?.trim() || STAGE_DEFAULTS.escalation),
    },
    fallbackProvider: fb,
  };
}

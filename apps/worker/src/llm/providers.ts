// Фабрика моделей Vercel AI SDK по ModelSpec (ai-pipeline §2a). Ключи API читаются только здесь и в лог не попадают.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, generateText } from 'ai';
import type { LlmStage, ModelSpec, Provider } from './config.js';

export type ModelResolver = (spec: ModelSpec) => LanguageModel;
/** `ai` не экспортирует ProviderOptions напрямую — берём из сигнатуры generateText. */
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;

export class MissingApiKeyError extends Error {
  constructor(readonly provider: Provider) {
    super(`No API key configured for provider "${provider}"`);
    this.name = 'MissingApiKeyError';
  }
}

/** Имена переменных окружения с ключами (dev-plan §6 называет GOOGLE_API_KEY; .env.example/SDK — GOOGLE_GENERATIVE_AI_API_KEY). */
export const API_KEY_ENV: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

export function hasApiKey(provider: Provider, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[API_KEY_ENV[provider]]);
}

/** Резолвер `provider:model` → LanguageModel по явно переданным ключам (тесты, smoke). Провайдеры создаются лениво. */
export function createModelResolver(apiKeys: Record<Provider, string | undefined>): ModelResolver {
  let anthropic: ReturnType<typeof createAnthropic> | undefined;
  let google: ReturnType<typeof createGoogleGenerativeAI> | undefined;
  return (spec) => {
    const key = apiKeys[spec.provider];
    if (!key) throw new MissingApiKeyError(spec.provider);
    switch (spec.provider) {
      case 'anthropic':
        anthropic ??= createAnthropic({ apiKey: key });
        return anthropic(spec.model);
      case 'google':
        google ??= createGoogleGenerativeAI({ apiKey: key });
        return google(spec.model);
    }
  };
}

/** Резолвер по ключам из окружения. Единственное место, где ключи читаются в рантайме воркера. */
export function createModelResolverFromEnv(env: NodeJS.ProcessEnv = process.env): ModelResolver {
  return createModelResolver({
    anthropic: env[API_KEY_ENV.anthropic] || undefined,
    google: env[API_KEY_ENV.google] || undefined,
  });
}

/**
 * Минимальный уровень thinking для Gemini 3.x (ai-pipeline §2a: thinking-токены = output, ограничивать явно).
 * Повторяет правило @ai-sdk/google: Flash ≥ 3.7 (не Lite) принимает минимум "low", остальные — "minimal".
 */
export function minimalThinkingLevel(model: string): 'minimal' | 'low' {
  const name = model.split('/').at(-1)?.toLowerCase() ?? '';
  const m = /^gemini-(\d+)\.(\d+)-flash(?:$|-(?!lite(?:-|$)))/.exec(name);
  if (!m) return 'minimal';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 3 || (major === 3 && minor >= 7) ? 'low' : 'minimal';
}

/** Модели Anthropic с adaptive thinking и параметром effort (Sonnet 5 / Opus 5 / 4.6+). Haiku 4.5 — нет (effort → 400). */
export function supportsAnthropicEffort(model: string): boolean {
  return /^claude-(opus|sonnet)-(4-[6-9]|[5-9])(?:-|$)/.test(model);
}

/**
 * Anthropic: `budgetTokens` на Sonnet 5 / Opus 5 отвергается с 400 (skill claude-api), поэтому thinking ограничиваем
 * через adaptive + effort: main — low (структурированная задача, ~600 токенов ответа), escalation — medium (ревью спорного).
 */
export const ANTHROPIC_EFFORT: Record<LlmStage, 'low' | 'medium' | 'high' | undefined> = {
  gate: undefined,
  main: 'low',
  escalation: 'medium',
};

/** Провайдерные опции вызова: Google — минимальный thinking; Anthropic — adaptive thinking с ограниченным effort. */
export function providerOptionsFor(spec: ModelSpec, stage: LlmStage): ProviderOptions {
  if (spec.provider === 'google') {
    return { google: { thinkingConfig: { thinkingLevel: minimalThinkingLevel(spec.model), includeThoughts: false } } };
  }
  const effort = ANTHROPIC_EFFORT[stage];
  if (effort && supportsAnthropicEffort(spec.model)) {
    return { anthropic: { thinking: { type: 'adaptive' }, effort } };
  }
  return {};
}

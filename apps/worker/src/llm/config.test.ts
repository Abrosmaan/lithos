import { describe, expect, it } from 'vitest';
import { RETRY, estimateCostUsd, fallbackSpec, loadLlmConfig, parseModelSpec } from './config.js';
import { MissingApiKeyError, createModelResolverFromEnv, hasApiKey, minimalThinkingLevel, providerOptionsFor, supportsAnthropicEffort } from './providers.js';

describe('llm config', () => {
  it('parses provider:model', () => {
    expect(parseModelSpec('anthropic:claude-sonnet-5')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(parseModelSpec(' google:gemini-3.7-flash ')).toEqual({ provider: 'google', model: 'gemini-3.7-flash' });
    expect(() => parseModelSpec('openai:gpt')).toThrow(/unknown provider/);
    expect(() => parseModelSpec('anthropic:')).toThrow(/empty model/);
    expect(() => parseModelSpec('nocolon')).toThrow(/provider:model/);
  });

  it('uses dev-plan §6 defaults when env is empty', () => {
    const c = loadLlmConfig({});
    expect(c.stages).toEqual({
      gate: { provider: 'google', model: 'gemini-3.1-flash-lite' },
      main: { provider: 'anthropic', model: 'claude-sonnet-5' },
      escalation: { provider: 'anthropic', model: 'claude-opus-5' },
    });
    expect(c.fallbackProvider).toBe('google');
    expect(RETRY.maxAttempts).toBe(4); // исходный + 3 ретрая
    expect('apiKeys' in c).toBe(false); // ключи — только в резолвере провайдеров
  });

  it('reads STAGE_* / FALLBACK_PROVIDER from env', () => {
    const c = loadLlmConfig({ STAGE_GATE: 'anthropic:claude-haiku-4-5', FALLBACK_PROVIDER: 'anthropic' });
    expect(c.stages.gate).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(c.fallbackProvider).toBe('anthropic');
    expect(() => loadLlmConfig({ FALLBACK_PROVIDER: 'azure' })).toThrow(/unknown provider/);
  });

  it('fallback is always the other provider, same stage role', () => {
    expect(fallbackSpec('main', { provider: 'anthropic', model: 'claude-sonnet-5' }, 'google')).toEqual({
      provider: 'google',
      model: 'gemini-3.7-flash',
    });
    // основной уже google, FALLBACK_PROVIDER=google → зеркально на anthropic
    expect(fallbackSpec('gate', { provider: 'google', model: 'gemini-3.1-flash-lite' }, 'google')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
    expect(fallbackSpec('escalation', { provider: 'anthropic', model: 'claude-opus-5' }, 'google')).toEqual({
      provider: 'google',
      model: 'gemini-3.1-pro',
    });
  });

  it('estimates cost per 1M tokens incl. cache read/write', () => {
    const usd = estimateCostUsd('claude-sonnet-5', { inputTokens: 700, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 50 });
    // 700×3 + 200×0.3 + 100×3.75 + 50×15 = 2100 + 60 + 375 + 750 = 3285 µ$
    expect(usd).toBeCloseTo(0.003285, 9);
    expect(estimateCostUsd('gemini-3.1-flash-lite', { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBeCloseTo(0.25, 9);
    expect(estimateCostUsd('unknown-model', { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 })).toBe(0);
  });
});

describe('providers', () => {
  it('picks minimal thinking level for Gemini', () => {
    expect(minimalThinkingLevel('gemini-3.1-flash-lite')).toBe('minimal');
    expect(minimalThinkingLevel('gemini-3.1-pro')).toBe('minimal');
    expect(minimalThinkingLevel('gemini-3.7-flash')).toBe('low');
    expect(minimalThinkingLevel('gemini-3.5-flash')).toBe('minimal');
  });

  it('google gets minimal thinkingConfig on every stage', () => {
    expect(providerOptionsFor({ provider: 'google', model: 'gemini-3.7-flash' }, 'main')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } },
    });
    expect(providerOptionsFor({ provider: 'google', model: 'gemini-3.1-flash-lite' }, 'gate')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } },
    });
  });

  it('anthropic: adaptive thinking with bounded effort on main/escalation, nothing on gate/Haiku', () => {
    expect(providerOptionsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }, 'main')).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'low' },
    });
    expect(providerOptionsFor({ provider: 'anthropic', model: 'claude-opus-5' }, 'escalation')).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' },
    });
    expect(providerOptionsFor({ provider: 'anthropic', model: 'claude-haiku-4-5' }, 'gate')).toEqual({});
    expect(providerOptionsFor({ provider: 'anthropic', model: 'claude-haiku-4-5' }, 'main')).toEqual({}); // effort на Haiku → 400
    expect(supportsAnthropicEffort('claude-sonnet-4-6')).toBe(true);
    expect(supportsAnthropicEffort('claude-sonnet-4-5')).toBe(false);
  });

  it('keys live only in the resolver, read from env', () => {
    expect(hasApiKey('anthropic', { ANTHROPIC_API_KEY: 'x' })).toBe(true);
    expect(hasApiKey('google', { ANTHROPIC_API_KEY: 'x' })).toBe(false);
    const resolve = createModelResolverFromEnv({ ANTHROPIC_API_KEY: 'x' });
    expect(() => resolve({ provider: 'google', model: 'gemini-3.7-flash' })).toThrow(MissingApiKeyError);
    expect(resolve({ provider: 'anthropic', model: 'claude-sonnet-5' })).toBeTruthy();
  });
});

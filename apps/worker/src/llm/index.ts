// Публичный API провайдерного слоя (T1.3). Конвейер T2.x импортирует отсюда.
// Первым — конфиг воркера: он грузит .env, из которого резолвер провайдеров берёт ключи.
import '../config.js';

export { callModel, LlmUnavailableError, classifyError, REPAIR_INSTRUCTION, type CallModelDeps, type LlmFailureCause } from './callModel.js';
export type { CallModelInput, CallModelOutput, FallbackReason, ImageInput, UserLanguage } from './types.js';
export {
  loadLlmConfig,
  parseModelSpec,
  formatModelSpec,
  fallbackSpec,
  estimateCostUsd,
  MODEL_PRICES,
  ROLE_MODELS,
  STAGE_DEFAULTS,
  STAGE_TIMEOUT_MS,
  type LlmConfig,
  type LlmStage,
  type ModelSpec,
  type Provider,
  type TokenUsage,
} from './config.js';
export {
  createModelResolver,
  createModelResolverFromEnv,
  hasApiKey,
  providerOptionsFor,
  MissingApiKeyError,
  type ModelResolver,
} from './providers.js';
export { CircuitBreaker, BreakerRegistry, type BreakerState } from './breaker.js';
export { PROMPT_VERSION as GATE_PROMPT_VERSION } from './prompts/gate.js';
export { PROMPT_VERSION as MAIN_PROMPT_VERSION } from './prompts/main.js';
export { PROMPT_VERSION as ESCALATION_PROMPT_VERSION } from './prompts/escalation.js';

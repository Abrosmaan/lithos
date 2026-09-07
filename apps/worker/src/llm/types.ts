// Типы входа/выхода провайдерного слоя (dev-plan T1.3).
import type { GateResult, GeoContext, ScanResult, UserTests } from '@lithos/shared';
import type { LlmStage } from './config.js';

export interface ImageInput {
  /** JPEG/PNG/WebP, уже сжатые клиентом до 1024 px по длинной стороне (ai-pipeline §3 S0). */
  bytes: Uint8Array | Buffer;
  mimeType: string;
}

export type UserLanguage = 'ru' | 'en';

/**
 * Почему результат пришёл не с основного провайдера ступени.
 * 'no_api_key' — основной провайдер не сконфигурирован (не отказ: usedFallback=false, «предварительно» не ставится).
 * Остальные — реальный отказ по ai-pipeline §7 → usedFallback=true.
 */
export type FallbackReason = 'none' | 'no_api_key' | 'breaker_open' | 'provider_error' | 'schema_invalid';

export interface CallModelInput {
  stage: LlmStage;
  /** Gate — используется только первое фото; main/escalation — до 3. */
  images: ImageInput[];
  geo?: GeoContext | null;
  userTests?: UserTests | null;
  userLanguage: UserLanguage;
  /** Вердикт S2 — обязателен для escalation. */
  priorResult?: ScanResult;
  /** Что на фото 1 служит масштабом («coin», «hand»…); null/undefined → "none". */
  scaleObject?: string | null;
  scanId: string;
}

export interface CallModelOutput {
  result: GateResult | ScanResult;
  provider: string;
  model: string;
  promptVersion: string;
  /** Все входные токены (некэшированные + cache read + cache write) по всем успешным вызовам. */
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  /** Основной провайдер реально отказал (breaker_open / provider_error / schema_invalid) и ответил второй. */
  usedFallback: boolean;
  fallbackReason: FallbackReason;
  /** Число HTTP-вызовов модели, включая неудачные и repair. */
  attempts: number;
  /** Ответ прошёл через repair-вызов. */
  repaired: boolean;
}

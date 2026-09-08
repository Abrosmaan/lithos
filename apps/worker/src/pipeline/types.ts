// Типы конвейера (T2.1): строки таблиц lithos.*, интерфейс репозитория (инжектируется в тесты), зависимости.
import type { GeoContext, ScanQueue, ScanStage, UserTests } from '@lithos/shared';
import type { BudgetGuard } from '../limits/budget.js';
import type { CallModelInput, CallModelOutput } from '../llm/index.js';
import type { log } from '../log.js';

export interface ScanRow {
  id: string;
  user_id: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  user_tests: UserTests | null;
  parent_card_id: string | null;
  stage: ScanStage;
  attempt: number;
  cost_usd: number;
  error: string | null;
  created_at: string;
}

export interface PhotoRow {
  id: string;
  scan_id: string;
  storage_path: string;
  phash: string | null;
  is_primary: boolean;
  width: number | null;
  height: number | null;
}

/** Один ряд lithos.scan_results — ступень, её сырой ответ и стоимость. Форма raw_json — см. StageRawJson. */
export interface StageResultRow {
  scan_id: string;
  stage: ScanStage;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  raw_json: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number;
  latency_ms: number | null;
}

/** raw_json ступеней с моделью: результат + метаданные вызова (нужны на replay: fallback → «предварительно»). */
export interface ModelStageRawJson {
  result: unknown;
  meta: {
    used_fallback: boolean;
    fallback_reason: string;
    repaired: boolean;
    attempts: number;
  };
}

/** raw_json ступени preflight при pHash-попадании. */
export interface PhashHitRawJson {
  phash_hit: true;
  source_scan_id: string;
  source_card_id: string;
  distance: number;
}

export type CardState = 'closed' | 'opened';
export type CardVerification = 'ai' | 'community' | 'expert' | 'pending_review';

export interface CardRow {
  id: string;
  scan_id: string;
  user_id: string;
  rock_class: string;
  tier: string | null;
  score: number | null;
  score_breakdown: Record<string, unknown>;
  inclusions: unknown[];
  shape: Record<string, unknown>;
  lore: string | null;
  name: string | null;
  user_name: string | null;
  state: CardState;
  parent_card_id: string | null;
  verification: CardVerification;
  provisional: boolean;
  hidden: boolean;
  cell_id: string | null;
  lat: number | null;
  lng: number | null;
}

/** Поля карточки, которые пишет воркер (upsert по scan_id). id, user_name, hidden, created_at — не трогаем. */
export type CardUpsert = Omit<CardRow, 'id' | 'user_name' | 'hidden'>;

export interface DiaryUpdate {
  user_id: string;
  cell_id: string;
  expected: string[];
  /** Найденная порода; null — только обновить expected. */
  found: string | null;
}

export interface UpsertCardOptions {
  /** scans.stage после записи: 'escalation' — предварительная карточка («уточняем»), 'done' — финал. */
  scanStage: Extract<ScanStage, 'escalation' | 'done'>;
  /** Раскол: родительская карточка скрывается (spec §7). */
  hideCardId?: string | null;
  diary?: DiaryUpdate | null;
}

export interface StageTransition {
  stage: ScanStage;
  /** Только для stage='failed' — код для клиента. */
  error?: string | null;
}

/** Эксклюзивная обработка scan_id (advisory lock): второй воркер / повторное сообщение не платят за модель дважды. */
export interface ScanLock {
  release(): Promise<void>;
}

/** Результат DLQ-обработки: карточка уже есть → done; иначе failed/dlq; busy — скан держит другой процесс, не трогаем. */
export type DlqOutcome = 'failed' | 'done_with_card' | 'noop' | 'busy';

/** Репозиторий конвейера. Реализация на pg — pipeline/repo.ts; в тестах — in-memory. */
export interface PipelineRepo {
  loadScan(scanId: string): Promise<ScanRow | null>;
  loadPhotos(scanId: string): Promise<PhotoRow[]>;
  setPhotoHash(photoId: string, phash: string): Promise<void>;
  /** pHash сканов пользователя за окно: только done, с карточкой (не скрытой), не расколы. */
  findRecentHashedPhotos(userId: string, excludeScanId: string, windowHours: number): Promise<Array<{ scan_id: string; phash: string }>>;
  loadCard(cardId: string): Promise<CardRow | null>;
  loadCardByScan(scanId: string): Promise<CardRow | null>;
  getStageResult(scanId: string, stage: ScanStage): Promise<StageResultRow | null>;
  /** Одна транзакция: insert scan_results ON CONFLICT DO NOTHING + scans.stage/cost_usd/provider/prompt_version. */
  saveStageResult(row: StageResultRow, next: StageTransition): Promise<void>;
  setScanStage(scanId: string, next: StageTransition): Promise<void>;
  /** T3.4: только scans.error, stage не трогаем ('budget_paused' — скан ждёт бюджета; null — снять). */
  setScanError(scanId: string, error: string | null): Promise<void>;
  /** Одна транзакция: cards upsert по scan_id (+ hidden родителя, + diary) + scans.stage. */
  upsertCard(card: CardUpsert, opts: UpsertCardOptions): Promise<CardRow>;
  dlqScan(scanId: string): Promise<DlqOutcome>;
  /** null — скан уже обрабатывается другим процессом (сообщение отложить, не ack). */
  tryLockScan(scanId: string): Promise<ScanLock | null>;
}

export interface PhotoStore {
  download(storagePath: string): Promise<Buffer>;
}

/** Фото не открывается / повреждено / нет в Storage → стоп без retry (ai-pipeline §7). */
export class PhotoUnavailableError extends Error {
  constructor(
    readonly storagePath: string,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoUnavailableError';
  }
}

export type Logger = Pick<typeof log, 'debug' | 'info' | 'warn' | 'error'>;

export interface PipelineDeps {
  repo: PipelineRepo;
  photos: PhotoStore;
  callModel: (input: CallModelInput) => Promise<CallModelOutput>;
  getGeoContext: (lat: number, lng: number) => Promise<GeoContext>;
  log: Logger;
  now: () => number;
  /** T3.4: бюджетный предохранитель; нет → без ограничений (тесты). */
  budget?: BudgetGuard;
}

/** deferred — скан занят другим процессом (reason 'locked') или бюджет исчерпан (reason 'budget_paused'): не ack, вернуть в очередь. */
export type RunStatus = 'done' | 'failed' | 'skipped' | 'deferred';

export interface RunOutcome {
  status: RunStatus;
  scanId: string;
  queue: ScanQueue;
  /** failed → код для клиента; skipped → причина (в лог, не клиенту). */
  reason: string | null;
  cardId: string | null;
  ms: number;
}

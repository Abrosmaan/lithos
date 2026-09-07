// Параметры конвейера (ai-pipeline §3 S0, §4, §7). Это не балансовые числа score — те только в packages/shared/score.ts.

export const PIPELINE = {
  /** Lease сообщения pgmq (ai-pipeline §4). */
  leaseSeconds: 60,
  /** Продление lease во время долгих ступеней (pgmq.set_vt). */
  leaseHeartbeatMs: 20_000,
  /** Таймаут цепочки: дольше — карточка «в обработке», продолжаем в фоне (ai-pipeline §7). */
  chainTimeoutMs: 90_000,
  /** read_ct > maxReads → DLQ (pgmq.archive) + scans.error='dlq'. */
  maxReads: 3,
  /** После ошибки ступени сообщение снова видно через столько секунд (короче lease — быстрее retry). */
  retryDelaySeconds: 10,
  /** Сколько сканов может обрабатываться одновременно (фоновое продолжение после chainTimeout). */
  maxInflight: 2,
  /**
   * Жёсткий дедлайн одной задачи: после него heartbeat прекращается, слот освобождается, результат зависшего
   * runScan игнорируется (без ack) — сообщение возвращается в очередь по lease и штатно доходит до DLQ.
   * Бюджет: gate 20 с + main 30 с + escalation 45 с, каждая × 4 попытки × 2 провайдера + Storage/БД.
   */
  jobDeadlineMs: 600_000,
  /** Graceful shutdown: сколько ждать фоновые задачи. */
  drainTimeoutMs: 120_000,
  /** Storage: таймаут одного скачивания и retry на временных ошибках (CLAUDE.md: внешние вызовы — таймаут + retry). */
  storageTimeoutMs: 15_000,
  storageAttempts: 3,
  storageBackoffMs: 500,

  /** pHash-дедуп: окно и порог Хэмминга (ai-pipeline §3 S0). */
  phashWindowHours: 24,
  phashMaxDistance: 6,
  /** blockhash bits: 8 → 64-битный хэш (16 hex-символов), порог 6 — из 64. */
  phashBits: 8,

  /** S0: длинная сторона и качество JPEG (ai-pipeline §3 S0). Клиент уже сжимает; воркер страхует. */
  imageMaxSide: 1024,
  jpegQuality: 85,
  /** До 3 фото в Main (ai-pipeline §3 S2). */
  maxMainImages: 3,
  /** Язык лора/интерфейса прототипа (CLAUDE.md: тексты — русский). */
  userLanguage: 'ru',
} as const;

/** Коды ошибок для клиента (scans.error). Текст провайдера сюда не попадает никогда (ai-pipeline §7). */
export const SCAN_ERROR_CODES = [
  'not_rock',
  'blurry',
  'dark',
  'too_far',
  'screen_photo',
  'multiple_objects',
  'photo_unavailable',
  'parent_not_found',
  'dlq',
] as const;
export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];

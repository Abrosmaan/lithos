// Тексты экрана результата: коды отказа воркера → композиция «Отказ» из прототипа (глиф, заголовок, тело, кнопки),
// особые состояния, ступени анализа, примечания карточки. Чистый модуль. Тексты — дословно из
// docs/design/Lithos App.dc.html (REFUSALS / SPEC / STAGES / rc.note), см. docs/design/DESIGN_SYSTEM.md.
import type { ScanStage, Tier } from '@lithos/shared';
import { type CardVerification, isScanErrorCode, type ScanErrorCode } from './card-types';

/** Ждём результата не дольше этого (ai-pipeline §7: таймаут цепочки 90 с → «в обработке»). */
export const RESULT_TIMEOUT_MS = 90_000;

export interface RejectText {
  title: string;
  hint: string;
}

/** Кнопки композиции «Отказ / особое»: primary всегда есть, secondary — по таблице прототипа. */
export type RefusalAction = 'retake' | 'collection' | 'rescan' | 'refresh';

export interface RefusalView extends RejectText {
  /** Глиф в кружке: `?`, `~`, `·`, `□`, `∷`, `×`, `!`, `…`, `≡`, `⌁`. */
  glyph: string;
  /** danger — отказ (красная рамка), neutral — особое состояние (серая). */
  tone: 'danger' | 'neutral';
  primary: RefusalAction;
  secondary: RefusalAction | null;
}

export const REFUSAL_ACTION_LABEL: Record<RefusalAction, string> = {
  retake: 'Переснять',
  collection: 'В коллекцию',
  rescan: 'Новый скан',
  refresh: 'Обновить',
};

const danger = (glyph: string, title: string, hint: string, secondary: RefusalAction | null = 'collection'): RefusalView =>
  ({ glyph, title, hint, tone: 'danger', primary: 'retake', secondary });

const REJECT: Record<ScanErrorCode, RefusalView> = {
  not_rock: danger('?', 'Похоже, это не камень', 'Сфотографируйте камень крупно на нейтральном фоне.'),
  blurry: danger('~', 'Фото размыто', 'Переснимите ближе и при хорошем свете — камень должен быть в фокусе.'),
  dark: danger('·', 'Слишком темно или нет деталей', 'Переснимите при хорошем свете: в тени модель не различает структуру.'),
  too_far: danger('·', 'Камень слишком далеко', 'Подойдите ближе, чтобы камень занимал хотя бы пятую часть кадра.'),
  screen_photo: danger('□', 'Фото с экрана не принимаем', 'Снимите камень с натуры — по снимку экрана породу определить нельзя.'),
  multiple_objects: danger('∷', 'В кадре несколько объектов', 'Оставьте один камень в кадре и переснимите.'),
  photo_unavailable: danger('×', 'Не удалось получить фото', 'Переснимите — снимок не дошёл до обработки.'),
  dlq: danger('!', 'Не удалось обработать', 'Попробуйте ещё раз — мы ничего не потеряли.'),
  // Нет в прототипе — состояния конвейера, композиция та же.
  parent_not_found: { glyph: '×', title: 'Исходная карточка не найдена', hint: 'Связать раскол с этой карточкой не получилось. Начните новый скан — камень определим заново.', tone: 'danger', primary: 'rescan', secondary: 'collection' },
  rate_limited: { glyph: '≡', title: 'Лимит сканов на сегодня исчерпан', hint: 'Лимит сканов на сегодня исчерпан — возвращайтесь завтра.', tone: 'neutral', primary: 'collection', secondary: null },
  budget_paused: { glyph: '≡', title: 'Сервис перегружен', hint: 'Обработаем в течение часа — карточка придёт в коллекцию.', tone: 'neutral', primary: 'collection', secondary: 'rescan' },
};

/** Особые состояния экрана результата (SPEC из прототипа): не отказ, серая рамка. */
export type SpecialKind = 'slow' | 'nonet';

const SPECIAL: Record<SpecialKind, RefusalView> = {
  slow: { glyph: '…', title: 'Обрабатываем дольше обычного', hint: 'Карточка появится в коллекции, как только будет готова. Можно закрыть экран.', tone: 'neutral', primary: 'collection', secondary: null },
  // В прототипе «Скан сохранён и отправится сам, когда сеть вернётся» — у нас к этому экрану скан уже на сервере, поэтому честнее так.
  nonet: { glyph: '⌁', title: 'Нет связи', hint: 'Скан уже отправлен — результат появится в коллекции, когда сеть вернётся.', tone: 'neutral', primary: 'refresh', secondary: 'collection' },
};

/** Коды лимитов (T3.4): RPC enqueue_scan может отказать сразу — текст ищем по коду в сообщении ошибки. */
export const LIMIT_ERROR_CODES = ['rate_limited', 'budget_paused'] as const satisfies readonly ScanErrorCode[];

export function limitErrorCode(message: string | null | undefined): ScanErrorCode | null {
  if (!message) return null;
  return LIMIT_ERROR_CODES.find((code) => message.includes(code)) ?? null;
}

/** Композиция отказа по коду scans.error. Неизвестный код → как dlq. */
export function refusalView(code: string | null | undefined): RefusalView {
  return isScanErrorCode(code) ? REJECT[code] : REJECT.dlq;
}

/** Композиция особого состояния (дольше обычного / нет связи). */
export function specialView(kind: SpecialKind): RefusalView {
  return SPECIAL[kind];
}

/** Подсказка по коду scans.error — заголовок и текст (для Alert при отказе RPC). */
export function rejectText(code: string | null | undefined): RejectText {
  const { title, hint } = refusalView(code);
  return { title, hint };
}

// ---------------------------------------------------------------------------
// Анализ: пять ступеней прототипа и их соответствие stage скана.
// ---------------------------------------------------------------------------

export const STAGES = ['Готовим фото', 'Проверяем, что это камень', 'Определяем породу', 'Уточняем детали', 'Считаем редкость'] as const;

/** Индекс текущей ступени в STAGES; null (ещё не подключились) → −1, done/failed → последняя. */
export function stageIndex(stage: ScanStage | null): number {
  switch (stage) {
    case null: return -1;
    case 'preflight': return 0;
    case 'gate': return 1;
    case 'main': return 2;
    case 'escalation': return 3;
    case 'rules': return 4;
    case 'done':
    case 'failed': return STAGES.length - 1;
  }
}

/** Подпись под заголовком «Определяем камень…». */
export function stageStatusText(stage: ScanStage | null): string {
  const i = stageIndex(stage);
  return i < 0 ? 'Подключаемся…' : STAGES[i]!;
}

// ---------------------------------------------------------------------------
// Карточка результата: примечание под тиром (rc.note прототипа) и текст score.
// ---------------------------------------------------------------------------

export const CARD_NOTE = {
  noGeo: 'Без редкости — скан без геопозиции. Порода и лор есть, score не считаем.',
  review: 'Тир «?» — гео-аномалия ушла на ревью. Порода здесь не встречается.',
  provisional: 'Предварительно — результат от резервного провайдера. Тир ограничен «Редким», позже пересчитается.',
} as const;

export interface CardNoteInput {
  score: number | null;
  tier: Tier | null;
  verification: CardVerification;
  provisional: boolean;
}

/** Золотая плашка под тиром: без гео → без редкости; на ревью → тир «?»; резервный провайдер → предварительно. */
export function cardNote(card: CardNoteInput): string | null {
  if (card.verification === 'pending_review') return CARD_NOTE.review;
  if (card.score === null || card.tier === null) return CARD_NOTE.noGeo;
  if (card.provisional) return CARD_NOTE.provisional;
  return null;
}

/** Цифра score для TierLine: нет score → «—», на ревью → «?». */
export function scoreText(score: number | null, verification: CardVerification): string {
  if (verification === 'pending_review') return '?';
  return score === null ? '—' : String(score);
}

export const RESULT_MSG = {
  determining: 'Определяем камень…',
  refining: 'Уточняем',
  provisional: 'Предварительно',
  saved: 'Карточка уже сохранена в коллекции',
  loadFailed: 'Не удалось загрузить результат. Проверьте интернет и попробуйте ещё раз.',
} as const;

export type ResultPhase = 'loading' | 'determining' | 'refining' | 'done' | 'failed' | 'paused';

/** Сколько чтений подряд терпим stage=done без строки cards (гонка записи), прежде чем перестать ждать. */
export const DONE_WITHOUT_CARD_MAX_READS = 5;

/**
 * Наблюдение можно остановить: failed — всегда; done — только когда карточка уже видна
 * (две строки читаются двумя запросами, cards может отстать на коммит) или терпение вышло.
 */
export function isTerminalSnapshot(stage: ScanStage | null, hasCard: boolean, doneWithoutCardReads: number): boolean {
  if (stage === 'failed') return true;
  if (stage !== 'done') return false;
  return hasCard || doneWithoutCardReads >= DONE_WITHOUT_CARD_MAX_READS;
}

/**
 * Фаза экрана по stage скана, наличию карточки и scans.error (контракт T2.1: карточка есть после Main, обновляется
 * после S3/S4). T3.4: бюджет ≥ 100 % — воркер stage не трогает, пишет только error='budget_paused' → «пауза»:
 * не спиннер, скан обработается позже и карточка появится в коллекции. Карточка уже есть → показываем её.
 */
export function resultPhase(stage: ScanStage | null, hasCard: boolean, error: string | null = null): ResultPhase {
  if (stage === null) return 'loading';
  if (stage === 'failed') return 'failed';
  if (stage === 'done') return hasCard ? 'done' : 'determining';
  if (hasCard) return 'refining';
  return error === 'budget_paused' ? 'paused' : 'determining';
}

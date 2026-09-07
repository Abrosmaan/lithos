// Тексты экрана результата: коды отказа воркера → русские подсказки, статусы ступеней. Чистый модуль.
import type { ScanStage } from '@lithos/shared';
import { isScanErrorCode, type ScanErrorCode } from './card-types';

/** Ждём результата не дольше этого (ai-pipeline §7: таймаут цепочки 90 с → «в обработке»). */
export const RESULT_TIMEOUT_MS = 90_000;

export interface RejectText {
  title: string;
  hint: string;
}

const REJECT: Record<ScanErrorCode, RejectText> = {
  not_rock: { title: 'Похоже, это не камень', hint: 'Мы определяем только природные камни. Если это камень — снимите его крупнее, на однотонном фоне.' },
  blurry: { title: 'Фото размыто', hint: 'Переснимите ближе, при хорошем свете и не двигая телефон.' },
  dark: { title: 'Слишком темно', hint: 'Переснимите при дневном свете или включите фонарик.' },
  too_far: { title: 'Камень слишком далеко', hint: 'Подойдите ближе — камень должен занимать большую часть кадра.' },
  screen_photo: { title: 'Фото с экрана не принимаем', hint: 'Нужен настоящий камень в руках, а не фото с экрана или из интернета.' },
  multiple_objects: { title: 'В кадре несколько предметов', hint: 'Оставьте один камень и монету для масштаба, уберите остальное.' },
  parent_not_found: { title: 'Исходная карточка не найдена', hint: 'Связать раскол с этой карточкой не получилось. Начните новый скан — камень определим заново.' },
  photo_unavailable: { title: 'Не удалось получить фото', hint: 'Не удалось получить фото — переснимите камень и отправьте ещё раз.' },
  dlq: { title: 'Не удалось обработать', hint: 'Не удалось обработать, попробуйте ещё раз.' },
};

/** Подсказка по коду scans.error. Неизвестный код → как dlq. */
export function rejectText(code: string | null | undefined): RejectText {
  return isScanErrorCode(code) ? REJECT[code] : REJECT.dlq;
}

/** Подпись под спиннером, пока карточки ещё нет. */
export function stageStatusText(stage: ScanStage): string {
  switch (stage) {
    case 'preflight': return 'Готовим фото…';
    case 'gate': return 'Проверяем, что это камень…';
    case 'main': return 'Определяем породу…';
    case 'escalation': return 'Уточняем у второй модели…';
    case 'rules': return 'Считаем редкость…';
    case 'done': return 'Готово';
    case 'failed': return 'Не удалось';
  }
}

export const RESULT_MSG = {
  determining: 'Определяем…',
  refining: 'Уточняем',
  provisional: 'Предварительно',
  slow: 'Обрабатываем дольше обычного, карточка появится в коллекции.',
  loadFailed: 'Не удалось загрузить результат. Проверьте интернет и попробуйте ещё раз.',
} as const;

export type ResultPhase = 'loading' | 'determining' | 'refining' | 'done' | 'failed';

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

/** Фаза экрана по stage скана и наличию карточки (контракт T2.1: карточка есть после Main, обновляется после S3/S4). */
export function resultPhase(stage: ScanStage | null, hasCard: boolean): ResultPhase {
  if (stage === null) return 'loading';
  if (stage === 'failed') return 'failed';
  if (stage === 'done') return hasCard ? 'done' : 'determining';
  return hasCard ? 'refining' : 'determining';
}

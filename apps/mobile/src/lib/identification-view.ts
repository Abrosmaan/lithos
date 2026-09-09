// Определение как список кандидатов с процентами (UX в духе iNaturalist) для экранов Результат и Карточка.
// Чистый модуль. Источник кандидатов — сама карточка (cards.rock_class + score_breakdown.meta.{confidence,
// alternatives}, воркер T5.0); запасной путь для старых карточек без meta — scan_results (последний вердикт:
// escalation, иначе main). Проценты — вероятность ОПРЕДЕЛЕНИЯ по фото, не состав (spec §11); score/тир от них
// не зависят (spec §4.3), поэтому здесь нет ни одного числа-порога — band и шаг округления из @lithos/shared.
import { type Identification, type IdentificationBand, type IdentificationCandidate, identificationCandidates, type ScanResult } from '@lithos/shared';
import type { CardRow, IdentificationMeta, ScanResultRow } from './card-types';
import { parseModelResult } from './history';
import { pluralRu } from './text';

export interface CandidateLine extends IdentificationCandidate {
  /** «Базальт · 80 %» — единственный текст строки; дублирует полоску, чтобы цвет/длина не были единственным носителем. */
  label: string;
  /** Подпись для скринридера: «Базальт: 80 процентов, основной вариант». */
  accessibilityLabel: string;
}

/** Ступени с вердиктом модели, от свежей к первой (запасной путь по scan_results). */
const VERDICT_STAGES = ['escalation', 'main'] as const;
type VerdictStage = (typeof VERDICT_STAGES)[number];
/** Откуда взят вердикт: meta карточки или ступень scan_results. */
export type IdentificationSource = 'card' | VerdictStage;

export interface IdentificationView {
  band: IdentificationBand;
  primary: Identification['primary'];
  /** Русское название primary (из справочника shared). */
  primaryName: string;
  /** «Уверены: это базальт» / «Скорее всего базальт» / «Похоже на базальт, но не уверены». */
  headline: string;
  candidates: CandidateLine[];
  source: IdentificationSource;
}

/** Подпись под score/тиром — одна на оба экрана. */
export const IDENTIFICATION_NOTE = 'Вероятность определения по фото, не состав камня. Редкость считается по правилам и от процентов не зависит.';

/** Неразрывный пробел перед «%», чтобы строка не рвалась перед знаком. */
const NBSP = ' ';

/** Названия пород — нарицательные; в середине фразы пишем со строчной («Скорее всего базальт»). */
function lowerFirst(s: string): string {
  return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}

export function identificationHeadline(band: IdentificationBand, name: string): string {
  const n = lowerFirst(name);
  switch (band) {
    case 'sure': return `Уверены: это ${n}`;
    case 'likely': return `Скорее всего ${n}`;
    case 'unsure': return `Похоже на ${n}, но не уверены`;
  }
}

/** Единый формат строки «имя · N %» — для списка на экране и сводки в истории. */
export function candidateLabel(c: Pick<IdentificationCandidate, 'name_ru' | 'percent'>): string {
  return `${c.name_ru} · ${c.percent}${NBSP}%`;
}

function candidateA11y(c: IdentificationCandidate): string {
  // Проценты кратны IDENTIFICATION_PERCENT_STEP из shared (сейчас всегда «процентов»), но склоняем честно —
  // если шаг изменится, подпись не сломается.
  const base = `${c.name_ru}: ${c.percent} ${pluralRu(c.percent, 'процент', 'процента', 'процентов')}`;
  if (c.is_primary) return `${base}, основной вариант`;
  return c.reason ? `${base}. ${c.reason}` : base;
}

/** identificationCandidates из shared читает только rock_class; остальные поля ScanResult клиенту не нужны. */
function candidatesOf(rockClass: IdentificationMeta): Identification {
  return identificationCandidates({ rock_class: rockClass } as ScanResult);
}

export function identificationFromRockClass(rockClass: IdentificationMeta, source: IdentificationSource): IdentificationView {
  const id = candidatesOf(rockClass);
  const primaryName = id.candidates.find((c) => c.is_primary)?.name_ru ?? id.primary;
  return {
    band: id.band,
    primary: id.primary,
    primaryName,
    headline: identificationHeadline(id.band, primaryName),
    candidates: id.candidates.map((c) => ({ ...c, label: candidateLabel(c), accessibilityLabel: candidateA11y(c) })),
    source,
  };
}

export function identificationFromResult(result: ScanResult, stage: VerdictStage): IdentificationView {
  return identificationFromRockClass(result.rock_class, stage);
}

function stageIdentification(rows: ScanResultRow[], stage: VerdictStage): IdentificationView | null {
  const row = rows.find((r) => r.stage === stage);
  const parsed = row ? parseModelResult(row.raw_json) : null;
  return parsed ? identificationFromResult(parsed, stage) : null;
}

/** Последний вердикт с валидным ответом модели: escalation, иначе main. Невалидный raw_json пропускается. */
export function latestIdentification(rows: ScanResultRow[]): IdentificationView | null {
  for (const stage of VERDICT_STAGES) {
    const v = stageIdentification(rows, stage);
    if (v) return v;
  }
  return null;
}

/**
 * Список для карточки. Сначала meta самой карточки — без запроса scan_results и без гонок (primary = rock_class
 * по построению). Если meta нет (старые карточки) — по scan_results, и тогда список показываем только когда
 * primary вердикта совпадает с cards.rock_class: иначе заголовок «скорее всего X» спорил бы с карточкой Y
 * (гонка: scan_results уже от escalation, карточка ещё от main). rows = null — запасной путь ещё не загружен.
 */
export function cardIdentification(card: Pick<CardRow, 'rock_class' | 'identification'>, rows: ScanResultRow[] | null): IdentificationView | null {
  if (card.identification) return identificationFromRockClass(card.identification, 'card');
  if (!rows) return null;
  const v = latestIdentification(rows);
  return v && v.primary === card.rock_class ? v : null;
}

/** Списки считаются одинаковыми, если совпадают породы и проценты в том же порядке (reason не сравниваем). */
export function sameCandidates(a: IdentificationView, b: IdentificationView): boolean {
  if (a.candidates.length !== b.candidates.length) return false;
  return a.candidates.every((c, i) => c.rock_class === b.candidates[i]!.rock_class && c.percent === b.candidates[i]!.percent);
}

/** Краткая строка списка для истории: «Базальт · 60 %, Андезит · 30 %, другое · 10 %». */
export function candidatesSummary(view: IdentificationView): string {
  return view.candidates.map(candidateLabel).join(', ');
}

/**
 * Что показывал первичный вердикт, если уточнение его изменило: «было: …» для истории версий.
 * null — нет уточнения, нет валидного main или списки совпадают.
 */
export function identificationBefore(rows: ScanResultRow[]): string | null {
  const main = stageIdentification(rows, 'main');
  const escalation = stageIdentification(rows, 'escalation');
  if (!main || !escalation || sameCandidates(main, escalation)) return null;
  return `было: ${candidatesSummary(main)}`;
}

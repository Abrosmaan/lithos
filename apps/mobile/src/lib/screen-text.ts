// Тексты и мелкие форматтеры экранов коллекции/карточки/дневника/карты (прототип, строки 1210–1481).
// Чистый модуль: без RN и Supabase. Балансовых чисел нет — только подписи.
import { FALLBACK_MAX_TIER, TIER_RU } from '@lithos/shared';
import { describeBreakdown, formatDateRu } from './card-facts';
import type { CardRow, CardVerification } from './card-types';
import type { DiaryProgress } from './diary';
import type { LatLng } from './geohash';
import { pluralRu } from './text';

// ---------------------------------------------------------------------------
// Коллекция
// ---------------------------------------------------------------------------

/** «8 карточек» под H1. */
export function cardsCountText(n: number): string {
  return `${n} ${pluralRu(n, 'карточка', 'карточки', 'карточек')}`;
}

export interface EmptyState {
  title: string;
  body: string;
  label: string;
}

/** Пустое состояние коллекции: всё пусто → зовём на пляж; пусто в фильтре → предлагаем снять фильтр (прототип 1433–1437). */
export function collectionEmptyState(filterActive: boolean): EmptyState {
  return filterActive
    ? { title: 'В этом тире пока пусто', body: 'Здесь появятся камни этого тира. Попробуйте другой фильтр или сходите за новым камнем.', label: 'Показать все' }
    : { title: 'Пока пусто', body: 'Первый камень найдётся под ногами: галька на пляже, скол у тропы. Снимите — и здесь появится карточка.', label: 'Сканировать' };
}

/** Подпись входа в дневник: «Ячейка u8vx2k · 5 из 8», без данных — приглашение. */
export function diaryEntrySubtitle(cellId: string | null, progress: Pick<DiaryProgress, 'foundCount' | 'total'> | null): string {
  if (!cellId || !progress || progress.total === 0) return 'Откройте, чтобы увидеть ожидаемые породы';
  return `${cellTitle(cellId)} · ${progress.foundCount} из ${progress.total}`;
}

// ---------------------------------------------------------------------------
// Дневник
// ---------------------------------------------------------------------------

/** Топонимов у ячеек нет (geohash-6) — «Ячейка u8vx2k». */
export function cellTitle(cellId: string): string {
  return `Ячейка ${cellId}`;
}

/** «ячейка ≈1 км · 44.79 N, 37.36 E» — geohash-6 ≈ 1.2 × 0.6 км. */
export function cellCoordsText(center: LatLng | null): string {
  if (!center) return 'ячейка ≈1 км';
  const lat = `${Math.abs(center.latitude).toFixed(2)} ${center.latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(center.longitude).toFixed(2)} ${center.longitude >= 0 ? 'E' : 'W'}`;
  return `ячейка ≈1 км · ${lat}, ${lng}`;
}

export const DIARY_NO_GEO_NOTE = 'Нет геопозиции — показана ячейка последней находки. Включите геопозицию, чтобы видеть дневник места, где вы стоите.';

/** «из 8 ожидаемых пород» рядом с крупной цифрой. */
export function expectedTotalText(total: number): string {
  return `из ${total} ${pluralRu(total, 'ожидаемой породы', 'ожидаемых пород', 'ожидаемых пород')}`;
}

// ---------------------------------------------------------------------------
// Карта
// ---------------------------------------------------------------------------

/** «14 точек · 1 ячейка закрыта»; без закрытых ячеек — только точки. */
export function mapSummaryText(points: number, closedCells: number): string {
  const p = `${points} ${pluralRu(points, 'точка', 'точки', 'точек')}`;
  if (closedCells === 0) return p;
  return `${p} · ${closedCells} ${pluralRu(closedCells, 'ячейка закрыта', 'ячейки закрыты', 'ячеек закрыто')}`;
}

// ---------------------------------------------------------------------------
// Карточка и плитки
// ---------------------------------------------------------------------------

type ScoreLike = Pick<CardRow, 'score' | 'verification'>;

/** Score для плитки/карточки: на ревью — «?», без гео — «—», иначе число. */
export function scoreText(card: ScoreLike): string {
  if (card.verification === 'pending_review') return '?';
  return card.score === null ? '—' : String(card.score);
}

/** Флаг на фото плитки: «предварительно» важнее «раскрыт». */
export function tileFlag(card: Pick<CardRow, 'provisional' | 'state'>): string | null {
  if (card.provisional) return 'предварительно';
  if (card.state === 'opened') return 'раскрыт';
  return null;
}

/** Короткий ID в духе прототипа: «LTH-4A7C1B2D» — первые 8 hex uuid. */
export function cardShortId(id: string): string {
  return `LTH-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** «7 сен 2026, 14:02» (локальное время); невалидная дата → null. */
export function formatDateTimeRu(iso: string): string | null {
  const day = formatDateRu(iso);
  if (!day) return null;
  const d = new Date(iso);
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function pointsText(n: number): string {
  return `${n} ${pluralRu(n, 'очко', 'очка', 'очков')}`;
}

export const STATE_RU = { closed: 'Закрытый', opened: 'Раскрытый' } as const;

export interface BreakdownRow {
  key: string;
  /** «+20», «—», «?» — mono, ширина 42. */
  pts: string;
  label: string;
  why: string;
}

/**
 * Четыре слоя разбора score (прототип: mono ±очки + слой + причина). Без breakdown — одна строка-объяснение:
 * на ревью — «Тир на ревью», без гео — «Редкость не считалась».
 */
export function breakdownRows(card: Pick<CardRow, 'score' | 'score_breakdown' | 'verification'>): BreakdownRow[] {
  if (card.verification === 'pending_review') {
    return [{ key: 'review', pts: '?', label: 'Тир на ревью', why: 'гео-аномалия: порода не совпадает с геологией места — карточку проверят' }];
  }
  if (!card.score_breakdown) {
    return [{ key: 'none', pts: '—', label: 'Редкость не считалась', why: 'нет геопозиции: слой «Место» и итоговый score недоступны' }];
  }
  const rows = describeBreakdown(card.score_breakdown).map((l) => ({
    key: l.key,
    pts: `+${l.points}`,
    label: `${l.title} ${l.points}`,
    why: l.lines.map((x) => (x.points !== undefined ? `${x.text.toLowerCase()} ${x.points}` : x.text.toLowerCase())).join(' · '),
  }));
  if (card.score === null) rows.push({ key: 'nogeo', pts: '—', label: 'Итог не присвоен', why: 'слои посчитаны, но без геопозиции итоговый score не присваивается' });
  return rows;
}

export interface HistoryLine {
  key: string;
  title: string;
  meta: string;
  /** Тап ведёт на другую карточку (родитель до раскола). */
  cardId?: string;
}

interface HistoryInput {
  history: readonly { stage: string; title: string; rockClassRu: string | null; note: string | null; usedFallback: boolean; createdAt: string }[];
  /** «было: …» — первичный список кандидатов, если уточнение его изменило. */
  before: string | null;
  parent: { id: string; name: string; score: number | null } | null;
  provisional: boolean;
  verification: CardVerification;
}

/** Строки «Истории версий»: ступени модели → родитель до раскола → предварительный статус. */
export function historyLines(input: HistoryInput): HistoryLine[] {
  const lines: HistoryLine[] = [];
  if (input.parent) {
    const score = input.parent.score !== null ? `, ${pointsText(input.parent.score)}` : '';
    lines.push({ key: 'parent', title: `До раскола — ${input.parent.name}${score}`, meta: 'открыть карточку до раскола', cardId: input.parent.id });
  }
  for (const h of input.history) {
    const meta = [formatDateTimeRu(h.createdAt), h.usedFallback ? 'резервный провайдер' : null, h.stage === 'escalation' ? input.before : null, h.note]
      .filter((x): x is string => !!x)
      .join(' · ');
    lines.push({ key: h.stage, title: h.rockClassRu ? `${h.title} — ${h.rockClassRu.toLowerCase()}` : h.title, meta });
  }
  if (input.provisional) lines.push({ key: 'provisional', title: 'Ожидает пересчёта редкости', meta: `тир ограничен «${TIER_RU[FALLBACK_MAX_TIER]}»` });
  if (input.verification === 'pending_review') lines.push({ key: 'review', title: 'Отправлена на ревью', meta: 'тир появится после проверки' });
  return lines;
}

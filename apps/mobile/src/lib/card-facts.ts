// Чистые помощники карточки: три факта, расшифровка breakdown, дельта score, имена, даты.
// Балансовых чисел здесь нет — баллы приходят из breakdown (посчитан воркером через @lithos/shared),
// потолки слоёв импортируются из shared.
import {
  COMPOSITION_LAYER_MAX, EXTENT_RU, MINERAL_RU, PLACE_LAYER_MAX, QUALITY_LAYER_MAX, ROCK_CLASS_GROUP, ROCK_CLASS_RU,
  SHAPE_LAYER_MAX, SURFACE_RU, TIER_RU, WANDERER_MECHANISM_RU,
  type Inclusion, type Mineral, type RockClass, type RockGroup, type ScoreBreakdown, type Surface, type Tier,
} from '@lithos/shared';
import type { CardRow, CardVerification } from './card-types';

const ROCK_GROUP_RU: Record<RockGroup, string> = {
  igneous: 'магматическая',
  sedimentary: 'осадочная',
  metamorphic: 'метаморфическая',
  other: 'особая находка',
  unknown: 'группа не определена',
};

const SHAPE_REASON_RU: Record<ScoreBreakdown['shape']['reason'], string> = {
  natural_hole: 'Сквозное отверстие — «куриный бог»',
  silhouette: 'Узнаваемый силуэт',
  banded: 'Полосчатый рисунок',
  spheroid: 'Идеально окатанный сфероид',
  plain: 'Обычная галька',
};

const PLACE_REASON_RU: Record<ScoreBreakdown['place']['reason'], string> = {
  match: 'Соответствует геологии места',
  wanderer: 'Странник',
  mismatch_no_mechanism: 'Не типичен для места — на проверке',
  mismatch_implausible: 'Не типичен для места — на проверке',
  unknown_class: 'Порода не определена точно',
  no_geo: 'Без геопозиции — соответствие не проверено',
  ubiquitous: 'Встречается повсеместно',
};

const BASE_REASON_RU: Record<ScoreBreakdown['composition']['base']['reason'], string> = {
  dominant: 'Порода доминирует в регионе',
  common: 'Обычная для региона',
  rare: 'Редкая для региона',
  singular: 'Единичная для региона',
  agate: 'Агат — редок везде',
  fossil: 'Окаменелость — редка везде',
  unknown_class: 'Порода не определена — база не начислена',
  no_geo: 'Без геопозиции — база не начислена',
  geo_anomaly: 'Не совпадает с геологией — база не начислена',
};

export const VERIFICATION_RU: Record<CardVerification, string> = {
  ai: 'Определено ИИ',
  community: 'Подтверждено сообществом',
  expert: 'Оценено экспертом',
  pending_review: 'На проверке',
};

/** Причина из breakdown, которой клиент ещё не знает (новая строка таблицы у воркера) — не показываем enum по-английски. */
const REASON_UNKNOWN_RU = 'Причина не указана';

export function rockClassRu(rockClass: string): string {
  return (ROCK_CLASS_RU as Record<string, string>)[rockClass] ?? 'Неопределённая порода';
}
export function rockGroupRu(rockClass: string): string {
  const group = (ROCK_CLASS_GROUP as Record<string, RockGroup>)[rockClass] ?? 'unknown';
  return ROCK_GROUP_RU[group];
}
export function mineralRu(mineral: string): string {
  return (MINERAL_RU as Record<string, string>)[mineral] ?? mineral;
}
export function surfaceRu(surface: string | null | undefined): string | null {
  return surface ? ((SURFACE_RU as Record<string, string>)[surface] ?? null) : null;
}

/** Подпись тира: null → «Без редкости»; pending_review → «?» (тир под вопросом до ревью). */
export function tierLabel(tier: Tier | null, verification: CardVerification = 'ai'): string {
  if (verification === 'pending_review') return '?';
  return tier ? TIER_RU[tier] : 'Без редкости';
}

/** Имя карточки для показа: пользовательское → автоген → порода. */
export function displayName(card: Pick<CardRow, 'user_name' | 'name' | 'rock_class'>): string {
  return card.user_name?.trim() || card.name?.trim() || rockClassRu(card.rock_class);
}

// ---------------------------------------------------------------------------
// Три главных факта (spec §4.3): порода/группа, главное включение или форма, соответствие месту.
// ---------------------------------------------------------------------------

export interface Fact {
  label: string;
  value: string;
}

export function topInclusion(breakdown: ScoreBreakdown | null): ScoreBreakdown['composition']['inclusions'][number] | null {
  const list = breakdown?.composition.inclusions ?? [];
  let best: (typeof list)[number] | null = null;
  for (const i of list) if (best === null || i.points > best.points) best = i;
  return best;
}

export function placeFact(breakdown: ScoreBreakdown | null): string {
  if (!breakdown) return PLACE_REASON_RU.no_geo;
  const { reason, mechanism } = breakdown.place;
  if (reason === 'wanderer') {
    const how = mechanism ? WANDERER_MECHANISM_RU[mechanism] : null;
    return how ? `Странник: ${how.toLowerCase()}` : 'Странник';
  }
  return PLACE_REASON_RU[reason] ?? REASON_UNKNOWN_RU;
}

export function cardFacts(card: Pick<CardRow, 'rock_class' | 'score_breakdown'>): [Fact, Fact, Fact] {
  const b = card.score_breakdown;
  const rock: Fact = { label: 'Порода', value: `${rockClassRu(card.rock_class)} · ${rockGroupRu(card.rock_class)}` };
  const top = topInclusion(b);
  const second: Fact = top
    ? { label: 'Включение', value: `${mineralRu(top.mineral)} — ${EXTENT_RU[top.extent] ?? top.extent}` }
    : { label: 'Форма', value: b ? SHAPE_REASON_RU[b.shape.reason] ?? SHAPE_REASON_RU.plain : SHAPE_REASON_RU.plain };
  const place: Fact = { label: 'Место', value: placeFact(b) };
  return [rock, second, place];
}

// ---------------------------------------------------------------------------
// Расшифровка score по четырём слоям (карточка, по тапу).
// ---------------------------------------------------------------------------

export interface LayerLine {
  text: string;
  points?: number;
}
export interface LayerView {
  key: 'shape' | 'place' | 'composition' | 'quality';
  title: string;
  points: number;
  max: number;
  lines: LayerLine[];
}

export function describeBreakdown(b: ScoreBreakdown): LayerView[] {
  const comp: LayerLine[] = [{ text: BASE_REASON_RU[b.composition.base.reason] ?? REASON_UNKNOWN_RU, points: b.composition.base.points }];
  for (const i of b.composition.inclusions) {
    const mult = i.multiplier !== 1 ? ` ×${i.multiplier}` : '';
    comp.push({ text: `${mineralRu(i.mineral)} — ${EXTENT_RU[i.extent] ?? i.extent}${mult}`, points: i.points });
  }
  if (b.composition.inclusions.length === 0) comp.push({ text: 'Засчитанных включений нет' });
  if (b.composition.capped) comp.push({ text: `Потолок слоя (было ${b.composition.raw})` });

  const quality: LayerLine[] = [
    { text: b.quality.fresh_split ? 'Свежий скол — интерьер виден' : 'Скола нет' },
    { text: b.quality.scale_photo ? 'Есть фото с масштабом' : 'Фото с масштабом нет' },
    { text: b.quality.user_tests ? 'Мини-тесты пройдены (вес, царапина)' : 'Мини-тесты не пройдены' },
  ];

  return [
    { key: 'shape', title: 'Форма', points: b.shape.points, max: SHAPE_LAYER_MAX, lines: [{ text: SHAPE_REASON_RU[b.shape.reason] ?? REASON_UNKNOWN_RU }] },
    { key: 'place', title: 'Место', points: b.place.points, max: PLACE_LAYER_MAX, lines: [{ text: placeFact(b) }] },
    { key: 'composition', title: 'Состав', points: b.composition.points, max: COMPOSITION_LAYER_MAX, lines: comp },
    { key: 'quality', title: 'Раскрытие и качество', points: b.quality.points, max: QUALITY_LAYER_MAX, lines: quality },
  ];
}

/** Состав для карточки (spec §5): включения с extent по-русски, без процентов. */
export function inclusionLines(inclusions: Inclusion[]): string[] {
  return inclusions.map((i) => `${mineralRu(i.mineral as Mineral)} — ${EXTENT_RU[i.extent] ?? i.extent}`);
}

// ---------------------------------------------------------------------------
// Дельта score после раскола (spec §7, dev-plan T2.3: «дельта показана»).
// ---------------------------------------------------------------------------

export interface ScoreDelta {
  text: string;
  sign: 'up' | 'down' | 'same';
}

/** Дельта раскола: сначала breakdown.split_delta (T2.1), иначе — по score родительской карточки. */
export function splitDelta(card: Pick<CardRow, 'score' | 'split_delta'>, parentScore: number | null | undefined): ScoreDelta | null {
  if (card.split_delta !== null && card.score !== null) return formatScoreDelta(card.score - card.split_delta, card.score);
  return parentScore === undefined ? null : formatScoreDelta(parentScore, card.score);
}

export function formatScoreDelta(parentScore: number | null, childScore: number | null): ScoreDelta | null {
  if (parentScore === null || childScore === null) return null;
  const diff = childScore - parentScore;
  const sign: ScoreDelta['sign'] = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const tail = diff === 0 ? 'без изменений' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`;
  return { text: `было ${parentScore} → стало ${childScore} (${tail})`, sign };
}

// ---------------------------------------------------------------------------
// Место и дата
// ---------------------------------------------------------------------------

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «7 сен 2026» без Intl (Hermes на части устройств без локалей). Невалидная дата → null. */
export function formatDateRu(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatCoords(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export function shapeSummary(shape: Record<string, unknown>): { surface: string | null; naturalHole: boolean } {
  return { surface: surfaceRu(typeof shape.surface === 'string' ? (shape.surface as Surface) : null), naturalHole: shape.natural_hole === true };
}

export type { RockClass };

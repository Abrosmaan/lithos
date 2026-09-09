// Экран «Раскол: до и после» (дизайн T5.2, spec §7): заголовок, дельта score и список «Что изменилось в разборе»
// из разницы score_breakdown родителя и ребёнка. Чистый модуль, балансовых чисел нет — только разность
// посчитанных воркером очков; потолок слоя раскрытия — из shared.
import { QUALITY_LAYER_MAX, type ScoreBreakdown } from '@lithos/shared';
import { describeBreakdown, formatScoreDelta, mineralRu, placeFact, rockClassRu, type ScoreDelta, topInclusion } from './card-facts';
import type { CardRow } from './card-types';

export type CompareSign = ScoreDelta['sign'];

export interface CompareChange {
  /** «+30», «−14», «0» — mono в списке. */
  pts: string;
  sign: CompareSign;
  label: string;
  why: string;
}

export interface CompareView {
  /** «Внутри оказался агат» / «Внутри тот же базальт». */
  headline: string;
  sign: CompareSign;
  /** null — у одной из карточек нет score (без гео). */
  delta: ScoreDelta | null;
  deltaNote: string;
  changes: CompareChange[];
  rockChanged: boolean;
}

export type CompareCard = Pick<CardRow, 'rock_class' | 'score' | 'score_breakdown'>;

// Род существительного по окончанию — для «оказался / оказалась / оказалось» и «тот же / та же / то же».
type Gender = 'm' | 'f' | 'n';
export function nounGenderRu(name: string): Gender {
  const w = name.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (w.endsWith('ость') || w.endsWith('а') || w.endsWith('я')) return 'f';
  if (w.endsWith('о') || w.endsWith('е')) return 'n';
  return 'm';
}
const TURNED_OUT: Record<Gender, string> = { m: 'оказался', f: 'оказалась', n: 'оказалось' };
const SAME: Record<Gender, string> = { m: 'тот же', f: 'та же', n: 'то же' };

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Очки в списке: целые без хвоста, дробные — до одного знака; минус типографский. */
export function formatPts(diff: number): string {
  if (diff === 0) return '0';
  const abs = Math.round(Math.abs(diff) * 10) / 10;
  return `${diff > 0 ? '+' : '−'}${abs}`;
}

const signOf = (diff: number): CompareSign => (diff > 0 ? 'up' : diff < 0 ? 'down' : 'same');
const change = (diff: number, label: string, why: string): CompareChange => ({ pts: formatPts(diff), sign: signOf(diff), label, why });

/** Список изменений по слоям: ненулевые по убыванию модуля, состав — всегда (ради него и кололи). */
export function compareChanges(parent: ScoreBreakdown | null, child: ScoreBreakdown | null, parentRock: string, childRock: string): CompareChange[] {
  if (!parent || !child) return [];
  const out: CompareChange[] = [];
  const rockChanged = parentRock !== childRock;
  const childLayers = describeBreakdown(child);
  const line = (key: 'shape' | 'composition') => childLayers.find((l) => l.key === key)?.lines[0]?.text ?? '';

  // Форма
  const shape = child.shape.points - parent.shape.points;
  if (shape < 0) out.push(change(shape, 'Форма: силуэт потерян', 'узнаваемая форма разрушена расколом'));
  else if (shape > 0) out.push(change(shape, `Форма: ${lowerFirst(line('shape'))}`, 'форма распознана на новом снимке'));

  // Место
  const place = child.place.points - parent.place.points;
  if (place !== 0) out.push(change(place, `Место: ${lowerFirst(placeFact(child))}`, 'место пересчитано по новому вердикту'));

  // Состав: база породы и включения — отдельными строками, как в прототипе.
  const base = child.composition.base.points - parent.composition.base.points;
  const sumInc = (b: ScoreBreakdown) => b.composition.inclusions.reduce((s, i) => s + i.points, 0);
  const inc = sumInc(child) - sumInc(parent);
  if (base !== 0 || rockChanged) {
    out.push(change(base, `Состав: ${lowerFirst(rockClassRu(childRock))}`, rockChanged ? `раньше — ${lowerFirst(rockClassRu(parentRock))}` : lowerFirst(line('composition'))));
  }
  if (inc !== 0) {
    const top = topInclusion(child);
    out.push(inc > 0
      ? change(inc, `Состав: ${top ? lowerFirst(mineralRu(top.mineral)) : 'включения'}`, 'включение подтверждено на сколе')
      : change(inc, 'Состав: включения', 'включение не подтвердилось на сколе'));
  }
  if (base === 0 && inc === 0 && !rockChanged) {
    out.push(change(0, 'Состав без изменений', child.composition.inclusions.length === 0 ? 'включений на сколе не найдено' : 'те же включения, что и снаружи'));
  }

  // Раскрытие и качество
  const quality = child.quality.points - parent.quality.points;
  if (quality > 0 && child.quality.fresh_split) {
    out.push(change(quality, 'Раскрытие: свежий скол', child.quality.points >= QUALITY_LAYER_MAX ? 'слой раскрытия закрыт полностью' : 'слой раскрытия частично закрыт'));
  } else if (quality !== 0) {
    out.push(change(quality, 'Раскрытие и качество', quality > 0 ? 'слой раскрытия пересчитан' : 'скол не распознан как свежий'));
  }

  return out.sort((a, b) => (a.sign === 'same' ? 1 : 0) - (b.sign === 'same' ? 1 : 0) || Math.abs(ptsValue(b)) - Math.abs(ptsValue(a)));
}

function ptsValue(c: CompareChange): number {
  return Number(c.pts.replace('−', '-')) || 0;
}

/** Пояснение под дельтой: что скол показал или не показал. */
export function compareDeltaNote(sign: CompareSign, rockChanged: boolean, changes: CompareChange[]): string {
  const shapeLost = changes.some((c) => c.label.startsWith('Форма') && c.sign === 'down');
  const incUp = changes.some((c) => c.label.startsWith('Состав') && c.sign === 'up');
  if (sign === 'up') {
    return rockChanged
      ? 'Внутри другая порода: модель увидела на свежем сколе то, чего снаружи не было.'
      : 'На свежем сколе модель увидела то, чего снаружи не было.';
  }
  if (sign === 'down') {
    const parts: string[] = [];
    if (!incUp) parts.push('Скол не показал включений');
    if (shapeLost) parts.push('форма перестала быть цельной: слой «Форма» обнулился');
    return parts.length > 0 ? `${parts.join(', а ')}.` : 'Скол не добавил очков — часть слоёв пересчиталась вниз.';
  }
  return 'Скол ничего не изменил: порода и включения те же.';
}

export function compareCards(parent: CompareCard, child: CompareCard): CompareView {
  const childName = rockClassRu(child.rock_class);
  const rockChanged = parent.rock_class !== child.rock_class;
  const g = nounGenderRu(childName);
  const headline = rockChanged ? `Внутри ${TURNED_OUT[g]} ${lowerFirst(childName)}` : `Внутри ${SAME[g]} ${lowerFirst(childName)}`;
  const delta = formatScoreDelta(parent.score, child.score);
  const sign: CompareSign = delta?.sign ?? 'same';
  const changes = compareChanges(parent.score_breakdown, child.score_breakdown, parent.rock_class, child.rock_class);
  return { headline, sign, delta, deltaNote: compareDeltaNote(sign, rockChanged, changes), changes, rockChanged };
}

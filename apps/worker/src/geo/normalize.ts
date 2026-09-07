// Нормализация сырого ответа Macrostrat → {expected_rocks, age_range, setting, wanderers} (T1.2).
// Чистая функция, без сети и БД — тестируется на фикстурах. Эвристики описаны в docs/tasks/T1.2.md.
import { WANDERER_MECHANISMS } from '@lithos/shared';
import type { ExpectedRock, GeoContext, RockClass, WandererMechanism } from '@lithos/shared';
import {
  GLACIAL_LITHS, RIVER_LITHS, isGeneric, isVolcanic, lithById, lithByName, toRockClass, type LithDef,
} from './lith-map.js';
import type { MacrostratRaw, MacrostratUnit, Probe } from './macrostrat.js';

export type Normalized = Pick<GeoContext, 'expected_rocks' | 'age_range' | 'setting' | 'wanderers'>;

/** Широта, начиная с которой ледниковые эрратики считаются правдоподобным механизмом (dev-plan T1.2). */
export const GLACIAL_LATITUDE = 45;
/** Доля вулканических литологий, при которой местность считается вулканической. */
export const VOLCANIC_SHARE = 0.5;
/** Вес центральной точки в долях пород; остальное поровну между сухопутными пробами (радиус «водосбора» = PROBE_KM). */
export const CENTER_WEIGHT = 0.5;
/** Доля «Major» литологий юнита, когда есть и «Minor». */
const MAJOR_WEIGHT = 0.7;

const WATER_NAME_RE = /\b(sea|ocean|lake)\b/i;
// Только по name / strat_name / lith: descrip слишком шумный (marine terrace, «drift» не ледниковый и т.п.).
const RIVER_TEXT_RE = /\b(alluvi\w*|fluvial|floodplain|flood plain)\b/i;
const GLACIAL_TEXT_RE = /\b(glaci\w*|till|tillite|moraine|morainic|outwash|diamict\w*)\b/i;

interface WeightedLith { def: LithDef; weight: number }
interface UnitWithLiths { u: MacrostratUnit; liths: WeightedLith[]; specific: boolean }

function isWaterUnit(u: MacrostratUnit): boolean {
  const empty = !(u.liths && u.liths.length) && !(u.lith && u.lith.trim()) && !(u.name && u.name.trim());
  return empty || WATER_NAME_RE.test(u.name ?? '');
}

export function isWater(units: MacrostratUnit[] | null | undefined): boolean {
  return !units || units.length === 0 || units.every(isWaterUnit);
}

function parseMajorMinor(lith: string): { major: LithDef[]; minor: LithDef[] } | null {
  const re = /\b(major|minor)\s*:?\s*\{([^}]*)\}/gi;
  const out = { major: [] as LithDef[], minor: [] as LithDef[] };
  let found = false;
  for (const m of lith.matchAll(re)) {
    found = true;
    const bucket = m[1]!.toLowerCase() === 'major' ? out.major : out.minor;
    for (const tok of m[2]!.split(',')) {
      const d = lithByName(tok);
      if (d) bucket.push(d);
    }
  }
  return found ? out : null;
}

function uniqueById(defs: LithDef[]): LithDef[] {
  const seen = new Set<number>();
  const out: LithDef[] = [];
  for (const d of defs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** Литологии юнита с весами (сумма = 1). Источник — id из `liths`, при их отсутствии — строка `lith`. */
export function unitLiths(u: MacrostratUnit): WeightedLith[] {
  const lithStr = (u.lith ?? '').trim();
  const mm = lithStr ? parseMajorMinor(lithStr) : null;
  let defs = uniqueById((u.liths ?? []).map(lithById).filter((d): d is LithDef => !!d));
  if (defs.length === 0 && lithStr) {
    const tokens = mm
      ? [...mm.major, ...mm.minor]
      : lithStr.split(/[,;:]|\band\b/).map(lithByName).filter((d): d is LithDef => !!d);
    defs = uniqueById(tokens);
  }
  if (defs.length === 0) return [];

  if (mm && mm.major.length) {
    const majorIds = new Set(mm.major.map((d) => d.id));
    const majors = defs.filter((d) => majorIds.has(d.id));
    const minors = defs.filter((d) => !majorIds.has(d.id));
    if (majors.length && minors.length) {
      return [
        ...majors.map((def) => ({ def, weight: MAJOR_WEIGHT / majors.length })),
        ...minors.map((def) => ({ def, weight: (1 - MAJOR_WEIGHT) / minors.length })),
      ];
    }
  }
  return defs.map((def) => ({ def, weight: 1 / defs.length }));
}

function unitText(u: MacrostratUnit): string {
  return [u.name, u.strat_name, u.lith].filter(Boolean).join(' | ');
}

/** Юниты группы с литологиями; generic-only юниты («sedimentary rocks») отброшены, если есть конкретные. */
function usableUnits(units: MacrostratUnit[]): UnitWithLiths[] {
  const all = units
    .filter((u) => !isWaterUnit(u))
    .map((u) => {
      let liths = unitLiths(u);
      const specific = liths.some((w) => !isGeneric(w.def));
      if (specific) {
        // Внутри конкретного юнита generic-литологии (gypsum, «sedimentary») не дают породу — отбрасываем.
        liths = liths.filter((w) => !isGeneric(w.def));
        const sum = liths.reduce((s, w) => s + w.weight, 0);
        liths = liths.map((w) => ({ ...w, weight: w.weight / sum }));
      }
      return { u, liths, specific };
    })
    .filter((x) => x.liths.length > 0);
  const specific = all.filter((x) => x.specific);
  return specific.length ? specific : all;
}

function ageRange(units: MacrostratUnit[]): string | null {
  const withAge = units.filter((u) => typeof u.b_age === 'number' && typeof u.t_age === 'number');
  if (withAge.length === 0) return null;
  const oldest = withAge.reduce((a, b) => (b.b_age! > a.b_age! ? b : a));
  const youngest = withAge.reduce((a, b) => (b.t_age! < a.t_age! ? b : a));
  const b = oldest.b_int_name?.trim();
  const t = youngest.t_int_name?.trim();
  if (b && t) return b === t ? b : `${b}–${t}`;
  return `${oldest.b_age}–${youngest.t_age} Ma`;
}

/** Море: высота < 0, либо 0 при центре на суше. Озеро: юниты пустые/«lake», но высота > 0.
 *  Проба без данных (нет юнитов и высоты) — не вода: пустая карта не должна давать coast/lake. */
function probeWater(p: Probe, centerHasUnits: boolean): { sea: boolean; lake: boolean } {
  const byUnits = p.units != null && p.units.length > 0 && isWater(p.units);
  const sea = p.elevation != null && (p.elevation < 0 || (p.elevation === 0 && centerHasUnits));
  return { sea, lake: !sea && byUnits && p.elevation != null && p.elevation > 0 };
}

/** null — у центра нет ни одного юнита: Macrostrat не покрывает точку (не вода, а отсутствие данных). */
export function normalize(raw: MacrostratRaw): Normalized | null {
  if (raw.center.length === 0) return null;
  const centerIsWater = isWater(raw.center);
  const water = raw.probes.map((p) => probeWater(p, true));
  const landProbes = raw.probes.filter((p, i) => p.units != null && !water[i]!.sea && !water[i]!.lake);

  // Группы юнитов с весами: центр CENTER_WEIGHT, сухопутные пробы делят остаток. Без центра — только пробы.
  let groups = [
    { weight: CENTER_WEIGHT, units: usableUnits(raw.center) },
    ...landProbes.map((p) => ({ weight: 0, units: usableUnits(p.units!) })),
  ];
  const nProbes = groups.length - 1;
  for (let i = 1; i < groups.length; i++) groups[i]!.weight = (1 - CENTER_WEIGHT) / nProbes;
  groups = groups.filter((g) => g.units.length > 0);
  if (groups.some((g) => g.units.some((x) => x.specific))) {
    groups = groups.filter((g) => g.units.some((x) => x.specific));
  }
  const totalWeight = groups.reduce((s, g) => s + g.weight, 0);

  // Флаги местности — по всем сухопутным юнитам (центр + пробы), включая generic.
  const flagUnits = [raw.center, ...landProbes.map((p) => p.units!)].flat().filter((u) => !isWaterUnit(u));
  let river = false;
  let glacialLith = false;
  for (const u of flagUnits) {
    const names = unitLiths(u).map((w) => w.def.name);
    if (names.some((n) => RIVER_LITHS.has(n)) || RIVER_TEXT_RE.test(unitText(u))) river = true;
    if (names.some((n) => GLACIAL_LITHS.has(n)) || GLACIAL_TEXT_RE.test(unitText(u))) glacialLith = true;
  }

  const shares = new Map<RockClass, number>();
  let volcanic = 0;
  for (const g of groups) {
    const gw = g.weight / totalWeight;
    for (const { liths } of g.units) {
      for (const { def, weight } of liths) {
        const w = (gw * weight) / g.units.length;
        const cls = toRockClass(def);
        shares.set(cls, (shares.get(cls) ?? 0) + w);
        if (isVolcanic(def)) volcanic += w;
      }
    }
  }
  const expected_rocks: ExpectedRock[] = [...shares.entries()]
    .map(([rock_class, share]) => ({ rock_class, share: Math.round(share * 1000) / 1000 }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share || a.rock_class.localeCompare(b.rock_class));

  const coast = water.some((w) => w.sea);
  const lake = !coast && (centerIsWater || water.some((w) => w.lake));
  const highLat = Math.abs(raw.lat) > GLACIAL_LATITUDE;
  const isVolcanicArea = groups.length > 0 && volcanic >= VOLCANIC_SHARE;

  let setting: string;
  if (coast) setting = 'coast';
  else if (lake) setting = 'lake';
  else if (river) setting = 'river';
  else if (glacialLith) setting = 'glacial';
  else if (isVolcanicArea) setting = 'volcanic';
  else if (highLat) setting = 'glacial';
  else setting = 'inland';

  const ageUnits = groups.flatMap((g) => g.units.map((x) => x.u));

  return {
    expected_rocks,
    age_range: ageRange(ageUnits),
    setting,
    wanderers: wanderersFor({ coast, river, glacial: glacialLith || highLat }),
  };
}

/** Таблица «странников» по типу местности (spec §6.2, dev-plan T1.2). human_imported намеренно не выдаётся
 *  по умолчанию: иначе любое несовпадение «объясняется» и обходит антифрод (spec §11); остаётся в enum. */
export function wanderersFor(flags: { coast: boolean; river: boolean; glacial: boolean }): WandererMechanism[] {
  const set = new Set<WandererMechanism>();
  if (flags.coast) set.add('drift_pumice');
  if (flags.glacial) set.add('glacial_erratic');
  if (flags.river) set.add('river_transport');
  return WANDERER_MECHANISMS.filter((m) => set.has(m));
}

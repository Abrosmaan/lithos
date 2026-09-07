// Маппинг литологий Macrostrat (defs/lithologies) → RockClass из @lithos/shared (T1.2).
// Справочник Macrostrat: macrostrat-liths.json (id, name, type, group, class) — снимок /defs/lithologies?all.
// Правило: точное имя → таблица ниже; неизвестное имя → unknown_{igneous|sedimentary|metamorphic} по class.
// Если точное имя есть в RockClass — используем его (spec: породы по справочнику enum); иначе ближайший класс
// (carbonate → limestone, dolerite → diabase, basanite → basalt). Обоснования — docs/tasks/T1.2.md.
import type { RockClass } from '@lithos/shared';
import lithDefs from './macrostrat-liths.json' with { type: 'json' };

export type LithClass = 'igneous' | 'sedimentary' | 'metamorphic';

export interface LithDef {
  id: number;
  name: string;
  type: string;
  group: string;
  class: LithClass;
}

export const LITH_DEFS: readonly LithDef[] = lithDefs as LithDef[];
const BY_ID = new Map<number, LithDef>(LITH_DEFS.map((d) => [d.id, d]));
const BY_NAME = new Map<string, LithDef>(LITH_DEFS.map((d) => [d.name, d]));

/** Имена Macrostrat, которые не говорят о конкретной породе — только о классе. Юниты, состоящие
 *  только из них, отбрасываются, если у точки есть более конкретные юниты. */
export const GENERIC_LITHS = new Set<string>([
  'siliciclastic', 'sedimentary', 'plutonic', 'volcanic', 'igneous', 'metamorphic', 'mafic',
  'metasedimentary', 'metaigneous', 'metavolcanic', 'regolith', 'evaporite', 'chemical', 'organic',
  'mixed carbonate-siliciclastic', 'soil', 'paleosol', 'eluvium', 'colluvium', 'alluvium', 'drift',
  'till', 'diamicton', 'tillite', 'diamictite', 'felsite', 'mafite',
  // не породы для коллекции: эвапориты, торф, битум, илы
  'evaporite', 'halite', 'gypsum', 'anhydrite', 'trona', 'peat', 'tar', 'gyttja', 'bauxite', 'phosphorite', 'diatomite',
]);

/** Литологии, означающие ледниковые отложения (setting=glacial, странник glacial_erratic). */
export const GLACIAL_LITHS = new Set<string>(['till', 'tillite', 'diamicton', 'diamictite', 'drift']);
/** Литологии речных/пойменных отложений (setting=river, странник river_transport). */
export const RIVER_LITHS = new Set<string>(['alluvium']);

export const LITH_TO_ROCK: Readonly<Record<string, RockClass>> = {
  // --- unconsolidated / regolith: приближение к литифицированному аналогу
  gravel: 'conglomerate', sand: 'sandstone', silt: 'siltstone', mud: 'mudstone', clay: 'claystone',
  loess: 'siltstone', alluvium: 'unknown_sedimentary', colluvium: 'unknown_sedimentary',
  till: 'unknown_sedimentary', tillite: 'unknown_sedimentary', diamicton: 'unknown_sedimentary',
  diamictite: 'unknown_sedimentary', drift: 'unknown_sedimentary',
  // --- siliciclastic
  claystone: 'claystone', mudstone: 'mudstone', shale: 'shale', siltstone: 'siltstone', sandstone: 'sandstone',
  arkose: 'sandstone', greywacke: 'greywacke', graywacke: 'greywacke', wacke: 'greywacke', arenite: 'sandstone',
  'quartz arenite': 'sandstone', subarkose: 'sandstone', litharenite: 'sandstone', sublitharenite: 'sandstone',
  greensand: 'sandstone', grit: 'sandstone', conglomerate: 'conglomerate', breccia: 'breccia',
  argillite: 'mudstone', pelite: 'mudstone', volcaniclastic: 'tuff',
  // --- carbonate
  carbonate: 'limestone', 'mixed carbonate-siliciclastic': 'unknown_sedimentary', marl: 'marl',
  'lime mudstone': 'limestone', wackestone: 'limestone', packstone: 'limestone', grainstone: 'limestone',
  boundstone: 'limestone', floatstone: 'limestone', rudstone: 'limestone', bafflestone: 'limestone',
  bindstone: 'limestone', framestone: 'limestone', limestone: 'limestone', dolomite: 'dolomite',
  dolostone: 'dolomite', siderite: 'ironstone', ankerite: 'dolomite', chalk: 'chalk', micrite: 'limestone',
  biomicrite: 'fossiliferous_limestone', oomicrite: 'limestone', biosparite: 'fossiliferous_limestone',
  pelmicrite: 'limestone', oosparite: 'limestone', pelsparite: 'limestone', intrasparite: 'limestone',
  intramicrite: 'limestone', coquina: 'coquina', oolite: 'limestone', travertine: 'travertine',
  encrinite: 'fossiliferous_limestone', calcarenite: 'limestone', calcilutite: 'limestone',
  calcisiltite: 'limestone', tufa: 'travertine', 'calcareous ooze': 'chalk',
  // --- evaporite / organic / chemical
  evaporite: 'unknown_sedimentary', halite: 'unknown_sedimentary', gypsum: 'unknown_sedimentary',
  anhydrite: 'unknown_sedimentary', trona: 'unknown_sedimentary',
  coal: 'coal', peat: 'unknown_sedimentary', lignite: 'coal', anthracite: 'coal', tar: 'unknown_sedimentary',
  gyttja: 'unknown_sedimentary',
  chert: 'chert', flint: 'flint', novaculite: 'chert', radiolarite: 'chert', porcellanite: 'chert',
  diatomite: 'unknown_sedimentary', 'siliceous ooze': 'chert', phosphorite: 'unknown_sedimentary',
  ironstone: 'ironstone', 'iron formation': 'ironstone', bauxite: 'unknown_sedimentary', laterite: 'ironstone',
  // --- plutonic
  granite: 'granite', monzogranite: 'granite', syenogranite: 'granite', leucogranite: 'granite',
  alaskite: 'granite', aplite: 'granite', granophyre: 'granite', 'quartz monzonite': 'granite',
  monzonite: 'syenite', syenite: 'syenite', granodiorite: 'granodiorite', tonalite: 'granodiorite',
  trondhjemite: 'granodiorite', diorite: 'diorite', charnockite: 'granite', gabbro: 'gabbro', norite: 'gabbro',
  troctolite: 'gabbro', anorthosite: 'gabbro', diabase: 'diabase', dolerite: 'diabase', lamprophyre: 'diabase',
  peridotite: 'peridotite', pyroxenite: 'peridotite', kimberlite: 'peridotite', komatiite: 'peridotite',
  dunite: 'peridotite', lherzolite: 'peridotite', harzburgite: 'peridotite', wehrlite: 'peridotite',
  websterite: 'peridotite', orthopyroxenite: 'peridotite', clinopyroxenite: 'peridotite',
  hornblendite: 'peridotite', picrite: 'peridotite', foidolite: 'unknown_igneous', pegmatite: 'pegmatite',
  // --- volcanic
  rhyolite: 'rhyolite', rhyodacite: 'dacite', dacite: 'dacite', adakite: 'dacite', comendite: 'rhyolite',
  trachyte: 'trachyte', phonolite: 'trachyte', latite: 'andesite', andesite: 'andesite',
  trachyandesite: 'andesite', benmoreite: 'andesite', mugearite: 'andesite', hawaiite: 'basalt',
  basalt: 'basalt', basanite: 'basalt', tephrite: 'basalt', ankaramite: 'basalt', spilite: 'basalt',
  foidite: 'basalt', 'volcanic glass': 'obsidian', obsidian: 'obsidian', ash: 'tuff', tuff: 'tuff',
  'welded tuff': 'ignimbrite', ignimbrite: 'ignimbrite', tephra: 'tuff', tuffite: 'tuff', bentonite: 'tuff',
  hyaloclastite: 'volcanic_breccia', agglomerate: 'volcanic_breccia', scoria: 'scoria', pumice: 'pumice',
  carbonatite: 'unknown_igneous',
  // --- metamorphic
  gneiss: 'gneiss', orthogneiss: 'gneiss', paragneiss: 'gneiss', migmatite: 'migmatite', diatexite: 'migmatite',
  granulite: 'gneiss', granofel: 'hornfels', mylonite: 'mylonite', phyllonite: 'mylonite', slate: 'slate',
  phyllite: 'phyllite', schist: 'schist', greenschist: 'schist', blueschist: 'schist', metapelite: 'schist',
  quartzite: 'quartzite', amphibolite: 'amphibolite', greenstone: 'greenstone', metabasalt: 'greenstone',
  metagabbro: 'amphibolite', metabasite: 'amphibolite', serpentinite: 'serpentinite', hornfels: 'hornfels',
  skarn: 'hornfels', marble: 'marble', eclogite: 'eclogite', metaconglomerate: 'quartzite',
  metagraywacke: 'greywacke', metasiltstone: 'slate', metarhyolite: 'unknown_metamorphic',
  cataclasite: 'mylonite', 'fault gouge': 'unknown_metamorphic', 'fault breccia': 'breccia',
  pseudotachylite: 'mylonite',
};

const UNKNOWN_BY_CLASS: Record<LithClass, RockClass> = {
  igneous: 'unknown_igneous',
  sedimentary: 'unknown_sedimentary',
  metamorphic: 'unknown_metamorphic',
};

export function lithById(id: number): LithDef | undefined {
  return BY_ID.get(id);
}

/** Нормализует произвольный токен из строки `lith` («tuff group», «carbonates», «tholeiitic basalt») к записи справочника. */
export function lithByName(raw: string): LithDef | undefined {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\b(group|rocks?)\b/g, '').trim();
  if (!s) return undefined;
  const candidates = [s, s.replace(/s$/, ''), s.replace(/e?s$/, '')];
  for (const c of candidates) {
    const d = BY_NAME.get(c);
    if (d) return d;
  }
  // «olivine basalt», «pillow basalt», «tholeiitic basalt» → по последнему слову
  const last = s.split(' ').pop();
  if (last && last !== s) {
    const d = BY_NAME.get(last) ?? BY_NAME.get(last.replace(/s$/, ''));
    if (d) return d;
  }
  if (/tholeiit/.test(s)) return BY_NAME.get('basalt');
  return undefined;
}

export function toRockClass(def: LithDef): RockClass {
  return LITH_TO_ROCK[def.name] ?? UNKNOWN_BY_CLASS[def.class] ?? 'unknown';
}

export function isGeneric(def: LithDef): boolean {
  return GENERIC_LITHS.has(def.name);
}

export function isVolcanic(def: LithDef): boolean {
  return def.type === 'volcanic';
}

// Закрытые словари (ai-pipeline §5). Источник истины для клиента, воркера и промптов.
// T1.1: списки сверены с петрографической номенклатурой (mindat / IUGS), правки — в docs/tasks/T1.1.md.
// ИМЕНА ЭКСПОРТОВ СТАБИЛЬНЫ: их импортируют T1.2/T1.3/T1.4 параллельно. Значения только дополняются.

export const ROCK_CLASSES = [
  // igneous — volcanic
  'basalt', 'amygdaloidal_basalt', 'vesicular_basalt', 'andesite', 'dacite', 'rhyolite', 'trachyte',
  'obsidian', 'pumice', 'scoria', 'tuff', 'ignimbrite', 'volcanic_breccia',
  // igneous — plutonic / hypabyssal
  'granite', 'granodiorite', 'diorite', 'syenite', 'gabbro', 'diabase', 'peridotite', 'pegmatite',
  // sedimentary — clastic
  'sandstone', 'greywacke', 'siltstone', 'mudstone', 'shale', 'claystone', 'marl', 'conglomerate', 'breccia',
  // sedimentary — carbonate / chemical / organic
  'limestone', 'fossiliferous_limestone', 'coquina', 'dolomite', 'chalk', 'travertine',
  'chert', 'flint', 'ironstone', 'coal',
  // metamorphic
  'slate', 'phyllite', 'schist', 'gneiss', 'migmatite', 'quartzite', 'marble', 'amphibolite',
  'serpentinite', 'greenstone', 'hornfels', 'eclogite', 'mylonite', 'soapstone',
  // siliceous / ornamental / special finds
  'jasper', 'agate', 'chalcedony', 'quartz_vein', 'petrified_wood', 'fossil', 'concretion', 'geode',
  // catch-all
  'unknown_igneous', 'unknown_sedimentary', 'unknown_metamorphic', 'unknown',
] as const;
export type RockClass = (typeof ROCK_CLASSES)[number];

export const MINERALS = [
  // silica group
  'quartz', 'quartz_druse', 'amethyst', 'chalcedony', 'opal',
  // rock-forming silicates
  'feldspar', 'plagioclase', 'orthoclase', 'mica', 'muscovite', 'biotite',
  'chlorite', 'epidote', 'olivine', 'pyroxene', 'augite', 'hornblende', 'amphibole',
  'garnet', 'tourmaline', 'kyanite', 'zeolite', 'prehnite',
  // carbonates / sulphates / halides
  'calcite', 'aragonite', 'dolomite', 'gypsum', 'halite', 'fluorite', 'barite',
  // sulphides / oxides / hydroxides
  'pyrite', 'marcasite', 'chalcopyrite', 'magnetite', 'hematite', 'limonite', 'goethite',
  // secondary copper
  'malachite', 'azurite',
  // sheet / alteration
  'serpentine', 'talc', 'kaolinite', 'glauconite',
  // native elements and non-mineral "inclusions"
  'native_copper', 'fossil_fragment',
] as const;
export type Mineral = (typeof MINERALS)[number];

export const SHAPE_TAGS = [
  'rounded', 'spheroid', 'egg', 'flat', 'disc', 'elongated', 'angular', 'asymmetric',
  'natural_hole', 'heart', 'crescent', 'banded',
] as const;
export type ShapeTag = (typeof SHAPE_TAGS)[number];

export const EXTENTS = ['traces', 'noticeable', 'dominant'] as const;
export type Extent = (typeof EXTENTS)[number];

export const SURFACES = ['weathered', 'fresh_split', 'polished', 'coated'] as const;
export type Surface = (typeof SURFACES)[number];

export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

export const WANDERER_MECHANISMS = ['drift_pumice', 'glacial_erratic', 'river_transport', 'human_imported'] as const;
export type WandererMechanism = (typeof WANDERER_MECHANISMS)[number];

export const GATE_QUALITIES = ['ok', 'blurry', 'dark', 'too_far', 'screen_photo'] as const;
export type GateQuality = (typeof GATE_QUALITIES)[number];

// ---------------------------------------------------------------------------
// Группы пород. Нужны score (сопоставление unknown_* с литологией) и клиенту (фильтры коллекции).
// ---------------------------------------------------------------------------
export const ROCK_GROUPS = ['igneous', 'sedimentary', 'metamorphic', 'other', 'unknown'] as const;
export type RockGroup = (typeof ROCK_GROUPS)[number];

export const ROCK_CLASS_GROUP: Record<RockClass, RockGroup> = {
  basalt: 'igneous', amygdaloidal_basalt: 'igneous', vesicular_basalt: 'igneous', andesite: 'igneous', dacite: 'igneous',
  rhyolite: 'igneous', trachyte: 'igneous', obsidian: 'igneous', pumice: 'igneous', scoria: 'igneous', tuff: 'igneous',
  ignimbrite: 'igneous', volcanic_breccia: 'igneous', granite: 'igneous', granodiorite: 'igneous', diorite: 'igneous',
  syenite: 'igneous', gabbro: 'igneous', diabase: 'igneous', peridotite: 'igneous', pegmatite: 'igneous',
  sandstone: 'sedimentary', greywacke: 'sedimentary', siltstone: 'sedimentary', mudstone: 'sedimentary', shale: 'sedimentary',
  claystone: 'sedimentary', marl: 'sedimentary', conglomerate: 'sedimentary', breccia: 'sedimentary', limestone: 'sedimentary',
  fossiliferous_limestone: 'sedimentary', coquina: 'sedimentary', dolomite: 'sedimentary', chalk: 'sedimentary',
  travertine: 'sedimentary', chert: 'sedimentary', flint: 'sedimentary', ironstone: 'sedimentary', coal: 'sedimentary',
  slate: 'metamorphic', phyllite: 'metamorphic', schist: 'metamorphic', gneiss: 'metamorphic', migmatite: 'metamorphic',
  quartzite: 'metamorphic', marble: 'metamorphic', amphibolite: 'metamorphic', serpentinite: 'metamorphic',
  greenstone: 'metamorphic', hornfels: 'metamorphic', eclogite: 'metamorphic', mylonite: 'metamorphic', soapstone: 'metamorphic',
  jasper: 'other', agate: 'other', chalcedony: 'other', quartz_vein: 'other', petrified_wood: 'other', fossil: 'other',
  concretion: 'other', geode: 'other',
  unknown_igneous: 'igneous', unknown_sedimentary: 'sedimentary', unknown_metamorphic: 'metamorphic', unknown: 'unknown',
};

/** Разновидность → базовая литология, как её называет Macrostrat (amygdaloidal_basalt → basalt). */
export const ROCK_CLASS_BASE: Partial<Record<RockClass, RockClass>> = {
  amygdaloidal_basalt: 'basalt',
  vesicular_basalt: 'basalt',
  ignimbrite: 'tuff',
  fossiliferous_limestone: 'limestone',
  coquina: 'limestone',
  flint: 'chert',
  chert: 'limestone',       // кремнистые конкреции в карбонатных толщах; цепочка flint → chert → limestone
  greywacke: 'sandstone',
};

// ---------------------------------------------------------------------------
// Русские названия для интерфейса (spec: тексты интерфейса — русский, породы — по справочнику).
// ---------------------------------------------------------------------------
export const ROCK_CLASS_RU: Record<RockClass, string> = {
  basalt: 'Базальт',
  amygdaloidal_basalt: 'Миндалекаменный базальт',
  vesicular_basalt: 'Пузыристый базальт',
  andesite: 'Андезит',
  dacite: 'Дацит',
  rhyolite: 'Риолит',
  trachyte: 'Трахит',
  obsidian: 'Обсидиан',
  pumice: 'Пемза',
  scoria: 'Вулканический шлак',
  tuff: 'Туф',
  ignimbrite: 'Игнимбрит',
  volcanic_breccia: 'Вулканическая брекчия',
  granite: 'Гранит',
  granodiorite: 'Гранодиорит',
  diorite: 'Диорит',
  syenite: 'Сиенит',
  gabbro: 'Габбро',
  diabase: 'Диабаз',
  peridotite: 'Перидотит',
  pegmatite: 'Пегматит',
  sandstone: 'Песчаник',
  greywacke: 'Граувакка',
  siltstone: 'Алевролит',
  mudstone: 'Аргиллит',
  shale: 'Глинистый сланец',
  claystone: 'Глинистый камень',
  marl: 'Мергель',
  conglomerate: 'Конгломерат',
  breccia: 'Брекчия',
  limestone: 'Известняк',
  fossiliferous_limestone: 'Известняк с окаменелостями',
  coquina: 'Ракушечник',
  dolomite: 'Доломит',
  chalk: 'Мел',
  travertine: 'Травертин',
  chert: 'Кремнистая порода',
  flint: 'Кремень',
  ironstone: 'Железистая порода',
  coal: 'Уголь',
  slate: 'Кровельный сланец',
  phyllite: 'Филлит',
  schist: 'Кристаллический сланец',
  gneiss: 'Гнейс',
  migmatite: 'Мигматит',
  quartzite: 'Кварцит',
  marble: 'Мрамор',
  amphibolite: 'Амфиболит',
  serpentinite: 'Серпентинит',
  greenstone: 'Зеленокаменная порода',
  hornfels: 'Роговик',
  eclogite: 'Эклогит',
  mylonite: 'Милонит',
  soapstone: 'Мыльный камень',
  jasper: 'Яшма',
  agate: 'Агат',
  chalcedony: 'Халцедон',
  quartz_vein: 'Жильный кварц',
  petrified_wood: 'Окаменелое дерево',
  fossil: 'Окаменелость',
  concretion: 'Конкреция',
  geode: 'Жеода',
  unknown_igneous: 'Магматическая порода',
  unknown_sedimentary: 'Осадочная порода',
  unknown_metamorphic: 'Метаморфическая порода',
  unknown: 'Неопределённая порода',
};

export const MINERAL_RU: Record<Mineral, string> = {
  quartz: 'Кварц',
  quartz_druse: 'Кварцевая друза',
  amethyst: 'Аметист',
  chalcedony: 'Халцедон',
  opal: 'Опал',
  feldspar: 'Полевой шпат',
  plagioclase: 'Плагиоклаз',
  orthoclase: 'Ортоклаз',
  mica: 'Слюда',
  muscovite: 'Мусковит',
  biotite: 'Биотит',
  chlorite: 'Хлорит',
  epidote: 'Эпидот',
  olivine: 'Оливин',
  pyroxene: 'Пироксен',
  augite: 'Авгит',
  hornblende: 'Роговая обманка',
  amphibole: 'Амфибол',
  garnet: 'Гранат',
  tourmaline: 'Турмалин',
  kyanite: 'Кианит',
  zeolite: 'Цеолит',
  prehnite: 'Пренит',
  calcite: 'Кальцит',
  aragonite: 'Арагонит',
  dolomite: 'Доломит',
  gypsum: 'Гипс',
  halite: 'Галит',
  fluorite: 'Флюорит',
  barite: 'Барит',
  pyrite: 'Пирит',
  marcasite: 'Марказит',
  chalcopyrite: 'Халькопирит',
  magnetite: 'Магнетит',
  hematite: 'Гематит',
  limonite: 'Лимонит',
  goethite: 'Гётит',
  malachite: 'Малахит',
  azurite: 'Азурит',
  serpentine: 'Серпентин',
  talc: 'Тальк',
  kaolinite: 'Каолинит',
  glauconite: 'Глауконит',
  native_copper: 'Самородная медь',
  fossil_fragment: 'Фрагмент окаменелости',
};

export const SHAPE_TAG_RU: Record<ShapeTag, string> = {
  rounded: 'Окатанный',
  spheroid: 'Сфероид',
  egg: 'Яйцо',
  flat: 'Плоский',
  disc: 'Диск',
  elongated: 'Вытянутый',
  angular: 'Угловатый',
  asymmetric: 'Асимметричный',
  natural_hole: 'Сквозное отверстие',
  heart: 'Сердце',
  crescent: 'Полумесяц',
  banded: 'Полосчатый',
};

export const EXTENT_RU: Record<Extent, string> = {
  traces: 'следы',
  noticeable: 'заметно',
  dominant: 'основной',
};

export const SURFACE_RU: Record<Surface, string> = {
  weathered: 'Выветрен',
  fresh_split: 'Свежий скол',
  polished: 'Окатан',
  coated: 'С налётом',
};

export const TIER_RU: Record<Tier, string> = {
  common: 'Обычный',
  uncommon: 'Необычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
};

export const WANDERER_MECHANISM_RU: Record<WandererMechanism, string> = {
  drift_pumice: 'Приплыл морем',
  glacial_erratic: 'Принесён ледником',
  river_transport: 'Принесён рекой',
  human_imported: 'Завезён человеком',
};

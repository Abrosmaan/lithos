// Закрытые словари (ai-pipeline §5). Источник истины для клиента, воркера и промптов.
// Стартовый список — T0.1; T1.1 сверяет с mindat-номенклатурой и фиксирует правки в docs/tasks/T1.1.md.
// ИМЕНА ЭКСПОРТОВ СТАБИЛЬНЫ: их импортируют T1.2/T1.3/T1.4 параллельно.

export const ROCK_CLASSES = [
  // igneous
  'basalt', 'amygdaloidal_basalt', 'vesicular_basalt', 'andesite', 'dacite', 'rhyolite', 'obsidian', 'pumice', 'scoria',
  'granite', 'granodiorite', 'diorite', 'gabbro', 'diabase', 'peridotite', 'pegmatite', 'tuff', 'volcanic_breccia',
  // sedimentary
  'sandstone', 'siltstone', 'mudstone', 'shale', 'claystone', 'conglomerate', 'breccia', 'limestone', 'fossiliferous_limestone',
  'dolomite', 'chalk', 'chert', 'flint', 'coal', 'travertine', 'ironstone', 'coquina',
  // metamorphic
  'slate', 'phyllite', 'schist', 'gneiss', 'quartzite', 'marble', 'amphibolite', 'serpentinite', 'greenstone', 'hornfels',
  'eclogite', 'mylonite', 'soapstone',
  // siliceous / ornamental / other
  'jasper', 'agate', 'chalcedony', 'quartz_vein', 'petrified_wood', 'fossil', 'concretion', 'geode',
  // catch-all
  'unknown_igneous', 'unknown_sedimentary', 'unknown_metamorphic', 'unknown',
] as const;
export type RockClass = (typeof ROCK_CLASSES)[number];

export const MINERALS = [
  'quartz', 'amethyst', 'chalcedony', 'feldspar', 'plagioclase', 'orthoclase', 'mica', 'muscovite', 'biotite',
  'chlorite', 'epidote', 'olivine', 'pyroxene', 'augite', 'hornblende', 'amphibole', 'garnet', 'tourmaline',
  'zeolite', 'calcite', 'aragonite', 'dolomite', 'gypsum', 'halite', 'fluorite', 'barite',
  'pyrite', 'marcasite', 'chalcopyrite', 'magnetite', 'hematite', 'limonite', 'goethite', 'malachite', 'azurite',
  'serpentine', 'talc', 'kaolinite', 'glauconite', 'native_copper', 'fossil_fragment',
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

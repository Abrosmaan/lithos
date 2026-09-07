// Геоконтекст точки (dev-plan T1.2) — вход для промпта Main и для computeScore (T1.1).
import type { RockClass, WandererMechanism } from './enums.js';

export interface ExpectedRock {
  rock_class: RockClass;
  /** Доля площади в радиусе водосбора, 0..1. Бакет для score считается в shared/score.ts. */
  share: number;
}

export interface GeoContext {
  cell_id: string;               // geohash-6
  expected_rocks: ExpectedRock[];
  age_range: string | null;      // «Cretaceous–Paleogene»
  setting: string | null;        // coast | river | glacial | inland | volcanic …
  wanderers: WandererMechanism[];
  source: 'macrostrat' | 'cache' | 'none';
}

export interface UserTests {
  weight: 'lighter' | 'normal' | 'heavier' | null;
  scratch: 'nail' | 'coin' | 'none' | null;   // чем царапается
  wet: boolean | null;
  has_scale_photo: boolean;
}

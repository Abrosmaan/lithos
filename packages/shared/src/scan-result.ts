// Схема вывода моделей (ai-pipeline §5) — одна для S2 Main и S3 Escalation; S1 Gate — своя.
// Structured output валидируется этой схемой в воркере; невалидно = retry → repair → fallback.
import { z } from 'zod';
import { EXTENTS, GATE_QUALITIES, MINERALS, ROCK_CLASSES, SHAPE_TAGS, SURFACES, WANDERER_MECHANISMS } from './enums.js';

export const GateResultSchema = z.object({
  is_rock: z.boolean(),
  quality: z.enum(GATE_QUALITIES),
  multiple_objects: z.boolean(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const InclusionSchema = z.object({
  mineral: z.enum(MINERALS),
  confidence: z.number().min(0).max(1),
  extent: z.enum(EXTENTS),
  location: z.string().max(60).nullable().default(null),
  evidence: z.string().max(120),
});
export type Inclusion = z.infer<typeof InclusionSchema>;

export const ScanResultSchema = z.object({
  rock_class: z.object({
    primary: z.enum(ROCK_CLASSES),
    confidence: z.number().min(0).max(1),
    // До 5 альтернатив с калиброванной вероятностью и коротким «почему похоже» (UX как в iNaturalist).
    // Score от этих чисел НЕ зависит (spec §4.3): проценты только для показа, см. identification.ts.
    alternatives: z
      .array(z.object({ name: z.enum(ROCK_CLASSES), confidence: z.number().min(0).max(1), reason: z.string().max(80).nullish() }))
      .max(5)
      .default([]),
  }),
  inclusions: z.array(InclusionSchema).max(8).default([]),
  shape: z.object({
    tags: z.array(z.enum(SHAPE_TAGS)).max(4).default([]),
    natural_hole: z.boolean().default(false),
    recognizable_silhouette: z.string().max(40).nullable().default(null),
  }),
  surface: z.enum(SURFACES),
  provenance: z.object({
    matches_local_geology: z.boolean(),
    wanderer_mechanism: z.enum(WANDERER_MECHANISMS).nullable().default(null),
  }),
  split_recommendation: z.object({
    recommended: z.boolean(),
    reason: z.string().max(200).nullable().default(null),
  }),
  lore: z.string().max(800),
  flags: z.array(z.string().max(40)).max(6).default([]),
  revision_note: z.string().max(300).nullable().default(null),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;

// Golden set v0 (dev-plan T2.4, ai-pipeline §9): схема разметки supabase/seed/golden/labels.json и загрузчик.
// Разметка — источник истины для метрик eval; enum'ы — из @lithos/shared, дублирования словарей нет.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { EXTENTS, MINERALS, ROCK_CLASSES } from '@lithos/shared';

/** Корень golden set: supabase/seed/golden (относительно этого файла, не cwd — eval запускается из apps/worker). */
export const GOLDEN_DIR = resolve(fileURLToPath(new URL('../../../../supabase/seed/golden/', import.meta.url)));
export const GOLDEN_IMAGES_DIR = resolve(GOLDEN_DIR, 'images');
export const GOLDEN_RUNS_DIR = resolve(GOLDEN_DIR, 'runs');
export const LABELS_PATH = resolve(GOLDEN_DIR, 'labels.json');

export const GEOLOGY_TYPES = ['volcanic_coast', 'limestone_coast', 'granite_river', 'glacial'] as const;
export type GeologyType = (typeof GEOLOGY_TYPES)[number];

export const TRAPS = ['mica_vs_pyrite', 'chlorite_vs_malachite', 'concrete_vs_limestone', 'glass_vs_quartz'] as const;
export type Trap = (typeof TRAPS)[number];

/** Сколько позиций на тип геологии и на ловушки в v0 (dev-plan T2.4: 4 × 12 + 12). */
export const GOLDEN_PER_GEOLOGY = 12;
export const GOLDEN_TRAPS = 12;

export const GoldenSourceSchema = z.object({
  /** Страница файла (атрибуция), напр. https://commons.wikimedia.org/wiki/File:… */
  url: z.string().url(),
  /** Имя файла на Commons («File:…») — по нему fetch.ts строит URL превью нужной ширины. */
  title: z.string().min(1).optional(),
  license: z.string().min(1),
  author: z.string().min(1),
});

export const GoldenLabelSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-\d{2}$/, 'id вида vc-01'),
  /** Имя файла в images/ (`<id>.jpg`) или null — фото ещё не скачано/не найдено. */
  file: z.string().regex(/^[a-z]{2}-\d{2}\.jpg$/, 'file вида vc-01.jpg').nullable(),
  /** Ожидание gate: golden = камни (true); ловушки «не камень» (бетон, стекло) — false. */
  is_rock: z.boolean().default(true),
  rock_class: z.enum(ROCK_CLASSES),
  /** Допустимые ответы top-1 помимо rock_class (второе мнение эксперта). */
  acceptable_alternatives: z.array(z.enum(ROCK_CLASSES)).max(3).default([]),
  inclusions: z.array(z.object({ mineral: z.enum(MINERALS), extent: z.enum(EXTENTS) })).max(8).default([]),
  geology_type: z.enum(GEOLOGY_TYPES),
  trap: z.enum(TRAPS).nullable().default(null),
  /** Что скажет обманутая модель: порода и/или минерал-приманка. Только для ловушек. */
  decoy: z
    .object({ rock_class: z.enum(ROCK_CLASSES).optional(), mineral: z.enum(MINERALS).optional() })
    .nullable()
    .default(null),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: GoldenSourceSchema.nullable(),
  notes: z.string().default(''),
});
export type GoldenLabel = z.infer<typeof GoldenLabelSchema>;

export const GoldenLabelsSchema = z
  .object({
    version: z.number().int(),
    /** Пути file — относительно images/. */
    items: z.array(GoldenLabelSchema),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const it of v.items) {
      if (seen.has(it.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `дубль id ${it.id}` });
      seen.add(it.id);
      if (it.trap && !it.decoy) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${it.id}: ловушка без decoy` });
      if (!it.trap && it.decoy) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${it.id}: decoy без trap` });
      if (it.file && it.file !== `${it.id}.jpg`) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${it.id}: file должен быть ${it.id}.jpg` });
    }
  });
export type GoldenLabels = z.infer<typeof GoldenLabelsSchema>;

export function parseLabels(json: unknown): GoldenLabels {
  return GoldenLabelsSchema.parse(json);
}

export async function loadLabels(path: string = LABELS_PATH): Promise<GoldenLabels> {
  return parseLabels(JSON.parse(await readFile(path, 'utf8')));
}

/** Сводка манифеста: сколько позиций с фото/ссылкой, сколько «снять вручную», по группам. */
export function summarizeLabels(labels: GoldenLabels) {
  const byGeology: Record<GeologyType, number> = { volcanic_coast: 0, limestone_coast: 0, granite_river: 0, glacial: 0 };
  const byTrap: Record<Trap, number> = { mica_vs_pyrite: 0, chlorite_vs_malachite: 0, concrete_vs_limestone: 0, glass_vs_quartz: 0 };
  let withSource = 0;
  let manual = 0;
  for (const it of labels.items) {
    if (it.trap) byTrap[it.trap]++;
    else byGeology[it.geology_type]++;
    if (it.source) withSource++;
    else manual++;
  }
  return { total: labels.items.length, withSource, manual, byGeology, byTrap };
}

// `pnpm eval` — прогон golden set через провайдерный слой (dev-plan T2.4, ai-pipeline §2a/§9).
// Запуск из apps/worker: pnpm eval [--stage …] [--models …] [--limit N] [--concurrency 3] [--synthetic] [--no-geo]
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { GeoContext } from '@lithos/shared';
import '../config.js'; // .env; БД-переменные не обязательны (dbUrl — ленивый getter)
import { ROLE_MODELS, formatModelSpec, type LlmStage, type ModelSpec } from '../llm/config.js';
import { hasApiKey } from '../llm/providers.js';
import { EVAL_USAGE, parseEvalArgs, type EvalArgs } from './args.js';
import { loadGoldenImage, syntheticItems } from './images.js';
import { GOLDEN_RUNS_DIR, loadLabels, summarizeLabels } from './labels.js';
import { buildReport } from './report.js';
import { runStageModel, type EvalItem, type ModelRun } from './run.js';

const STAGE_ORDER: LlmStage[] = ['gate', 'main', 'escalation'];

/** Пары ai-pipeline §2a на каждую ступень — те же ROLE_MODELS, что использует fallback. */
export function defaultModels(stage: LlmStage): ModelSpec[] {
  return [
    { provider: 'anthropic', model: ROLE_MODELS.anthropic[stage] },
    { provider: 'google', model: ROLE_MODELS.google[stage] },
  ];
}

/** Prior для escalation: main-модель той же ступени/провайдера по умолчанию (ROLE_MODELS); иначе единственный main этого провайдера. */
export function priorMainRun(mainRuns: Map<string, ModelRun>, spec: ModelSpec): ModelRun | undefined {
  const byDefault = mainRuns.get(formatModelSpec({ provider: spec.provider, model: ROLE_MODELS[spec.provider].main }));
  if (byDefault) return byDefault;
  const same = [...mainRuns.values()].filter((r) => r.spec.provider === spec.provider);
  return same.length === 1 ? same[0] : undefined;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

async function gitCommit(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function collectItems(args: EvalArgs, note: (s: string) => void): Promise<{ items: EvalItem[]; skipped: number }> {
  if (args.synthetic) {
    const s = await syntheticItems();
    return { items: s.map(({ label, image }) => ({ label, image, geo: null })), skipped: 0 };
  }
  const labels = await loadLabels();
  const sum = summarizeLabels(labels);
  note(`Манифест: ${sum.total} позиций, со ссылкой на источник ${sum.withSource}, снять вручную ${sum.manual}`);
  let selected = labels.items;
  if (args.ids) selected = selected.filter((l) => args.ids!.includes(l.id));
  const items: EvalItem[] = [];
  let skipped = 0;
  for (const label of selected) {
    if (args.limit !== null && items.length >= args.limit) break;
    const image = await loadGoldenImage(label);
    if (!image) {
      skipped++;
      continue;
    }
    items.push({ label, image, geo: null });
  }
  return { items, skipped };
}

/** Геоконтекст по уникальным точкам (getGeoContext сам кэширует по geohash-6 в lithos.geo_cache). */
async function attachGeo(items: EvalItem[], note: (s: string) => void): Promise<{ note: string; close: () => Promise<void> }> {
  let geo: typeof import('../geo.js');
  let db: typeof import('../db.js');
  try {
    db = await import('../db.js');
    geo = await import('../geo.js');
  } catch (e) {
    note(`Геоконтекст недоступен (${e instanceof Error ? e.message : String(e)}) — прогон без geo`);
    return { note: 'недоступен (нет БД-переменных?)', close: async () => {} };
  }
  const cache = new Map<string, Promise<GeoContext>>();
  const sources: Record<string, number> = {};
  for (const it of items) {
    const key = `${it.label.lat},${it.label.lng}`;
    let p = cache.get(key);
    if (!p) {
      p = geo.getGeoContext(it.label.lat, it.label.lng);
      cache.set(key, p);
    }
    it.geo = await p;
    sources[it.geo.source] = (sources[it.geo.source] ?? 0) + 1;
  }
  const desc = Object.entries(sources).map(([k, v]) => `${k}: ${v}`).join(', ');
  note(`Геоконтекст: ${cache.size} точек (${desc})`);
  return { note: desc || 'нет точек', close: () => db.closeDb() };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseEvalArgs(argv);
  if (args.help) {
    console.log(EVAL_USAGE);
    return;
  }
  const startedAt = new Date();
  const note = (s: string) => process.stderr.write(`${s}\n`);

  const explicit = new Set<LlmStage>(args.synthetic ? ['gate'] : args.stages);
  const stages = new Set(explicit);
  // Escalation нужен prior — main той же семьи добавляется автоматически, но с моделями по умолчанию (--models к ней не относится).
  if (stages.has('escalation')) stages.add('main');
  const order = STAGE_ORDER.filter((s) => stages.has(s));

  const { items, skipped } = await collectItems(args, note);
  if (items.length === 0) {
    note(skipped ? `Нет ни одного фото в images/ (${skipped} позиций без файла). Скачайте: pnpm --filter worker exec tsx src/eval/fetch.ts` : 'Нет позиций для прогона.');
    process.exitCode = 2;
    return;
  }

  const runDir = resolve(GOLDEN_RUNS_DIR, `${stamp(startedAt)}${args.tag ? `-${args.tag}` : ''}${args.synthetic ? '-synthetic' : ''}`);
  await mkdir(runDir, { recursive: true });

  const geoInfo = args.noGeo || args.synthetic ? { note: 'выключен', close: async () => {} } : await attachGeo(items, note);

  const plan = order.map((stage) => ({ stage, models: explicit.has(stage) && args.models ? args.models : defaultModels(stage) }));
  for (const { stage, models } of plan) {
    note(`${stage}: ${models.map((m) => `${formatModelSpec(m)}${hasApiKey(m.provider) ? '' : ' (нет ключа)'}`).join(', ')} × ${items.length} позиций`);
  }

  const runs: ModelRun[] = [];
  const mainRuns = new Map<string, ModelRun>(); // ключ — formatModelSpec
  for (const { stage, models } of plan) {
    for (const spec of models) {
      const priorRun = stage === 'escalation' ? priorMainRun(mainRuns, spec) : undefined;
      const priors = priorRun?.status === 'ran' ? priorRun.results : undefined;
      const run = await runStageModel(stage, spec, items, { concurrency: args.concurrency, runDir, priors, progress: note });
      runs.push(run);
      if (stage === 'main') mainRuns.set(formatModelSpec(spec), run);
      if (run.status !== 'ran') note(`[${stage} ${formatModelSpec(spec)}] пропуск: ${run.status === 'no_key' ? 'нет ключа' : 'нет prior'}`);
      else if (priorRun) note(`[${stage} ${formatModelSpec(spec)}] prior: ${formatModelSpec(priorRun.spec)}`);
    }
  }

  const finishedAt = new Date();
  const report = buildReport(
    {
      title: args.synthetic ? 'Eval — synthetic (harness check)' : 'Eval — golden set v0',
      startedAt,
      finishedAt,
      argv,
      itemsTotal: items.length,
      itemsSkipped: skipped,
      geoNote: geoInfo.note,
      commit: await gitCommit(),
    },
    runs,
  );
  await writeFile(resolve(runDir, 'report.md'), report);
  await writeFile(
    resolve(runDir, 'outcomes.json'),
    JSON.stringify(runs.map((r) => ({ stage: r.stage, model: formatModelSpec(r.spec), status: r.status, prompt_version: r.promptVersion, outcomes: r.outcomes })), null, 2),
  );
  console.log(report);
  console.log(`Сырые ответы и отчёт: ${runDir}`);
  await geoInfo.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('eval failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
}

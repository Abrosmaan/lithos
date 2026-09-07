// Разбор аргументов `pnpm eval` (dev-plan T2.4). Чистая функция — тестируется без процесса.
import { LLM_STAGES, parseModelSpec, type LlmStage, type ModelSpec } from '../llm/config.js';

export interface EvalArgs {
  stages: LlmStage[];
  /** Явный список моделей (для всех выбранных ступеней) или null — наборы по умолчанию из ai-pipeline §2a. */
  models: ModelSpec[] | null;
  limit: number | null;
  ids: string[] | null;
  concurrency: number;
  synthetic: boolean;
  /** Без геоконтекста (Macrostrat/БД не трогаются). */
  noGeo: boolean;
  /** Суффикс каталога прогона. */
  tag: string | null;
  help: boolean;
}

export const EVAL_USAGE = `pnpm eval [--stage gate|main|escalation|all] [--models provider:model,...] [--limit N] [--ids vc-01,tr-03]
          [--concurrency 3] [--synthetic] [--no-geo] [--tag name]

  --stage       ступень (по умолчанию all; escalation тянет за собой main той же семьи как prior — с моделями по умолчанию)
  --models      модели только для явно выбранных ступеней; по умолчанию пары ai-pipeline §2a (Haiku/Flash-Lite, Sonnet/3.7 Flash, Opus/3.1 Pro)
  --limit N     первые N позиций манифеста с фото
  --ids         только эти id
  --concurrency параллельных вызовов на модель (по умолчанию 3)
  --synthetic   3 синтетические картинки (не камни), только gate — проверка harness end-to-end (центы)
  --no-geo      не запрашивать геоконтекст
  --tag         суффикс каталога runs/<ts>-<tag>`;

function parseStage(v: string | undefined): LlmStage[] {
  if (!v || v === 'all') return [...LLM_STAGES];
  if ((LLM_STAGES as readonly string[]).includes(v)) return [v as LlmStage];
  throw new Error(`--stage: ожидается gate|main|escalation|all, получено "${v}"`);
}

function parseInt10(name: string, v: string | undefined): number {
  const n = Number(v);
  if (!v || !Number.isInteger(n) || n <= 0) throw new Error(`${name}: ожидается целое > 0, получено "${v ?? ''}"`);
  return n;
}

export function parseEvalArgs(argv: string[]): EvalArgs {
  const a: EvalArgs = { stages: [...LLM_STAGES], models: null, limit: null, ids: null, concurrency: 3, synthetic: false, noGeo: false, tag: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const next = () => argv[++i];
    switch (k) {
      case '--stage':
        a.stages = parseStage(next());
        break;
      case '--models':
        a.models = (next() ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseModelSpec);
        if (a.models.length === 0) throw new Error('--models: пустой список');
        break;
      case '--limit':
        a.limit = parseInt10('--limit', next());
        break;
      case '--ids':
        a.ids = (next() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--concurrency':
        a.concurrency = parseInt10('--concurrency', next());
        break;
      case '--synthetic':
        a.synthetic = true;
        break;
      case '--no-geo':
        a.noGeo = true;
        break;
      case '--tag':
        a.tag = (next() ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || null;
        break;
      case '--help':
      case '-h':
        a.help = true;
        break;
      default:
        throw new Error(`Неизвестный аргумент "${k}"\n${EVAL_USAGE}`);
    }
  }
  return a;
}

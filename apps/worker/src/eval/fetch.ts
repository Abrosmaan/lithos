// Скачивание фото golden set по манифесту (dev-plan T2.4). Запускает человек, сеть нужна:
//   pnpm --filter worker exec tsx src/eval/fetch.ts [--force] [--ids vc-01,vc-02] [--dry-run]
// Источник - Wikimedia Commons (CC-лицензии, см. labels.json → source). Берём превью шириной 1280 через Special:FilePath,
// ужимаем sharp'ом до 1024 px по длинной стороне (как S0 на клиенте), JPEG q=85, кладём в supabase/seed/golden/images/<id>.jpg.
// Уже скачанные пропускаются. Файлы - в git (≈ 60 × 150–300 КБ, меньше 50 МБ - см. docs/tasks/T2.4.md).
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { EVAL_IMAGE_PX, EVAL_JPEG_QUALITY, fileExists } from './images.js';
import { GOLDEN_DIR, GOLDEN_IMAGES_DIR, loadLabels, type GoldenLabel, type GoldenLabels } from './labels.js';

/** Commons требует осмысленный User-Agent, иначе 403. */
const USER_AGENT = 'LithosGoldenSet/0.1 (rock-collecting game eval; https://github.com/ - see repo docs/tasks/T2.4.md)';
const FETCH_WIDTH = 1280;
const TIMEOUT_MS = 30_000;
const DELAY_MS = 300;
/** Сеть/429/5xx → до 3 попыток с backoff 1/2/4 с. */
const RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000] as const;
export const ATTRIBUTION_PATH = resolve(GOLDEN_DIR, 'ATTRIBUTION.md');

export function commonsFileUrl(title: string, width = FETCH_WIDTH): string {
  const name = title.replace(/^File:/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

/** Откуда качать: source.title (Commons) → превью; иначе source.url, если это прямая ссылка на картинку. */
export function downloadUrl(label: GoldenLabel): string | null {
  if (!label.source) return null;
  if (label.source.title) return commonsFileUrl(label.source.title);
  return /\.(jpe?g|png|webp)$/i.test(label.source.url) ? label.source.url : null;
}

interface Args {
  force: boolean;
  dryRun: boolean;
  ids: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { force: false, dryRun: false, ids: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--force') a.force = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--ids') a.ids = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Неизвестный аргумент "${k}"`);
  }
  return a;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

function retryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status === 408 || e.status >= 500;
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(e.message));
}

async function downloadOnce(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new HttpError(res.status);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`не картинка: ${type}`);
  return Buffer.from(await res.arrayBuffer());
}

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(url);
    } catch (e) {
      if (attempt >= RETRIES || !retryable(e)) throw e;
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      console.error(`  retry ${attempt + 1}/${RETRIES} через ${wait} мс: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** ATTRIBUTION.md - атрибуция по манифесту (id → автор, лицензия, ссылка); нужна для CC BY / CC BY-SA. */
export function renderAttribution(labels: GoldenLabels): string {
  const lines = [
    '# Golden set - источники и лицензии',
    '',
    'Генерируется `apps/worker/src/eval/fetch.ts` из `labels.json`. Фото изменены: обрезка не применялась, только сжатие до 1024 px по длинной стороне (JPEG q=85).',
    '',
    '| id | Порода (разметка) | Автор | Лицензия | Источник |',
    '|---|---|---|---|---|',
  ];
  for (const it of labels.items) {
    if (!it.source) {
      lines.push(`| ${it.id} | ${it.rock_class} | - | - | снять вручную |`);
      continue;
    }
    lines.push(`| ${it.id} | ${it.rock_class} | ${it.source.author} | ${it.source.license} | [${it.source.title ?? it.source.url}](${it.source.url}) |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const f of await readdir(dir)) total += (await stat(resolve(dir, f))).size;
  return total;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const labels = await loadLabels();
  await mkdir(GOLDEN_IMAGES_DIR, { recursive: true });
  const items = args.ids ? labels.items.filter((l) => args.ids!.includes(l.id)) : labels.items;
  await writeFile(ATTRIBUTION_PATH, renderAttribution(labels));

  const report = { downloaded: [] as string[], skipped: [] as string[], manual: [] as string[], failed: [] as string[], planned: 0 };
  for (const label of items) {
    const url = downloadUrl(label);
    if (!url || !label.file) {
      report.manual.push(label.id);
      continue;
    }
    const dest = resolve(GOLDEN_IMAGES_DIR, label.file);
    if (!args.force && (await fileExists(dest))) {
      report.skipped.push(label.id);
      continue;
    }
    if (args.dryRun) {
      report.planned++;
      console.log(`${label.id} ← ${url}`);
      continue;
    }
    try {
      const bytes = await download(url);
      const jpeg = await sharp(bytes)
        .rotate()
        .resize({ width: EVAL_IMAGE_PX, height: EVAL_IMAGE_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: EVAL_JPEG_QUALITY })
        .toBuffer();
      await writeFile(dest, jpeg);
      report.downloaded.push(label.id);
      console.log(`${label.id} ok ${(jpeg.length / 1024).toFixed(0)} КБ ← ${label.source?.title ?? url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.failed.push(`${label.id} (${msg})`);
      console.error(`${label.id} FAILED: ${msg} ← ${url}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const size = await dirSize(GOLDEN_IMAGES_DIR);
  console.log('\nИтог:');
  if (args.dryRun) console.log(`  к скачиванию:   ${report.planned}`);
  console.log(`  скачано:        ${report.downloaded.length}`);
  console.log(`  уже было:       ${report.skipped.length}`);
  console.log(`  снять вручную:  ${report.manual.length}${report.manual.length ? ` (${report.manual.join(', ')})` : ''}`);
  console.log(`  ошибки:         ${report.failed.length}${report.failed.length ? `\n    ${report.failed.join('\n    ')}` : ''}`);
  console.log(`  images/: ${(size / 1024 / 1024).toFixed(1)} МБ${size > 50 * 1024 * 1024 ? ' - больше 50 МБ, добавьте supabase/seed/golden/images/ в .gitignore' : ''}`);
  console.log(`  атрибуция: ${ATTRIBUTION_PATH}`);
  if (report.failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('fetch failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
}

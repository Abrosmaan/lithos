// Реальная проверка провайдерного слоя (T1.3 п.6). Запуск из apps/worker:
//   pnpm exec tsx src/llm/smoke.ts [photo1.jpg [photo2.jpg [photo3.jpg]]] [--provider anthropic|google]
// Без файлов генерирует тестовую картинку (серый прямоугольник с шумом) через sharp.
// Стоимость одного прогона на Anthropic — центы. Ключи в вывод не попадают.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import '../config.js'; // подхватывает .env; БД-переменные не нужны (dbUrl — ленивый getter)
import { callModel } from './callModel.js';
import { ROLE_MODELS, loadLlmConfig, type LlmConfig, type Provider } from './config.js';
import { hasApiKey } from './providers.js';
import type { ImageInput } from './types.js';

async function noiseImage(): Promise<ImageInput> {
  const w = 768;
  const h = 768;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) {
    const v = 110 + Math.floor(Math.random() * 50);
    raw[i] = v;
    raw[i + 1] = v;
    raw[i + 2] = v - 5;
  }
  const bytes = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  return { bytes, mimeType: 'image/jpeg' };
}

async function loadImages(paths: string[]): Promise<ImageInput[]> {
  if (paths.length === 0) return [await noiseImage()];
  const out: ImageInput[] = [];
  for (const p of paths.slice(0, 3)) {
    // Сжимаем как S0 на клиенте: 1024 px по длинной стороне, JPEG q=85.
    const bytes = await sharp(await readFile(p)).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    out.push({ bytes, mimeType: 'image/jpeg' });
  }
  return out;
}

function parseArgs(argv: string[]): { files: string[]; provider: Provider } {
  const files: string[] = [];
  let provider: Provider = 'anthropic';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--provider') {
      const v = argv[++i];
      if (v !== 'anthropic' && v !== 'google') throw new Error('--provider anthropic|google');
      provider = v;
    } else files.push(a);
  }
  return { files, provider };
}

async function main() {
  const { files, provider } = parseArgs(process.argv.slice(2));
  const base = loadLlmConfig(process.env);
  if (!hasApiKey(provider)) {
    console.error(`No API key for provider "${provider}" in env — cannot run smoke.`);
    process.exit(2);
  }
  // Все ступени на одном провайдере (по роли), чтобы проверить его целиком.
  const config: LlmConfig = {
    ...base,
    stages: {
      gate: { provider, model: ROLE_MODELS[provider].gate },
      main: { provider, model: ROLE_MODELS[provider].main },
      escalation: { provider, model: ROLE_MODELS[provider].escalation },
    },
  };
  const images = await loadImages(files);
  console.log(`provider=${provider} images=${images.length} (${images.map((i) => `${i.bytes.length} B`).join(', ')}) source=${files.length ? 'files' : 'sharp noise'}`);

  const scanId = `smoke-${Date.now()}`;
  const brief = (o: Awaited<ReturnType<typeof callModel>>) =>
    `${o.provider}:${o.model} v=${o.promptVersion} in=${o.tokensIn} out=${o.tokensOut} cost=$${o.costUsd.toFixed(5)} latency=${o.latencyMs}ms attempts=${o.attempts} fallback=${o.usedFallback}/${o.fallbackReason} repaired=${o.repaired}`;

  console.log('\n== gate ==');
  const gate = await callModel({ stage: 'gate', images: [images[0]!], userLanguage: 'ru', scanId }, { config });
  console.log(brief(gate));
  console.log(JSON.stringify(gate.result));

  console.log('\n== main ==');
  const main = await callModel({ stage: 'main', images, geo: null, userTests: null, userLanguage: 'ru', scanId }, { config });
  console.log(brief(main));
  console.log(JSON.stringify(main.result, null, 2));

  const total = gate.costUsd + main.costUsd;
  console.log(`\ntotal cost=$${total.toFixed(5)}`);
}

main().catch((e) => {
  console.error('smoke failed:', e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});

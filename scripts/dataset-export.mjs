// T7.1, поток C — выгрузка обучающего набора и счётчик готовности.
// Обучения здесь нет и не будет: только чтение lithos.*, сборка манифеста и (по возможности) скачивание
// фотографий из приватного бакета. В БД ничего не меняется.
//
//   node scripts/dataset-export.mjs                 # выгрузка: manifest.json + фотографии (если есть ключ)
//   node scripts/dataset-export.mjs --manifest-only  # без скачивания фотографий
//   node scripts/dataset-export.mjs --readiness      # только счётчик готовности, ничего не пишет на диск
//   node scripts/dataset-export.mjs --out-dir <dir>  # куда писать (по умолчанию training-export/)
//
// Подключение к БД — как в scripts/db-migrate.mjs (SUPABASE_DB_POOLER_URL/SUPABASE_DB_URL). Фотографии —
// приватный бакет lithos-photos, нужен служебный ключ (SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY) из
// .env. Секреты нигде не печатаются. Каталог выгрузки — персональные данные, в .gitignore (см. корень репо).
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  MANIFEST_VERSION,
  PHOTO_BUCKET,
  buildManifest,
  computeReadiness,
  normalizeRow,
  photoRelativePath,
  selectForExport,
} from './lib/dataset-export.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function parseArgs(argv) {
  const args = { readiness: false, manifestOnly: false, outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--readiness') args.readiness = true;
    else if (a === '--manifest-only') args.manifestOnly = true;
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`Неизвестный флаг: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const HELP = `Выгрузка обучающего набора Lithos (T7.1, поток C).

  --readiness      только счётчик готовности (порода → фото, общее число, согласившиеся пользователи)
  --manifest-only  выгрузить манифест и метки, не скачивать фотографии
  --out-dir <dir>  каталог выгрузки (по умолчанию training-export/ в корне репо)
  --help           эта справка
`;

// Строки — по одной на скан. json_agg собирает метки/фото/результаты ступеней списками, отбор и выбор
// «победившей» метки/вердикта — чистыми функциями в lib/dataset-export.mjs, не здесь и не в SQL.
// Фильтр по exists(labels) — только чтобы не тащить из базы сканы, у которых заведомо не может быть
// подтверждённой метки; на сам отбор (isEligible) это не влияет.
const SCANS_QUERY = `
  select
    s.id as scan_id,
    s.user_id,
    s.created_at as scan_created_at,
    u.training_opt_in,
    c.id as card_id,
    c.hidden as card_hidden,
    c.verification as card_verification,
    coalesce((
      select json_agg(json_build_object(
        'id', l.id, 'rock_class', l.rock_class, 'source', l.source,
        'matched_model', l.matched_model, 'created_at', l.created_at
      ))
      from lithos.labels l where l.scan_id = s.id
    ), '[]'::json) as labels,
    coalesce((
      select json_agg(json_build_object(
        'id', sp.id, 'storage_path', sp.storage_path, 'is_primary', sp.is_primary
      ))
      from lithos.scan_photos sp where sp.scan_id = s.id
    ), '[]'::json) as photos,
    coalesce((
      select json_agg(json_build_object(
        'stage', r.stage, 'provider', r.provider, 'model', r.model,
        'prompt_version', r.prompt_version, 'created_at', r.created_at
      ))
      from lithos.scan_results r where r.scan_id = s.id
    ), '[]'::json) as scan_results
  from lithos.scans s
  join lithos.users u on u.id = s.user_id
  left join lithos.cards c on c.scan_id = s.id
  where exists (select 1 from lithos.labels l where l.scan_id = s.id)
  order by s.id;
`;

async function fetchRecords(client) {
  const { rows } = await client.query(SCANS_QUERY);
  return rows.map(normalizeRow);
}

async function countConsentedUsers(client) {
  const { rows } = await client.query('select count(*)::int as n from lithos.users where training_opt_in = true');
  return rows[0]?.n ?? 0;
}

function printReadiness(readiness) {
  console.log('Готовность обучающего набора (только сканы с training_opt_in=true и подтверждённой меткой):');
  const rocks = Object.keys(readiness.byRockClass).sort((a, b) => a.localeCompare(b));
  if (rocks.length === 0) {
    console.log('  подтверждённых фотографий пока нет.');
  } else {
    console.log('  порода                          | фото');
    console.log('  ---------------------------------+------');
    for (const rock of rocks) {
      console.log(`  ${rock.padEnd(33)} | ${readiness.byRockClass[rock]}`);
    }
  }
  console.log(`  Всего подтверждённых фотографий: ${readiness.totalPhotos} (сканов: ${readiness.scans})`);
  console.log(`  Пользователей с согласием на обучение (training_opt_in=true): ${readiness.consentedUsers}`);
}

// ---- скачивание фотографий: приватный бакет, только с служебным ключом; таймаут + retry(3, экспонента) ----
const STORAGE_TIMEOUT_MS = 15000;
const STORAGE_ATTEMPTS = 3;
const STORAGE_BACKOFF_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadPhoto(supabaseUrl, serviceKey, storagePath) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${PHOTO_BUCKET}/${storagePath}`;
  let lastErr = new Error('storage: нет попыток');
  for (let attempt = 1; attempt <= STORAGE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
      if (res.status === 404 || res.status === 400) {
        throw new Error(`фото недоступно (${res.status}): ${storagePath}`);
      }
      if (!res.ok) throw new Error(`storage вернул ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < STORAGE_ATTEMPTS) await sleep(STORAGE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const dbUrl = process.env.SUPABASE_DB_POOLER_URL || process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('Нет SUPABASE_DB_POOLER_URL / SUPABASE_DB_URL в .env');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let records;
  let consentedUsers;
  try {
    records = await fetchRecords(client);
    consentedUsers = await countConsentedUsers(client);
  } finally {
    await client.end();
  }

  if (args.readiness) {
    printReadiness(computeReadiness(records, consentedUsers));
    return;
  }

  const eligible = selectForExport(records);
  const manifest = buildManifest(eligible, { version: MANIFEST_VERSION, generatedAt: new Date().toISOString() });

  const outDir = resolve(root, args.outDir ?? 'training-export');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Записей в манифесте: ${manifest.items.length} (каталог: ${outDir})`);
  if (eligible.length === 0) {
    console.log('Данных для выгрузки пока нет — это нормально на раннем этапе (T7.1). Пустой манифест записан.');
  }

  if (args.manifestOnly) {
    console.log('Флаг --manifest-only: фотографии не скачивались.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.log(
      'Нет служебного ключа (SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY) или SUPABASE_URL в .env — ' +
        'метки выгружены, фотографии пропущены. Это ожидаемо вне сервера воркера.',
    );
    return;
  }

  const photosDir = resolve(outDir, 'photos');
  let downloaded = 0;
  let failed = 0;
  for (const record of eligible) {
    for (const photo of record.photos) {
      const targetName = photoRelativePath(record.scanId, photo);
      const targetPath = resolve(photosDir, targetName);
      try {
        const bytes = await downloadPhoto(supabaseUrl, serviceKey, photo.storagePath);
        await mkdir(resolve(targetPath, '..'), { recursive: true });
        await writeFile(targetPath, bytes);
        downloaded++;
      } catch (e) {
        failed++;
        console.error(`Не удалось скачать фото скана ${record.scanId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  console.log(`Фотографий скачано: ${downloaded}${failed > 0 ? `, ошибок: ${failed}` : ''}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

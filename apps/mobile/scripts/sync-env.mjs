// Генерирует apps/mobile/.env из корневого .env: только EXPO_PUBLIC_* (Expo читает .env из папки приложения).
// Секреты (service_role, ключи моделей, пароль БД) в папку приложения и в процесс Metro не попадают.
// Значения не печатаются. Запускается автоматически перед `expo start` (prestart) и `pnpm export`.
import { readFileSync, writeFileSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = resolve(appDir, '..', '..', '.env');
const appEnv = resolve(appDir, '.env');

if (!existsSync(rootEnv)) {
  console.error('sync-env: корневой .env не найден — создайте его по .env.example');
  process.exit(1);
}
// Старый симлинк на корневой .env — убрать, иначе перезапись пойдёт в корневой файл.
if (existsSync(appEnv) && lstatSync(appEnv).isSymbolicLink()) unlinkSync(appEnv);

const lines = readFileSync(rootEnv, 'utf8')
  .split(/\r?\n/)
  .filter((l) => /^\s*EXPO_PUBLIC_[A-Z0-9_]+\s*=/.test(l))
  .map((l) => l.trim());

const header = '# Сгенерировано scripts/sync-env.mjs из ../../.env — не редактировать, в git не попадает.';
writeFileSync(appEnv, `${header}\n${lines.join('\n')}\n`);
console.log(`sync-env: ${lines.length} EXPO_PUBLIC_* → apps/mobile/.env (${lines.map((l) => l.split('=')[0]).join(', ')})`);

// Диагностика перед ручной проверкой на телефоне: доступна ли схема lithos через PostgREST
// (Dashboard → Settings → API → Exposed schemas) и включены ли anonymous sign-ins.
// Использует только EXPO_PUBLIC_* из apps/mobile/.env; значения не печатает; ничего не создаёт.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(appDir, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^EXPO_PUBLIC_/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('check-backend: нет EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY'); process.exit(1); }

const headers = { apikey: key, Authorization: `Bearer ${key}` };
let ok = true;

// 1. Схема lithos открыта в API? Без сессии RLS вернёт пустой массив (200); если схема не exposed — 406/PGRST106.
const rest = await fetch(`${url}/rest/v1/users?select=id&limit=1`, { headers: { ...headers, 'Accept-Profile': 'lithos' } });
const restBody = await rest.text();
const exposed = rest.status === 200 || rest.status === 401;
console.log(`[${exposed ? 'OK ' : 'FAIL'}] схема lithos в Exposed schemas: HTTP ${rest.status}${exposed ? '' : ` (${restBody.slice(0, 120)})`}`);
ok &&= exposed;

// 2. RPC enqueue_scan виден (401/400/404 без сессии — нормально; 404 с PGRST202 = функции нет в exposed-схеме).
const rpc = await fetch(`${url}/rest/v1/rpc/enqueue_scan`, { method: 'POST', headers: { ...headers, 'Content-Profile': 'lithos', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_scan_id: '00000000-0000-0000-0000-000000000000' }) });
const rpcBody = await rpc.text();
const rpcVisible = !rpcBody.includes('PGRST202') && !rpcBody.includes('PGRST106');
console.log(`[${rpcVisible ? 'OK ' : 'FAIL'}] RPC lithos.enqueue_scan доступен через API: HTTP ${rpc.status}${rpcVisible ? '' : ` (${rpcBody.slice(0, 120)})`}`);
ok &&= rpcVisible;

// 3. Anonymous sign-ins: GET /auth/v1/settings отдаёт external.anonymous_users.
const settings = await fetch(`${url}/auth/v1/settings`, { headers });
const s = settings.ok ? await settings.json() : null;
const anon = s?.external?.anonymous_users;
console.log(`[${anon === true ? 'OK ' : anon === false ? 'FAIL' : '??? '}] anonymous sign-ins: ${anon === undefined ? `нет поля (HTTP ${settings.status})` : anon}`);
ok &&= anon !== false;

console.log(ok ? 'Бэкенд готов к ручной проверке.' : 'Есть блокеры — см. FAIL выше (Dashboard → Settings → API / Authentication).');
process.exit(ok ? 0 : 2);

// В бандл попадают только EXPO_PUBLIC_* (Expo инлайнит их при сборке). Никаких других секретов.
// apps/mobile/.env генерируется scripts/sync-env.mjs из корневого .env — только строки EXPO_PUBLIC_*.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const ENV_OK = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

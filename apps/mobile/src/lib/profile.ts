// Профиль (T3.3): имя в lithos.users.display_name (RLS users_self по auth.uid()), счётчики сканов,
// удаление локальных данных (T5.3).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureUser, resetAuthCache } from './auth';
import { MSG, UserError } from './errors';
import { withRetry } from './retry';
import { scanWindowStart } from './settings';
import { supabase } from './supabase';

export const DISPLAY_NAME_MAX = 40;

export interface Profile {
  userId: string;
  displayName: string | null;
  createdAt: string | null;
}

export async function fetchProfile(): Promise<Profile> {
  const { userId } = await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('users').select('display_name, created_at').eq('id', userId).abortSignal(signal).maybeSingle();
    if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
    const row = r.data as { display_name?: unknown; created_at?: unknown } | null;
    return {
      userId,
      displayName: typeof row?.display_name === 'string' && row.display_name.length > 0 ? row.display_name : null,
      createdAt: typeof row?.created_at === 'string' ? row.created_at : null,
    };
  }, { label: 'users.get' });
}

/** Пустая строка → null (имя сброшено). */
export async function updateDisplayName(name: string): Promise<string | null> {
  const value = name.trim().slice(0, DISPLAY_NAME_MAX) || null;
  const { userId } = await ensureUser();
  await withRetry(async (signal) => {
    const r = await supabase.from('users').update({ display_name: value }).eq('id', userId).abortSignal(signal);
    if (r.error) throw new UserError(MSG.saveFailed, { cause: r.error });
  }, { label: 'users.rename' });
  return value;
}

/** Сканов всего — count(*) по lithos.scans пользователя (включая отказы и расколы), как в БД. */
export async function countScans(): Promise<number> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('scans').select('id', { count: 'exact', head: true }).abortSignal(signal);
    if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
    return r.count ?? 0;
  }, { label: 'scans.count' });
}

/** Сканов за скользящие сутки (окно лимита, spec §13) — count по lithos.scans пользователя. */
export async function countScansToday(now: number = Date.now()): Promise<number> {
  await ensureUser();
  return withRetry(async (signal) => {
    const r = await supabase.from('scans').select('id', { count: 'exact', head: true }).gte('created_at', scanWindowStart(now)).abortSignal(signal);
    if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
    return r.count ?? 0;
  }, { label: 'scans.countToday' });
}

/**
 * «Удалить все данные»: только этот телефон — AsyncStorage (кэш, витрина, флаги, device_id), выход из
 * анонимной сессии, сброс кэшей auth в памяти. Записи в базе не трогаем: следующий запуск создаст новый
 * анонимный профиль с новым device_id.
 */
export async function wipeLocalData(): Promise<void> {
  await AsyncStorage.clear();
  await supabase.auth.signOut().catch(() => { /* сессии уже нет — не критично */ });
  resetAuthCache();
}

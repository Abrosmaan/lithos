// Анонимная сессия + device_id + строка lithos.users. ensureUser() возвращает users.id.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import { MSG, UserError } from './errors';
import { withRetry } from './retry';
import { supabase } from './supabase';

const DEVICE_ID_KEY = 'lithos.device_id';
const PG_UNIQUE_VIOLATION = '23505';

let deviceIdCache: string | null = null;
let deviceIdInflight: Promise<string> | null = null;
let userCache: { authUserId: string; userId: string } | null = null;
let userInflight: Promise<LithosUser> | null = null;

export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  if (deviceIdInflight) return deviceIdInflight;
  deviceIdInflight = (async () => {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    const id = stored ?? Crypto.randomUUID();
    if (!stored) await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    deviceIdCache = id;
    return id;
  })().finally(() => { deviceIdInflight = null; });
  return deviceIdInflight;
}

async function setDeviceId(id: string): Promise<string> {
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  deviceIdCache = id;
  return id;
}

export async function ensureSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new UserError(MSG.authFailed, { cause: error });
  if (data.session) return data.session;
  const signIn = await supabase.auth.signInAnonymously();
  if (signIn.error || !signIn.data.session) throw new UserError(MSG.authFailed, { cause: signIn.error });
  return signIn.data.session;
}

export interface LithosUser {
  userId: string;
  deviceId: string;
}

type UserRow = { id: string; device_id: string | null };

async function selectUser(authUserId: string, signal: AbortSignal): Promise<UserRow | null> {
  const r = await supabase.from('users').select('id, device_id').eq('auth_user_id', authUserId).abortSignal(signal).maybeSingle();
  if (r.error) throw new UserError(MSG.authFailed, { cause: r.error });
  return r.data as UserRow | null;
}

async function resolveUser(): Promise<LithosUser> {
  const session = await withRetry(() => ensureSession(), { label: 'auth' });
  const authUserId = session.user.id;
  if (userCache && userCache.authUserId !== authUserId) userCache = null; // сессия сменилась
  let deviceId = await getDeviceId();

  let row = await withRetry((signal) => selectUser(authUserId, signal), { label: 'users.select' });

  if (!row) {
    row = await withRetry(async (signal) => {
      const ins = await supabase
        .from('users')
        .insert({ auth_user_id: authUserId, device_id: deviceId })
        .select('id, device_id')
        .abortSignal(signal)
        .single();
      if (!ins.error) return ins.data as UserRow;
      // Гонка (параллельный insert) или потерянная сессия при живом device_id — перечитать свою строку.
      if (ins.error.code === PG_UNIQUE_VIOLATION) {
        const again = await selectUser(authUserId, signal);
        if (again) return again;
      }
      throw new UserError(MSG.authFailed, { cause: ins.error });
    }, { label: 'users.insert' });
  }

  // Строка в БД — источник истины для device_id (если он там есть).
  if (row.device_id && row.device_id !== deviceId) deviceId = await setDeviceId(row.device_id);
  userCache = { authUserId, userId: row.id };
  return { userId: row.id, deviceId };
}

/**
 * Гарантирует строку lithos.users для текущей анонимной сессии. Идемпотентно, один запрос за раз.
 * При конфликте device_id (unique) строка перечитывается по auth_user_id; device_id не перегенерируется.
 */
export function ensureUser(): Promise<LithosUser> {
  if (userInflight) return userInflight;
  userInflight = (async () => {
    // Кэш валиден только для той же auth-сессии (getSession читает локальное хранилище, без сети).
    if (userCache && deviceIdCache) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id === userCache.authUserId) return { userId: userCache.userId, deviceId: deviceIdCache };
      userCache = null;
    }
    return resolveUser();
  })().finally(() => { userInflight = null; });
  return userInflight;
}

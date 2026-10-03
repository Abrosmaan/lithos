// Профиль (T3.3): имя в lithos.users.display_name (RLS users_self по auth.uid()), счётчики сканов,
// удаление локальных данных (T5.3).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureUser, resetAuthCache } from './auth';
import { logError, MSG, UserError } from './errors';
import { clearPendingTrainingOptIn, getPendingTrainingOptIn, setPendingTrainingOptIn } from './prefs';
import { PHOTO_BUCKET } from './scan-helpers';
import { withRetry } from './retry';
import { scanWindowStart } from './settings';
import { supabase } from './supabase';

export const DISPLAY_NAME_MAX = 40;

export interface Profile {
  userId: string;
  displayName: string | null;
  createdAt: string | null;
  /** lithos.users.training_opt_in (T6.1, 0008_user_data_rights.sql) — согласие на обучение модели. */
  trainingOptIn: boolean;
}

export async function fetchProfile(): Promise<Profile> {
  const { userId } = await ensureUser();
  // Первая же возможность подхватить несинхронизированный выбор из онбординга (T6.1-F, замечание 1) — не
  // блокирует загрузку профиля, но гарантирует, что выбор пользователя не останется забытым в AsyncStorage
  // навсегда, если сеть в момент онбординга подвела.
  void syncPendingTrainingOptIn();
  return withRetry(async (signal) => {
    const r = await supabase.from('users').select('display_name, created_at, training_opt_in').eq('id', userId).abortSignal(signal).maybeSingle();
    if (r.error) throw new UserError(MSG.loadFailed, { cause: r.error });
    const row = r.data as { display_name?: unknown; created_at?: unknown; training_opt_in?: unknown } | null;
    return {
      userId,
      displayName: typeof row?.display_name === 'string' && row.display_name.length > 0 ? row.display_name : null,
      createdAt: typeof row?.created_at === 'string' ? row.created_at : null,
      trainingOptIn: row?.training_opt_in !== false,
    };
  }, { label: 'users.get' });
}

/**
 * Переключатель «Обучение модели» (consent-copy.md §6b) — 0009_training_consent_and_safe_wipe.sql держит
 * колонку выключенной по умолчанию и грантует её владельцу.
 *
 * Успешная запись гасит отложенный выбор из онбординга. Без этого возможен возврат отозванного согласия:
 * галочка в онбординге не доехала до сервера, локально осталось «да», человек потом выключил согласие в
 * настройках — и следующий syncPendingTrainingOptIn() молча вернул бы «да» обратно. Явное действие человека
 * всегда новее отложенного, поэтому отложенное после него бессмысленно.
 */
export async function setTrainingOptIn(value: boolean): Promise<void> {
  const { userId } = await ensureUser();
  await withRetry(async (signal) => {
    const r = await supabase.from('users').update({ training_opt_in: value }).eq('id', userId).abortSignal(signal);
    if (r.error) throw new UserError(MSG.saveFailed, { cause: r.error });
  }, { label: 'users.trainingOptIn' });
  await clearPendingTrainingOptIn();
}

/**
 * Выбор галочки «Обучение модели» из онбординга (WelcomeScreen.tsx, T6.1-F замечание 1). На момент онбординга
 * анонимная сессия ещё может не существовать и сеть может быть недоступна — поэтому выбор сначала сохраняется
 * локально (prefs.ts), и только потом уходит на сервер. Если отправка не удалась, локальная отметка остаётся:
 * её подхватит syncPendingTrainingOptIn() при следующей возможности (сейчас — при каждом fetchProfile()).
 * Выбор пользователя не теряется молча ни в каком сценарии сбоя.
 */
export async function commitTrainingChoice(value: boolean): Promise<void> {
  await setPendingTrainingOptIn(value);
  try {
    await setTrainingOptIn(value); // сам гасит отложенный выбор при успехе
  } catch (e) {
    logError('profile.commitTrainingChoice', e);
  }
}

/** Подхватывает выбор из онбординга, который не удалось отправить сразу (см. commitTrainingChoice). */
export async function syncPendingTrainingOptIn(): Promise<void> {
  const pending = await getPendingTrainingOptIn();
  if (pending === null) return;
  try {
    await setTrainingOptIn(pending); // сам гасит отложенный выбор при успехе
  } catch (e) {
    logError('profile.syncPendingTrainingOptIn', e);
  }
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

/**
 * «Удалить данные на сервере» (consent-copy.md §6c). Сигнатура функции не меняется (её вызывает экран потока
 * E) — меняется только порядок вызовов внутри, по ревью T6.1-F, замечание 3:
 *
 *   1. lithos.list_my_photo_paths() — читает пути к фото в Storage, ничего не удаляет.
 *   2. Клиент стирает объекты Storage по этим путям. Ошибка Storage здесь — провал всей операции (в отличие
 *      от прежней версии): строки в БД ещё живы, поэтому просто выбрасываем ошибку и НЕ идём дальше — старый
 *      порядок (сначала удалить строки, потом стереть файлы по возвращённым путям) при обрыве сети между
 *      шагами терял пути навсегда и оставлял в Storage вечных сирот, хотя SERVER_WIPE_DIALOG обещает
 *      безвозвратное удаление снимков.
 *   3. lithos.delete_my_data() — удаляет строки (сканы, фото, карточки, дневник, публикации, сама users)
 *      каскадом, только после того как Storage подтвердил удаление.
 *
 * Идемпотентность повторного вызова после обрыва (0009_training_consent_and_safe_wipe.sql): list всегда читает
 * текущее состояние заново — если шаг 2 не был подтверждён, повтор снова получит те же пути и снова попробует
 * их стереть (Storage не ошибается на уже отсутствующих объектах); если шаг 2 уже прошёл, а оборвался шаг 3,
 * повтор получит пустой список путей и сразу перейдёт к удалению строк. Ни один путь к файлу не теряется молча.
 *
 * Диалог обещает «приложение откроется как в первый раз» — поэтому в конце вдобавок сбрасываем локальное
 * состояние, как в wipeLocalData(): иначе кэш и флаги на телефоне продолжат ссылаться на уже удалённого
 * пользователя.
 */
export async function deleteServerData(): Promise<void> {
  await ensureUser();

  const objectPaths = await withRetry(async (signal) => {
    const r = await supabase.rpc('list_my_photo_paths').abortSignal(signal);
    if (r.error) throw new UserError(MSG.saveFailed, { cause: r.error });
    const rows = (r.data as { storage_path: string | null }[] | null) ?? [];
    return rows.map((row) => row.storage_path).filter((p): p is string => typeof p === 'string' && p.length > 0);
  }, { label: 'users.listPhotoPaths' });

  if (objectPaths.length > 0) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(objectPaths);
    // Файлы должны исчезнуть ДО удаления строк (см. комментарий к функции) — ошибка здесь останавливает всю
    // операцию, а не только логируется: строки в БД остаются, повторный вызов доведёт дело до конца.
    if (error) throw new UserError(MSG.saveFailed, { cause: error });
  }

  await withRetry(async (signal) => {
    const r = await supabase.rpc('delete_my_data').abortSignal(signal);
    if (r.error) throw new UserError(MSG.saveFailed, { cause: r.error });
  }, { label: 'users.deleteMyData' });

  await AsyncStorage.clear();
  await supabase.auth.signOut().catch(() => { /* сессии уже нет — не критично */ });
  resetAuthCache();
}

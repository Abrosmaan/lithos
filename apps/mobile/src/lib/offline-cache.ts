// Офлайн (dev-plan T3.2): карточки и дневник кэшируются в AsyncStorage при каждой удачной загрузке;
// без сети экраны показывают кэш с пометкой. Читаем через те же парсеры, что и ответы БД.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureUser } from './auth';
import { type CardRow, parseCardRow } from './card-types';
import { listAllCards, listDiary } from './cards';
import { type DiaryRow, parseDiaryRow } from './diary';
import { logError, UserError } from './errors';

const CARDS_KEY = 'lithos.cache.cards';
const DIARY_KEY = 'lithos.cache.diary';
const OWNER_KEY = 'lithos.cache.owner';
const CACHE_VERSION = 1;

/**
 * Кэш ключуется по users.id, чтобы смена сессии не показала чужую коллекцию. Офлайн ensureUser может не
 * ответить (нет строки в памяти) — тогда берём последнего известного владельца из AsyncStorage.
 */
async function owner(): Promise<string | null> {
  try {
    const { userId } = await ensureUser();
    try { await AsyncStorage.setItem(OWNER_KEY, userId); } catch { /* не критично */ }
    return userId;
  } catch {
    try { return await AsyncStorage.getItem(OWNER_KEY); } catch { return null; }
  }
}
const keyFor = (base: string, userId: string) => `${base}.v${CACHE_VERSION}.${userId}`;

async function readList<T>(base: string, parse: (raw: unknown) => T | null): Promise<T[] | null> {
  try {
    const userId = await owner();
    if (!userId) return null;
    const raw = await AsyncStorage.getItem(keyFor(base, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(parse).filter((x): x is T => x !== null) : null;
  } catch (e) {
    logError('cache.read', e);
    return null;
  }
}

async function writeList(base: string, list: unknown[]): Promise<void> {
  try {
    const userId = await owner();
    if (userId) await AsyncStorage.setItem(keyFor(base, userId), JSON.stringify(list));
  } catch (e) { logError('cache.write', e); }
}

export const readCachedCards = () => readList(CARDS_KEY, parseCardRow);
export const readCachedDiary = () => readList(DIARY_KEY, parseDiaryRow);

export interface CachedLoad<T> {
  data: T;
  /** true — сеть недоступна, показан кэш. */
  offline: boolean;
}

/**
 * Сеть → кэш обновлён; сетевая ошибка (таймаут, обрыв) → кэш с пометкой offline, если есть; постоянная
 * ошибка (RLS, схема — UserError.retryable=false) → наверх: это не «нет связи», прятать её за кэшем нельзя.
 */
async function loadWithCache<T>(fetch: () => Promise<T[]>, key: string, read: () => Promise<T[] | null>): Promise<CachedLoad<T[]>> {
  try {
    const data = await fetch();
    void writeList(key, data);
    return { data, offline: false };
  } catch (e) {
    if (e instanceof UserError && !e.retryable) throw e;
    const cached = await read();
    if (cached === null) throw e;
    logError('cache.fallback', e);
    return { data: cached, offline: true };
  }
}

/** Все карточки (включая скрытые — их отфильтрует экран). */
export const loadCards = (): Promise<CachedLoad<CardRow[]>> => loadWithCache(listAllCards, CARDS_KEY, readCachedCards);
export const loadDiary = (): Promise<CachedLoad<DiaryRow[]>> => loadWithCache(listDiary, DIARY_KEY, readCachedDiary);

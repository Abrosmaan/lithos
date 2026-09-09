// Локальные флаги в AsyncStorage: экран безопасности раскола показан; карточки, отмеченные «в коллекции».
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAFETY_ACK_KEY = 'lithos.split_safety_ack';
const COLLECTED_KEY = 'lithos.collected_cards';

export async function isSafetyAcknowledged(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SAFETY_ACK_KEY)) === '1'; } catch { return false; }
}
export async function acknowledgeSafety(): Promise<void> {
  try { await AsyncStorage.setItem(SAFETY_ACK_KEY, '1'); } catch { /* не критично: покажем ещё раз */ }
}

async function readCollected(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(COLLECTED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
export async function isCardCollected(cardId: string): Promise<boolean> {
  return (await readCollected()).includes(cardId);
}
export async function markCardCollected(cardId: string): Promise<void> {
  try {
    const list = await readCollected();
    if (!list.includes(cardId)) await AsyncStorage.setItem(COLLECTED_KEY, JSON.stringify([...list, cardId].slice(-500)));
  } catch { /* не критично */ }
}

// ---------------------------------------------------------------------------
// Онбординг (дизайн T5.2): приветствие показываем один раз, подсказку первого запуска на камере — один раз.
// ---------------------------------------------------------------------------

const WELCOME_SEEN_KEY = 'lithos.welcome_seen';
const FIRST_RUN_HINT_KEY = 'lithos.first_run_hint_seen';

async function readFlag(key: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(key)) === '1'; } catch { return false; }
}
async function writeFlag(key: string): Promise<void> {
  try { await AsyncStorage.setItem(key, '1'); } catch { /* не критично: покажем ещё раз */ }
}

export const isWelcomeSeen = (): Promise<boolean> => readFlag(WELCOME_SEEN_KEY);
export const markWelcomeSeen = (): Promise<void> => writeFlag(WELCOME_SEEN_KEY);
export const isFirstRunHintSeen = (): Promise<boolean> => readFlag(FIRST_RUN_HINT_KEY);
export const markFirstRunHintSeen = (): Promise<void> => writeFlag(FIRST_RUN_HINT_KEY);

// ---------------------------------------------------------------------------
// Версия согласия (T6.1 поток F, docs/legal/consent-copy.md): витрина стала публикацией — кто уже видел
// старую формулировку («не публикуются и не показываются другим»), должен увидеть ConsentScreen один раз.
// ---------------------------------------------------------------------------

const CONSENT_VERSION_KEY = 'lithos.consent_version';

/** Текущая версия согласия. Поднимать при следующем существенном изменении политики/онбординга. */
export const CONSENT_VERSION = 2;

/** Версия, которую пользователь подтвердил. 0 — ключ не читается или отсутствует (в т.ч. версии до пересогласия). */
export async function getConsentVersion(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(CONSENT_VERSION_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function markConsentVersion(version: number = CONSENT_VERSION): Promise<void> {
  try {
    await AsyncStorage.setItem(CONSENT_VERSION_KEY, String(version));
  } catch {
    /* не критично: покажем экран пересогласия ещё раз */
  }
}

// ---------------------------------------------------------------------------
// Выбор галочки «Обучение модели» из онбординга (T6.1 поток F, ревью замечание 1): на момент онбординга
// анонимная сессия может быть ещё не создана или сеть недоступна, поэтому выбор пользователя сначала
// сохраняется здесь, локально, и только потом пробует уехать на сервер (lib/profile.ts#commitTrainingChoice /
// #syncPendingTrainingOptIn). Значение не теряется молча, даже если запись на сервер не удалась ни разу.
// ---------------------------------------------------------------------------

const TRAINING_OPT_IN_PENDING_KEY = 'lithos.training_opt_in_pending';

/** null — синхронизировать нечего (либо ещё не выбирали, либо выбор уже уехал на сервер). */
export async function getPendingTrainingOptIn(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(TRAINING_OPT_IN_PENDING_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export async function setPendingTrainingOptIn(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAINING_OPT_IN_PENDING_KEY, value ? '1' : '0');
  } catch {
    /* AsyncStorage недоступен — попытка отправить выбор на сервер всё равно произойдёт сразу же следом
     * (commitTrainingChoice), просто без локальной подстраховки на случай именно сетевого сбоя. */
  }
}

export async function clearPendingTrainingOptIn(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRAINING_OPT_IN_PENDING_KEY);
  } catch {
    /* не критично: следующая попытка синхронизации просто повторит тот же (уже применённый) запрос. */
  }
}

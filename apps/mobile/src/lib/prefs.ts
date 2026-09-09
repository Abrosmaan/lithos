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

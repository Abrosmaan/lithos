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

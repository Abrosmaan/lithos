// Витрина (spec §8): до 12 карточек, выбор локальный (AsyncStorage), без шеринга в прототипе.
import { SHOWCASE_MAX } from '@lithos/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

export { SHOWCASE_MAX };
const SHOWCASE_KEY = 'lithos.showcase';

export type ToggleResult = { list: string[]; status: 'added' | 'removed' | 'full' };

/** Чистое переключение: добавить в конец или убрать; при переполнении — список не меняется, status='full'. */
export function toggleShowcase(list: readonly string[], cardId: string, max: number = SHOWCASE_MAX): ToggleResult {
  if (list.includes(cardId)) return { list: list.filter((id) => id !== cardId), status: 'removed' };
  if (list.length >= max) return { list: [...list], status: 'full' };
  return { list: [...list, cardId], status: 'added' };
}

export async function readShowcase(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SHOWCASE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, SHOWCASE_MAX) : [];
  } catch { return []; }
}

export async function writeShowcase(list: readonly string[]): Promise<void> {
  try { await AsyncStorage.setItem(SHOWCASE_KEY, JSON.stringify(list.slice(0, SHOWCASE_MAX))); } catch { /* локальная витрина, не критично */ }
}

/** Убирает id карточек, которых больше нет среди видимых (удалены/скрыты); при изменении — перезаписывает. */
export async function pruneShowcase(list: readonly string[], visibleIds: ReadonlySet<string>): Promise<string[]> {
  const kept = list.filter((id) => visibleIds.has(id));
  if (kept.length !== list.length) await writeShowcase(kept);
  return kept;
}

export async function toggleShowcaseCard(cardId: string): Promise<ToggleResult> {
  const res = toggleShowcase(await readShowcase(), cardId);
  if (res.status !== 'full') await writeShowcase(res.list);
  return res;
}

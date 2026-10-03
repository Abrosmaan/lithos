// Витрина (spec §8, историческая): раньше — до 12 карточек локально в AsyncStorage. T6.1 поток E: витрина
// стала публикацией (lib/publish.ts, setPublished, cards.published) — CardScreen больше не пишет в этот
// локальный список. Он остаётся только на чтение (readShowcase) — как источник для разового переноса ниже
// (planShowcaseMigration) и как чистая функция toggleShowcase, которую использует lib/stats.test.ts (вне
// границ этой задачи — не трогать). writeShowcase/pruneShowcase/toggleShowcaseCard удалены в T6.1-E3: экраны
// на них больше не ссылались (ProfileScreen читал их только для витрины, которая стала «Мои публикации» —
// docs/tasks/T6.1-E3-profile.md), а запись в локальный список никому больше не нужна.
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

// ---------------------------------------------------------------------------
// T6.1 поток E: разовый перенос локальной витрины на сервер (T6.0 §2.2 — молча публиковать нельзя).
// ---------------------------------------------------------------------------

/** Минимум полей карточки, нужный, чтобы решить, можно ли предложить её к публикации. */
interface MigratableCard {
  id: string;
  hidden: boolean;
  verification: string;
  published: boolean;
}

/**
 * По старому локальному списку витрины и текущим карточкам решает, что можно предложить опубликовать:
 * карточка должна существовать, не быть скрытой (раскол) или на проверке (pending_review) — сервер их всё
 * равно отклонит (lithos.publish_card) — и ещё не быть опубликованной. Порядок — как в старом списке.
 * Чистая функция, без AsyncStorage — побочный эффект «перенос выполнен» отмечает markShowcaseMigrationDone.
 */
export function planShowcaseMigration<T extends MigratableCard>(oldList: readonly string[], cards: readonly T[]): T[] {
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  return oldList.flatMap((id) => {
    const c = byId.get(id);
    return c && !c.hidden && c.verification !== 'pending_review' && !c.published ? [c] : [];
  });
}

const SHOWCASE_MIGRATION_DONE_KEY = 'lithos.showcase_migration_done';

/** true — перенос старой витрины уже предложен (независимо от решения пользователя), больше не спрашивать. */
export async function isShowcaseMigrationDone(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SHOWCASE_MIGRATION_DONE_KEY)) === '1'; } catch { return false; }
}
export async function markShowcaseMigrationDone(): Promise<void> {
  try { await AsyncStorage.setItem(SHOWCASE_MIGRATION_DONE_KEY, '1'); } catch { /* не критично: спросим ещё раз */ }
}

// ---------------------------------------------------------------------------
// T6.1 поток E: «полное объяснение уже показывали» (consent-copy.md §3) — полный текст диалога публикации
// один раз, дальше короткая версия. Отдельный ключ, не lib/prefs.ts (вне границ задачи).
// ---------------------------------------------------------------------------

const PUBLISH_EXPLAINED_KEY = 'lithos.publish_explained';

export async function isPublishExplained(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PUBLISH_EXPLAINED_KEY)) === '1'; } catch { return false; }
}
export async function markPublishExplained(): Promise<void> {
  try { await AsyncStorage.setItem(PUBLISH_EXPLAINED_KEY, '1'); } catch { /* не критично: покажем полный текст ещё раз */ }
}

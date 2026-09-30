// Список пород для пикера исправления вердикта (T7.1, поток B, CardScreen). Тот же справочник, что
// принимает lithos.record_label (66 кодов ROCK_CLASSES из packages/shared, проверены FK на
// lithos.rock_classes в 0014_label_integrity.sql) — свободный текст на сервер не отправить, поэтому
// выбор всегда из этого списка. Чистый модуль: без сети, без React, группировка и поиск — обычные функции.
import { ROCK_CLASS_GROUP, ROCK_CLASS_RU, ROCK_CLASSES, ROCK_GROUPS, type RockClass, type RockGroup } from '@lithos/shared';

const ROCK_GROUP_TITLE_RU: Record<RockGroup, string> = {
  igneous: 'Магматические',
  sedimentary: 'Осадочные',
  metamorphic: 'Метаморфические',
  other: 'Особые находки',
  unknown: 'Неопределённые',
};

export interface RockPickerItem {
  code: RockClass;
  nameRu: string;
}

export interface RockPickerGroup {
  key: RockGroup;
  title: string;
  items: RockPickerItem[];
}

/** Без Intl.Collator (Hermes на части устройств без локалей, как formatDateRu в card-facts.ts) — обычное сравнение строк. */
function byNameRu(a: RockPickerItem, b: RockPickerItem): number {
  return a.nameRu < b.nameRu ? -1 : a.nameRu > b.nameRu ? 1 : 0;
}

/** Полный справочник, сгруппированный по литологии и отсортированный по русскому имени — источник для пикера. */
export function rockPickerGroups(): RockPickerGroup[] {
  return ROCK_GROUPS.map((key) => ({
    key,
    title: ROCK_GROUP_TITLE_RU[key],
    items: ROCK_CLASSES.filter((c) => ROCK_CLASS_GROUP[c] === key)
      .map((code) => ({ code, nameRu: ROCK_CLASS_RU[code] }))
      .sort(byNameRu),
  })).filter((g) => g.items.length > 0);
}

/** Фильтр по подстроке русского имени, регистронезависимо; пустой запрос — без изменений, группы без совпадений скрываются. */
export function filterRockPickerGroups(groups: RockPickerGroup[], query: string): RockPickerGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.nameRu.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);
}

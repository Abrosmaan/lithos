// Настройки профиля (экран 13 прототипа): строки списка, окно счётчика сканов, статусы разрешений, версия,
// текст о данных. Чистый модуль — без Supabase и нативных вызовов (тестируется в vitest).
// Лимит сканов — только из @lithos/shared (scanLimitFor / MAX_SCANS_PER_DAY), чисел здесь нет.
import { MAX_SCANS_PER_DAY, scanLimitFor } from '@lithos/shared';

/** Статус разрешения в терминах expo-modules-core PermissionStatus + «ещё не читали». */
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export function toPermissionState(status: string | null | undefined): PermissionState {
  return status === 'granted' || status === 'denied' || status === 'undetermined' ? status : 'unknown';
}

const CAMERA_PERMISSION_RU: Record<PermissionState, string> = {
  granted: 'Разрешён',
  denied: 'Запрещён',
  undetermined: 'Не запрошен',
  unknown: '—',
};

/** Геопозиция запрашивается только «при использовании» (app.json) — так и подписываем. */
const GEO_PERMISSION_RU: Record<PermissionState, string> = {
  granted: 'При использовании',
  denied: 'Запрещена',
  undetermined: 'Не запрошена',
  unknown: '—',
};

/** Лимит сканов в сутки для аккаунта: по возрасту (shared), без даты создания — базовый MAX_SCANS_PER_DAY. */
export function scanLimitForAccount(accountCreatedAt: string | null, now: number = Date.now()): number {
  return accountCreatedAt ? scanLimitFor(accountCreatedAt, now) : MAX_SCANS_PER_DAY;
}

/** Окно счётчика «сканов сегодня» — скользящие сутки, как в lithos.scan_limit_exceeded (spec §13). */
const DAY_MS = 24 * 3_600_000;
export function scanWindowStart(now: number = Date.now()): string {
  return new Date(now - DAY_MS).toISOString();
}

/** Сколько отметок времени попадает в скользящие сутки до now (для локального подсчёта по кэшу). */
export function countInScanWindow(createdAts: readonly string[], now: number = Date.now()): number {
  const from = now - DAY_MS;
  return createdAts.filter((iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t > from && t <= now; }).length;
}

/** «4 из 10»; счётчик ещё не загружен — «— из 10». */
export function scansTodayText(used: number | null, limit: number): string {
  return `${used === null ? '—' : used} из ${limit}`;
}

/** «Lithos 1.0.0 · сборка 12»; без номера сборки — «Lithos 1.0.0». */
export function appVersionText(version: string | null | undefined, build: string | null | undefined): string {
  const v = version && version.length > 0 ? version : '0.0.0';
  return build && build.length > 0 ? `Lithos ${v} · сборка ${build}` : `Lithos ${v}`;
}

export type SettingKey = 'scans' | 'language' | 'notifications' | 'camera' | 'location' | 'about' | 'privacy' | 'wipe';

export interface SettingsRow {
  key: SettingKey;
  label: string;
  value: string;
  danger?: boolean;
}

export interface SettingsInput {
  scansToday: number | null;
  scanLimit: number;
  camera: PermissionState;
  location: PermissionState;
  version: string;
}

/** Список настроек в порядке прототипа (строки 1469–1477). Языка и уведомлений в прототипе нет — честные значения. */
export function settingsRows(input: SettingsInput): SettingsRow[] {
  return [
    { key: 'scans', label: 'Сканов сегодня', value: scansTodayText(input.scansToday, input.scanLimit) },
    { key: 'language', label: 'Язык', value: 'Русский' },
    { key: 'notifications', label: 'Уведомления', value: 'Выключены' },
    { key: 'camera', label: 'Доступ к камере', value: CAMERA_PERMISSION_RU[input.camera] },
    { key: 'location', label: 'Геопозиция', value: GEO_PERMISSION_RU[input.location] },
    { key: 'about', label: 'О приложении', value: input.version },
    { key: 'privacy', label: 'Приватность и данные', value: '' },
    { key: 'wipe', label: 'Удалить все данные', value: '', danger: true },
  ];
}

/** Текст о данных — тот же, что в карточке «Что мы делаем с фото» на приветствии (прототип, строка 92). */
export const PRIVACY_TEXT =
  'Мы храним все снимки камней и учим на них модель определять породы точнее — без этого вердикт остаётся приблизительным. ' +
  'Снимки не привязаны к имени, не публикуются и не показываются другим пользователям. ' +
  'Регистрация не нужна: приложение работает анонимно, коллекция привязана к этому телефону.';

/** Тексты диалога «Удалить все данные»: стираем только телефон, записи в базе остаются. */
export const WIPE_DIALOG = {
  title: 'Удалить все данные?',
  body: 'С этого телефона будут стёрты коллекция, витрина, кэш и настройки, сессия сброшена — откроется новый анонимный профиль. Записи в базе (сканы, фото, карточки) не удаляются.',
  confirm: 'Удалить',
  cancel: 'Отмена',
} as const;

/** Вход через Apple: бэкенда нет — одна честная фраза, ничего сверх. */
export const APPLE_SIGNIN_SOON = 'Скоро: вход через Apple, чтобы коллекция пережила смену телефона';

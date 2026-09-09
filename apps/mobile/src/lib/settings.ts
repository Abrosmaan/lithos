// Настройки профиля (экран 13 прототипа): строки списка, окно счётчика сканов, статусы разрешений, версия,
// текст о данных. Чистый модуль — без Supabase и нативных вызовов (тестируется в vitest).
// Лимит сканов — только из @lithos/shared (scanLimitFor / MAX_SCANS_PER_DAY), чисел здесь нет.
import { MAX_SCANS_PER_DAY, scanLimitFor, SHOWCASE_MAX } from '@lithos/shared';

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

export type SettingKey =
  | 'scans'
  | 'language'
  | 'notifications'
  | 'camera'
  | 'location'
  | 'about'
  | 'privacy'
  | 'publications'
  | 'training'
  | 'privacyPolicy'
  | 'termsOfUse'
  | 'serverWipe'
  | 'wipe';

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
  /** Сколько карточек сейчас в витрине (published=true на сервере); undefined/null — поток E ещё не подключил чтение. */
  publishedCount?: number | null;
  /** lithos.users.training_opt_in; null/undefined — ещё не загружено. */
  trainingOptIn?: boolean | null;
}

/** «3 из 12»; ничего не опубликовано — «Нет»; ещё не загружено — «—» (consent-copy.md §6a). */
export function publicationsValueText(publishedCount: number | null | undefined, max: number = SHOWCASE_MAX): string {
  if (publishedCount == null) return '—';
  return publishedCount === 0 ? 'Нет' : `${publishedCount} из ${max}`;
}

/** «Разрешено» / «Отключено»; ещё не загружено — «—» (consent-copy.md §6b). */
export function trainingValueText(trainingOptIn: boolean | null | undefined): string {
  if (trainingOptIn == null) return '—';
  return trainingOptIn ? 'Разрешено' : 'Отключено';
}

/**
 * Список настроек в порядке прототипа (строки 1469–1477) + новые пункты compliance (T6.0 часть 3, consent-copy.md
 * §6), вставленные после «Приватность и данные» и перед «Удалить все данные». Языка и уведомлений в прототипе
 * нет — честные значения. Обработку press (кроме camera/location/privacy/about/wipe) подключает поток E.
 */
export function settingsRows(input: SettingsInput): SettingsRow[] {
  return [
    { key: 'scans', label: 'Сканов сегодня', value: scansTodayText(input.scansToday, input.scanLimit) },
    { key: 'language', label: 'Язык', value: 'Русский' },
    { key: 'notifications', label: 'Уведомления', value: 'Выключены' },
    { key: 'camera', label: 'Доступ к камере', value: CAMERA_PERMISSION_RU[input.camera] },
    { key: 'location', label: 'Геопозиция', value: GEO_PERMISSION_RU[input.location] },
    { key: 'about', label: 'О приложении', value: input.version },
    { key: 'privacy', label: 'Приватность и данные', value: '' },
    { key: 'publications', label: 'Мои публикации', value: publicationsValueText(input.publishedCount) },
    { key: 'training', label: 'Обучение модели', value: trainingValueText(input.trainingOptIn) },
    { key: 'privacyPolicy', label: 'Политика конфиденциальности', value: '' },
    { key: 'termsOfUse', label: 'Пользовательское соглашение', value: '' },
    { key: 'serverWipe', label: 'Удалить данные на сервере', value: '', danger: true },
    { key: 'wipe', label: 'Удалить все данные', value: '', danger: true },
  ];
}

/** Текст о данных (consent-copy.md §5) — «Приватность и данные» в профиле. Витрина = публикация, не молчание. */
export const PRIVACY_TEXT =
  'Снимки камней хранятся у нас: по ним модель определяет породу, и на них же мы учим её работать точнее. ' +
  'Фото уходит к моделям Anthropic и Google для определения — на своих моделях они его не учат.\n\n' +
  'Ваши находки по умолчанию видны только вам. Опубликованными становятся те, что вы добавили в витрину: у них ' +
  'другие видят фото, породу, тир, ваше имя и место с точностью около километра — точных координат не видит ' +
  'никто. Убрать из витрины можно в любой момент.\n\n' +
  'Регистрация не нужна: приложение работает анонимно, аккаунт не привязан к почте, телефону или соцсетям. ' +
  'Сырые ответы моделей храним 90 дней. Удалить данные — кнопками ниже.';

/** Пояснение под списком «Мои публикации», когда есть хотя бы одна публикация (consent-copy.md §6a). */
export const PUBLICATIONS_TEXT =
  'Опубликованные находки видны другим в витрине и на карте. Чтобы убрать любую, откройте её карточку и нажмите «Убрать из витрины».';

/** То же место, если публикаций нет (consent-copy.md §6a). */
export const PUBLICATIONS_EMPTY_TEXT = 'Вы пока ничего не опубликовали. Все находки видны только вам.';

/** Пояснение под переключателем «Обучение модели» (consent-copy.md §6b). */
export const TRAINING_TEXT =
  'Мы учим свою модель определять породы на снимках пользователей. Можно отключить — тогда ваши новые и ' +
  'сохранённые снимки не попадут в будущие обучающие выборки. То, чему модель уже научилась, отменить нельзя: ' +
  '«разучиться» она не может.';

/** Подтверждение при выключении переключателя «Обучение модели» (consent-copy.md §6b). */
export const TRAINING_OPT_OUT_DIALOG = {
  title: 'Отключить обучение?',
  body: 'Ваши снимки перестанут попадать в обучающие выборки. Определение породы продолжит работать как раньше.',
  confirm: 'Отключить',
  cancel: 'Отмена',
} as const;

/** Тексты диалога «Удалить все данные»: стираем только телефон, записи в базе остаются. */
export const WIPE_DIALOG = {
  title: 'Удалить все данные?',
  body: 'С этого телефона будут стёрты коллекция, витрина, кэш и настройки, сессия сброшена — откроется новый анонимный профиль. Записи в базе (сканы, фото, карточки) не удаляются.',
  confirm: 'Удалить',
  cancel: 'Отмена',
} as const;

/**
 * Тексты диалога «Удалить данные на сервере» (consent-copy.md §6c) — отдельно от WIPE_DIALOG (тот стирает
 * только телефон). До появления lib/profile.ts#deleteServerData этот пункт в UI показывать нельзя.
 */
export const SERVER_WIPE_DIALOG = {
  title: 'Удалить всё с сервера?',
  body:
    'Навсегда исчезнут: все карточки, все снимки, сканы, дневник мест и публикации. Опубликованные находки ' +
    'пропадут с чужих карт. Восстановить не получится — резервной копии для вас у нас нет.\n\n' +
    'Приложение останется установленным и откроется как в первый раз.',
  confirm: 'Удалить навсегда',
  cancel: 'Отмена',
} as const;

export const SERVER_WIPE_DONE = 'Данные удалены. Приложение открыто заново.';
export const SERVER_WIPE_FAILED = 'Не получилось удалить данные. Проверьте связь и попробуйте ещё раз.';

/** Вход через Apple: бэкенда нет — одна честная фраза, ничего сверх. */
export const APPLE_SIGNIN_SOON = 'Скоро: вход через Apple, чтобы коллекция пережила смену телефона';

// Ошибки для пользователя — только русские тексты, без текста ошибок сервера.

export const MSG = {
  blurry: 'Фото размыто — переснимите ближе и при хорошем свете.',
  dark: 'Слишком темно или нет деталей — переснимите при хорошем свете.',
  noGeo: 'Без геопозиции карточка будет без редкости',
  captureFailed: 'Не удалось сделать фото. Попробуйте ещё раз.',
  authFailed: 'Не удалось подключиться к серверу. Проверьте интернет и попробуйте ещё раз.',
  uploadFailed: 'Не удалось загрузить фото. Проверьте интернет и попробуйте ещё раз.',
  submitFailed: 'Не удалось отправить скан. Проверьте интернет и попробуйте ещё раз.',
  photoCount: 'Нужно от 1 до 3 фото.',
  loadFailed: 'Не удалось загрузить данные. Проверьте интернет и попробуйте ещё раз.',
  saveFailed: 'Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.',
  envMissing: 'Приложение не настроено. Обновите его или обратитесь к разработчику.',
} as const;

/** Постоянные отказы (RLS, схема не открыта, неверный запрос) — повторять бессмысленно. */
export function isPermanentError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = Number(o.status ?? o.statusCode);
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  const code = typeof o.code === 'string' ? o.code : '';
  // PostgREST (PGRST1xx/2xx/3xx: схема/функция/запрос), Postgres 42xxx (права/синтаксис), 23xxx (целостность)
  return /^PGRST[123]/.test(code) || /^(42|23)/.test(code);
}

export class UserError extends Error {
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(userMessage: string, options: { cause?: unknown; retryable?: boolean } = {}) {
    super(userMessage);
    this.name = 'UserError';
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? !isPermanentError(options.cause);
    this.cause = options.cause;
  }
}

export function toUserMessage(e: unknown, fallback: string = MSG.submitFailed): string {
  return e instanceof UserError ? e.userMessage : fallback;
}

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/** Технические детали — только в dev-консоль, никогда в UI. */
export function logError(scope: string, e: unknown): void {
  if (isDev) {
    const cause = e instanceof UserError ? e.cause : e;
    console.warn(`[lithos:${scope}]`, cause instanceof Error ? cause.message : cause);
  }
}

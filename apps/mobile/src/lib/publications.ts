// Профиль, блок «Мои публикации» (T6.1 поток E3): текст диалога массового снятия с витрины и честный итог
// после Promise.allSettled — сеть (lib/publish.ts#setPublished) и Alert остаются в ProfileScreen, здесь только
// чистые данные, которые можно тестировать без react-native. Текста «убрать всё разом» в consent-copy.md нет
// (там есть только снятие одной находки, §3c) — сформулировано по аналогии, зафиксировано в docs/tasks/T6.1-E3-profile.md
// как хвост для переноса в consent-copy.md.

/** Текст — docs/legal/consent-copy.md §3d (источник истины по копирайту). */
export const UNPUBLISH_ALL_DIALOG = {
  title: 'Убрать все публикации?',
  body:
    'Все ваши находки исчезнут из витрины и с карт других пользователей — за один раз. Карточки и фото ' +
    'останутся у вас, опубликовать их снова можно в любой момент.',
  confirm: 'Убрать всё',
  cancel: 'Отмена',
} as const;

export interface BulkUnpublishResult {
  title: string;
  message: string;
}

/**
 * Итог массового снятия с витрины: Promise.allSettled может частично отказать (сеть моргнула на одной из N
 * находок) — сообщение обязано отражать реальность, а не молчать об отказавших. succeeded — сколько из total
 * подтвердил сервер.
 */
export function summarizeBulkUnpublish(total: number, succeeded: number): BulkUnpublishResult {
  const failed = total - succeeded;
  if (total <= 0) return { title: 'Готово', message: 'Публикаций не было.' };
  if (failed <= 0) return { title: 'Готово', message: succeeded === 1 ? 'Находка убрана с витрины.' : `Убрано с витрины: ${succeeded}.` };
  if (succeeded === 0) return { title: 'Не получилось', message: 'Не удалось убрать ни одной находки с витрины. Проверьте связь и попробуйте ещё раз.' };
  return { title: 'Убрано частично', message: `Убрано с витрины: ${succeeded} из ${total}. Не получилось убрать: ${failed} — попробуйте ещё раз позже.` };
}

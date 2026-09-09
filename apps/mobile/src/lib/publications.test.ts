import { describe, expect, it } from 'vitest';
import { summarizeBulkUnpublish } from './publications';

describe('summarizeBulkUnpublish (профиль, «Убрать все»)', () => {
  it('полный успех, одна находка — единственное число', () => {
    expect(summarizeBulkUnpublish(1, 1)).toEqual({ title: 'Готово', message: 'Находка убрана с витрины.' });
  });

  it('полный успех, несколько находок', () => {
    expect(summarizeBulkUnpublish(3, 3)).toEqual({ title: 'Готово', message: 'Убрано с витрины: 3.' });
  });

  it('частичный отказ — честно называет обе цифры, не врёт об успехе', () => {
    const r = summarizeBulkUnpublish(5, 3);
    expect(r.title).toBe('Убрано частично');
    expect(r.message).toContain('3 из 5');
    expect(r.message).toContain('2');
  });

  it('полный отказ — не говорит «готово»', () => {
    const r = summarizeBulkUnpublish(2, 0);
    expect(r.title).toBe('Не получилось');
    expect(r.message).not.toMatch(/готово/i);
  });

  it('нечего было снимать', () => {
    expect(summarizeBulkUnpublish(0, 0)).toEqual({ title: 'Готово', message: 'Публикаций не было.' });
  });
});

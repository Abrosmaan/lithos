// Тексты согласия на публикацию: проверяем, что ни один вариант не теряет того, на что человек соглашается.
import { describe, expect, it } from 'vitest';
import { PUBLISH_DIALOG, PUBLISH_DIALOG_SHORT } from './consent';
import { publishDialogCopy } from './publish-copy';

/** Самое существенное из §3a: другим видна точка на карте. */
const MAP_CLAUSE = 'на карте';

/**
 * Самое существенное после решения владельца от 2026-10-03: место находки, которое видят другие, — точное,
 * та же точка, что видит сам человек, а не ячейка geohash-6 или примерный район. Эта фраза должна пережить
 * любую подстановку («имени нет», «места нет») так же надёжно, как раньше переживала MAP_CLAUSE.
 */
const EXACT_PLACE_CLAUSE = 'точное место находки';

describe('publishDialogCopy', () => {
  it('первая публикация с именем — текст §3a слово в слово', () => {
    const c = publishDialogCopy({ explained: false, hasName: true, hasGeo: true });
    expect(c.title).toBe(PUBLISH_DIALOG.title);
    expect(c.body).toBe(PUBLISH_DIALOG.body);
  });

  it('без имени — упоминание имени заменено, но предупреждение о точном месте цело', () => {
    const c = publishDialogCopy({ explained: false, hasName: false, hasGeo: true });
    expect(c.body).toContain(MAP_CLAUSE);
    expect(c.body).toContain(EXACT_PLACE_CLAUSE);
    expect(c.body).toContain('не примерный район');
    expect(c.body).toContain('без подписи');
    expect(c.body).not.toContain('ваше имя');
    // Остальные абзацы §3a («рядом с домом…», «не увидят…», «убрать можно…») не пострадали.
    expect(c.body).toContain('рядом с домом');
    expect(c.body).toContain('Не увидят: ваши остальные карточки');
    expect(c.body).toContain('Убрать из витрины можно в любой момент');
    expect(c.body).toContain('это не отменить');
  });

  it('без гео — добавлена оговорка, ничего не потеряно', () => {
    const c = publishDialogCopy({ explained: false, hasName: true, hasGeo: false });
    expect(c.body.startsWith(PUBLISH_DIALOG.body)).toBe(true);
    expect(c.body).toContain('не появится на карте');
  });

  it('без имени и без гео — обе оговорки на месте', () => {
    const c = publishDialogCopy({ explained: false, hasName: false, hasGeo: false });
    expect(c.body).toContain('без подписи');
    expect(c.body).toContain('не появится на карте');
    expect(c.body).toContain(MAP_CLAUSE);
    expect(c.body).toContain(EXACT_PLACE_CLAUSE);
  });

  it('повторная публикация — короткая версия §3b, оговорки применяются так же', () => {
    const c = publishDialogCopy({ explained: true, hasName: true, hasGeo: true });
    expect(c.body).toBe(PUBLISH_DIALOG_SHORT.body);
    expect(c.body).toContain(EXACT_PLACE_CLAUSE);
    const noName = publishDialogCopy({ explained: true, hasName: false, hasGeo: true }).body;
    expect(noName).not.toContain('ваше имя');
    expect(noName).toContain(EXACT_PLACE_CLAUSE);
    expect(publishDialogCopy({ explained: true, hasName: true, hasGeo: false }).body).toContain('не появится на карте');
  });

  it('любой вариант сохраняет кнопки из consent.ts', () => {
    for (const explained of [false, true]) {
      const c = publishDialogCopy({ explained, hasName: false, hasGeo: false });
      expect(c.confirm).toBe('Опубликовать');
      expect(c.cancel).toBe('Отмена');
    }
  });
});

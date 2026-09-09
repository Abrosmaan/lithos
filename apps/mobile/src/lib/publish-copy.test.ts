// Тексты согласия на публикацию: проверяем, что ни один вариант не теряет того, на что человек соглашается.
import { describe, expect, it } from 'vitest';
import { PUBLISH_DIALOG, PUBLISH_DIALOG_SHORT } from './consent';
import { publishDialogCopy } from './publish-copy';

/** Самое существенное из §3a: другим видна точка на карте примерно в километре от места находки. */
const MAP_CLAUSE = 'на карте';

describe('publishDialogCopy', () => {
  it('первая публикация с именем — текст §3a слово в слово', () => {
    const c = publishDialogCopy({ explained: false, hasName: true, hasGeo: true });
    expect(c.title).toBe(PUBLISH_DIALOG.title);
    expect(c.body).toBe(PUBLISH_DIALOG.body);
  });

  it('без имени — упоминание имени заменено, но абзац про карту цел', () => {
    const c = publishDialogCopy({ explained: false, hasName: false, hasGeo: true });
    expect(c.body).toContain(MAP_CLAUSE);
    expect(c.body).toContain('километра от места находки');
    expect(c.body).toContain('без подписи');
    expect(c.body).not.toContain('ваше имя');
    // Остальные абзацы §3a («не увидят…», «убрать можно…») не пострадали.
    expect(c.body).toContain('Не увидят: точные координаты');
    expect(c.body).toContain('Убрать из витрины можно в любой момент');
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
  });

  it('повторная публикация — короткая версия §3b, оговорки применяются так же', () => {
    const c = publishDialogCopy({ explained: true, hasName: true, hasGeo: true });
    expect(c.body).toBe(PUBLISH_DIALOG_SHORT.body);
    expect(publishDialogCopy({ explained: true, hasName: false, hasGeo: true }).body).not.toContain('ваше имя');
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

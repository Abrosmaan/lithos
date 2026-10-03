import { SHOWCASE_MAX } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import {
  publicationsValueText,
  PRIVACY_TEXT,
  SERVER_WIPE_DIALOG,
  settingsRows,
  type SettingKey,
  trainingValueText,
  WIPE_DIALOG,
} from './settings';

const baseInput = { scansToday: 4, scanLimit: 10, camera: 'granted' as const, location: 'granted' as const, version: 'Lithos 1.0.0' };

describe('settingsRows', () => {
  it('новые пункты стоят между «Приватность и данные» и «Удалить все данные»', () => {
    const keys = settingsRows(baseInput).map((r) => r.key);
    const privacy = keys.indexOf('privacy');
    const wipe = keys.indexOf('wipe');
    for (const k of ['publications', 'training', 'privacyPolicy', 'termsOfUse', 'serverWipe'] as SettingKey[]) {
      const i = keys.indexOf(k);
      expect(i).toBeGreaterThan(privacy);
      expect(i).toBeLessThan(wipe);
    }
  });

  it('оба пункта удаления — danger', () => {
    const rows = settingsRows(baseInput);
    expect(rows.find((r) => r.key === 'wipe')?.danger).toBe(true);
    expect(rows.find((r) => r.key === 'serverWipe')?.danger).toBe(true);
  });

  it('значение «Мои публикации» и «Обучение модели» берётся из SettingsInput', () => {
    const rows = settingsRows({ ...baseInput, publishedCount: 3, trainingOptIn: false });
    expect(rows.find((r) => r.key === 'publications')?.value).toBe('3 из 12');
    expect(rows.find((r) => r.key === 'training')?.value).toBe('Отключено');
  });

  it('без данных потока E — честные заглушки, а не пустая строка', () => {
    const rows = settingsRows(baseInput);
    expect(rows.find((r) => r.key === 'publications')?.value).toBe('—');
    expect(rows.find((r) => r.key === 'training')?.value).toBe('—');
  });
});

describe('publicationsValueText', () => {
  it('null/undefined — «—»; 0 — «Нет»; иначе «N из MAX»', () => {
    expect(publicationsValueText(null)).toBe('—');
    expect(publicationsValueText(undefined)).toBe('—');
    expect(publicationsValueText(0)).toBe('Нет');
    expect(publicationsValueText(3)).toBe(`3 из ${SHOWCASE_MAX}`);
    expect(publicationsValueText(3, 12)).toBe('3 из 12');
  });
});

describe('trainingValueText', () => {
  it('null/undefined — «—»; true — «Разрешено»; false — «Отключено»', () => {
    expect(trainingValueText(null)).toBe('—');
    expect(trainingValueText(undefined)).toBe('—');
    expect(trainingValueText(true)).toBe('Разрешено');
    expect(trainingValueText(false)).toBe('Отключено');
  });
});

describe('тексты', () => {
  it('PRIVACY_TEXT не обещает то, чего больше нет (публикация теперь возможна)', () => {
    expect(PRIVACY_TEXT).not.toMatch(/не показываются другим/);
    expect(PRIVACY_TEXT).toMatch(/витрин/);
  });

  it('WIPE_DIALOG и SERVER_WIPE_DIALOG — разные тексты для разных операций', () => {
    expect(WIPE_DIALOG.title).not.toBe(SERVER_WIPE_DIALOG.title);
    expect(WIPE_DIALOG.body).toMatch(/этого телефона/);
    expect(SERVER_WIPE_DIALOG.body).toMatch(/сервера|Навсегда исчезнут/);
  });
});

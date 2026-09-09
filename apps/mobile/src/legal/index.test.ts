import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLegalMarkdown, splitInline } from './index';
import { PRIVACY_POLICY_MD } from './privacy-policy';
import { TERMS_OF_USE_MD } from './terms-of-use';

describe('parseLegalMarkdown', () => {
  it('заголовки, абзацы, список, таблица, цитата и разделитель — по одному блоку на элемент', () => {
    const md = [
      '# Заголовок документа',
      '',
      '## Раздел 1',
      '',
      '> Это черновик.',
      '> Вторая строка цитаты.',
      '',
      'Обычный абзац.',
      'Второй абзац — отдельная строка, отдельный блок.',
      '',
      '- Первый пункт',
      '- Второй пункт',
      '',
      '| Что | Зачем |',
      '|---|---|',
      '| Фото | Определение породы |',
      '| Гео | Дневник места |',
      '',
      '---',
      '',
      '## Раздел 2',
    ].join('\n');

    const blocks = parseLegalMarkdown(md);

    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Заголовок документа' },
      { type: 'heading', level: 2, text: 'Раздел 1' },
      { type: 'note', text: 'Это черновик. Вторая строка цитаты.' },
      { type: 'paragraph', text: 'Обычный абзац.' },
      { type: 'paragraph', text: 'Второй абзац — отдельная строка, отдельный блок.' },
      { type: 'list', items: ['Первый пункт', 'Второй пункт'] },
      {
        type: 'table',
        headers: ['Что', 'Зачем'],
        rows: [
          ['Фото', 'Определение породы'],
          ['Гео', 'Дневник места'],
        ],
      },
      { type: 'divider' },
      { type: 'heading', level: 2, text: 'Раздел 2' },
    ]);
  });

  it('пустой ввод — пустой список блоков', () => {
    expect(parseLegalMarkdown('')).toEqual([]);
    expect(parseLegalMarkdown('\n\n  \n')).toEqual([]);
  });

  it('реальные документы парсятся без ошибок и дают разумную структуру', () => {
    for (const md of [PRIVACY_POLICY_MD, TERMS_OF_USE_MD]) {
      const blocks = parseLegalMarkdown(md);
      expect(blocks.length).toBeGreaterThan(20);
      expect(blocks.filter((b) => b.type === 'heading' && b.level === 2).length).toBeGreaterThanOrEqual(9);
      expect(blocks.some((b) => b.type === 'table')).toBe(true);
      expect(blocks.some((b) => b.type === 'note')).toBe(true);
      // Ни одна строка не должна была случайно попасть в блок как «сырая» markdown-таблица/список.
      for (const b of blocks) {
        if (b.type === 'paragraph') expect(b.text.startsWith('|')).toBe(false);
      }
    }
  });
});

describe('splitInline', () => {
  it('без разметки — один обычный сегмент', () => {
    expect(splitInline('обычный текст')).toEqual([{ text: 'обычный текст' }]);
  });

  it('жирный и код внутри строки', () => {
    expect(splitInline('до **жирный** между `код` после')).toEqual([
      { text: 'до ' },
      { text: 'жирный', bold: true },
      { text: ' между ' },
      { text: 'код', code: true },
      { text: ' после' },
    ]);
  });

  it('разметка в начале и в конце строки', () => {
    expect(splitInline('**жирный** хвост')).toEqual([{ text: 'жирный', bold: true }, { text: ' хвост' }]);
    expect(splitInline('голова `код`')).toEqual([{ text: 'голова ' }, { text: 'код', code: true }]);
  });

  it('пустая строка — один пустой сегмент, не падает', () => {
    expect(splitInline('')).toEqual([{ text: '' }]);
  });
});

describe('копии документов в приложении = документы в docs/legal', () => {
  // Тексты переносятся в константы скриптом, чтобы экран работал офлайн. Раньше «побайтовая идентичность»
  // была заявлена в артефакте, но ничем не проверялась — и копии успели разъехаться с источником на лишний
  // перевод строки. Здесь это проверяется буквально: расходиться им нельзя, это юридический документ.
  const docs = resolve(import.meta.dirname, '../../../../docs/legal');
  const cases: readonly [string, string][] = [
    ['privacy-policy.ru.md', PRIVACY_POLICY_MD],
    ['terms-of-use.ru.md', TERMS_OF_USE_MD],
  ];

  for (const [file, constant] of cases) {
    it(`${file} совпадает символ в символ`, () => {
      expect(constant).toBe(readFileSync(resolve(docs, file), 'utf8'));
    });
  }
});

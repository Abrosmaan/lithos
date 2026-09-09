// Простой markdown → блоки, без внешней markdown-библиотеки (T6.1 поток F, задача 3).
// Понимает ровно то подмножество, которое использует docs/legal/*.ru.md: заголовки #/##, абзацы (одна
// строка — один абзац, как в исходниках), списки «- », таблицы GFM, блок-цитаты «>» и горизонтальные
// разделители «---». Источник текста — privacy-policy.ts/terms-of-use.ts (перенос markdown как есть).
import { PRIVACY_POLICY_MD } from './privacy-policy';
import { TERMS_OF_USE_MD } from './terms-of-use';

export type LegalBlock =
  | { type: 'heading'; level: 1 | 2; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'note'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'divider' };

function isTableRow(line: string): boolean {
  return /^\|.*\|$/.test(line);
}
function isTableSeparator(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}
function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

export function parseLegalMarkdown(md: string): LegalBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: LegalBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trim();

    if (line === '') {
      i++;
      continue;
    }
    if (line === '---') {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      blocks.push({ type: 'heading', level: 2, text: h2[1]! });
      i++;
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      blocks.push({ type: 'heading', level: 1, text: h1[1]! });
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const noteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        noteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'note', text: noteLines.join(' ').trim() });
      continue;
    }
    if (isTableRow(line)) {
      const headers = splitTableRow(line);
      i++;
      if (i < lines.length && isTableSeparator((lines[i] ?? '').trim())) i++;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow((lines[i] ?? '').trim())) {
        rows.push(splitTableRow((lines[i] ?? '').trim()));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('- ')) {
        items.push((lines[i] ?? '').trim().slice(2).trim());
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    blocks.push({ type: 'paragraph', text: line });
    i++;
  }

  return blocks;
}

export interface InlineSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
}

/** `**жирный**` и `` `код` `` внутри строки — для рендера без markdown-библиотеки. */
export function splitInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) segments.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) segments.push({ text: m[2], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  if (segments.length === 0) segments.push({ text: '' });
  return segments;
}

export interface LegalDocContent {
  title: string;
  blocks: LegalBlock[];
}

/** Заголовок экрана + разобранные блоки для PolicyScreen. Ключи — RootStackParamList['Policy']['doc']. */
export const LEGAL_DOCS: Record<'privacy' | 'terms', LegalDocContent> = {
  privacy: { title: 'Политика конфиденциальности', blocks: parseLegalMarkdown(PRIVACY_POLICY_MD) },
  terms: { title: 'Пользовательское соглашение', blocks: parseLegalMarkdown(TERMS_OF_USE_MD) },
};


// Поток A (T7.1) — инвариант по тексту миграции 0013_labels.sql (права сужены, RLS включён, нет политики
// чтения, метка не зависит от training_opt_in) + чистые функции разбора. По образцу apps/mobile/src/lib/publish.test.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROCK_CLASSES } from '@lithos/shared';
import { describe, expect, it, vi } from 'vitest';

// labels.ts тянет ./supabase и ./auth (сессия, RPC) — в проде react-native/expo-crypto; здесь тестируем только
// чистый разбор (parseLabelResult/isLabelSource), сеть не нужна. Тот же приём, что в publish.test.ts.
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./auth', () => ({ ensureUser: async () => ({ userId: 'test-user', deviceId: 'test-device' }) }));

const { isLabelSource, LABEL_SOURCES, latestLabel, parseLabelResult, parseMyLabelRow, parseMyLabelRows } = await import('./labels');

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../supabase/migrations');
const sql = readFileSync(resolve(MIGRATIONS_DIR, '0013_labels.sql'), 'utf8');
const sql0015 = readFileSync(resolve(MIGRATIONS_DIR, '0015_my_label.sql'), 'utf8');

const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/**
 * Действующее тело record_label по всем миграциям: функция пересоздаётся через `create or replace`, а править
 * уже применённую миграцию нельзя (CLAUDE.md), поэтому новое поведение приходит отдельным файлом. Читать
 * только 0013 значило бы проверять поведение, которого в базе больше нет.
 */
function effectiveRecordLabel(): string {
  let body = '';
  for (const f of migrationFiles()) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const m of text.matchAll(/create\s+or\s+replace\s+function\s+lithos\.record_label[\s\S]*?\$\$\s*;/gi)) body = m[0];
  }
  return body;
}

/** Справочник пород, засеянный миграциями (единственное разрешённое дублирование ROCK_CLASSES в SQL). */
function seededRockClasses(): string[] {
  const out: string[] = [];
  for (const f of migrationFiles()) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of text.matchAll(/insert\s+into\s+lithos\.rock_classes\s*\(\s*code\s*\)\s*values([\s\S]*?);/gi)) {
      for (const m of stmt[1]!.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)) out.push(m[1]!);
    }
  }
  return out;
}

describe('lithos.labels — инварианты по тексту миграции', () => {
  it('создаёт таблицу labels и enum источника метки', () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+lithos\.labels/i);
    expect(sql).toMatch(/create\s+type\s+lithos\.label_source\s+as\s+enum\s*\(\s*'user_confirm'\s*,\s*'user_correct'\s*,\s*'expert'\s*,\s*'golden'\s*\)/i);
  });

  it('уникальный ключ — скан + источник + автор', () => {
    expect(sql).toMatch(/unique\s*\(\s*scan_id\s*,\s*source\s*,\s*author_id\s*\)/i);
  });

  it('rock_class хранится строкой (не SQL-enum пород)', () => {
    expect(sql).toMatch(/rock_class\s+text\s+not\s+null/i);
    expect(sql).not.toMatch(/create\s+type\s+lithos\.rock_class/i);
  });

  it('RLS включён и политики чтения нет', () => {
    expect(sql).toMatch(/alter\s+table\s+lithos\.labels\s+enable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/create\s+policy[^;]*on\s+lithos\.labels/i);
    // Таблице не выдаётся ни один table-level грант authenticated/anon — читают только definer-функции.
    expect(sql).not.toMatch(/grant\s+(select|insert|update)[^;]*on\s+lithos\.labels\s+to\s+(authenticated|anon)/i);
  });

  it('права на record_label сужены: revoke от public, grant явно authenticated, не anon', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+lithos\.record_label\([^)]*\)\s+from\s+public\s*;/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+lithos\.record_label\([^)]*\)\s+to\s+authenticated\s*;/i);
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+lithos\.record_label\([^)]*\)\s+to\s+[^;]*\banon\b/i);
  });

  it('запись метки не фильтрует и не проверяет training_opt_in — согласие на обучение тут ни при чём', () => {
    const fnMatch = sql.match(/create\s+or\s+replace\s+function\s+lithos\.record_label[\s\S]*?\$\$\s*;/i);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/training_opt_in/);
  });

  it('явно документирует в комментариях, что training_opt_in не влияет на запись метки', () => {
    expect(sql).toMatch(/training_opt_in/);
    expect(sql).toMatch(/выгрузк[а-я]* обучающ/i);
  });

  it('запись метки вообще не трогает lithos.cards — ни породу, ни статус проверки', () => {
    // Ревью потока A (блокер): подтверждение владельцем собственной находки переводило карточку в
    // 'community', то есть самоподтверждение выдавалось за проверку сообществом и в интерфейсе, и в базе.
    // Факт «автор подтвердил» живёт в lithos.labels; 'community' зарезервировано за настоящей проверкой.
    expect([...effectiveRecordLabel().matchAll(/update\s+lithos\.cards\s+set[^;]*;/gi)]).toHaveLength(0);
    expect(effectiveRecordLabel()).not.toMatch(/verification\s*=\s*'community'/i);
  });

  it('порода метки проверяется по справочнику, а не только на непустоту', () => {
    // Ревью потока A (major): в cards.rock_class пишет доверенный воркер, а сюда — конечный пользователь
    // через RPC, в обход клиентских типов.
    expect(effectiveRecordLabel()).toMatch(/lithos\.rock_classes\s+where\s+code\s*=\s*p_rock_class/i);
  });

  it('справочник пород в миграциях совпадает с ROCK_CLASSES из packages/shared', () => {
    const seeded = seededRockClasses();
    expect(seeded).toHaveLength(new Set(seeded).size);
    expect([...seeded].sort()).toEqual([...ROCK_CLASSES].sort());
  });

  it('проверяет владельца скана, скрытость и pending_review перед записью', () => {
    const fnMatch = effectiveRecordLabel();
    expect(fnMatch).toMatch(/not\s+found\s+or\s+not\s+owned/i);
    expect(fnMatch).toMatch(/v_card\.hidden/i);
    expect(fnMatch).toMatch(/pending_review/i);
  });
});

describe('lithos.list_my_labels (0015) — инварианты по тексту миграции', () => {
  it('читает только свои строки: фильтр по author_id = current_user_id(), не по RLS-политике', () => {
    expect(sql0015).toMatch(/create\s+or\s+replace\s+function\s+lithos\.list_my_labels/i);
    expect(sql0015).toMatch(/author_id\s*=\s*lithos\.current_user_id\(\)/i);
    expect(sql0015).not.toMatch(/create\s+policy/i);
  });

  it('security definer, search_path зафиксирован, права сужены до authenticated', () => {
    expect(sql0015).toMatch(/security\s+definer\s+set\s+search_path\s*=\s*lithos\s*,\s*public/i);
    expect(sql0015).toMatch(/revoke\s+all\s+on\s+function\s+lithos\.list_my_labels\(uuid\)\s+from\s+public\s*;/i);
    expect(sql0015).toMatch(/grant\s+execute\s+on\s+function\s+lithos\.list_my_labels\(uuid\)\s+to\s+authenticated\s*;/i);
    expect(sql0015).not.toMatch(/grant\s+execute\s+on\s+function\s+lithos\.list_my_labels\(uuid\)\s+to\s+[^;]*\banon\b/i);
  });

  it('не выдаёт таблице labels новых грантов — читает только через эту функцию', () => {
    expect(sql0015).not.toMatch(/grant\s+(select|insert|update)[^;]*on\s+lithos\.labels/i);
  });
});

describe('LABEL_SOURCES / isLabelSource', () => {
  it('только пользовательские источники доступны клиенту — expert/golden не входят', () => {
    expect(LABEL_SOURCES).toEqual(['user_confirm', 'user_correct']);
  });

  it('распознаёт валидные источники и отвергает остальное', () => {
    expect(isLabelSource('user_confirm')).toBe(true);
    expect(isLabelSource('user_correct')).toBe(true);
    expect(isLabelSource('expert')).toBe(false);
    expect(isLabelSource('golden')).toBe(false);
    expect(isLabelSource('')).toBe(false);
    expect(isLabelSource(undefined)).toBe(false);
    expect(isLabelSource(42)).toBe(false);
  });
});

describe('parseLabelResult', () => {
  it('парсит валидную строку RPC (массив из RETURNS TABLE)', () => {
    const result = parseLabelResult([{ id: 'l1', matched_model: true, verification: 'community' }]);
    expect(result).toEqual({ id: 'l1', matchedModel: true, verification: 'community' });
  });

  it('терпит одиночный объект вместо массива', () => {
    const result = parseLabelResult({ id: 'l1', matched_model: false, verification: 'ai' });
    expect(result).toEqual({ id: 'l1', matchedModel: false, verification: 'ai' });
  });

  it('без id — null, а не мусорный объект', () => {
    expect(parseLabelResult([{ matched_model: true, verification: 'community' }])).toBeNull();
    expect(parseLabelResult([])).toBeNull();
    expect(parseLabelResult(null)).toBeNull();
    expect(parseLabelResult('не объект')).toBeNull();
  });

  it('verification вне enum → откатывается к ai, а не падает', () => {
    const result = parseLabelResult([{ id: 'l1', matched_model: false, verification: 'not_a_status' }]);
    expect(result!.verification).toBe('ai');
  });

  it('matched_model не boolean → false, а не мусор', () => {
    const result = parseLabelResult([{ id: 'l1', matched_model: 'yes', verification: 'ai' }]);
    expect(result!.matchedModel).toBe(false);
  });
});

describe('parseMyLabelRow / parseMyLabelRows (чтение собственной метки, 0015)', () => {
  it('парсит валидную строку', () => {
    const row = { source: 'user_confirm', rock_class: 'basalt', matched_model: true, created_at: '2026-09-30T00:00:00Z' };
    expect(parseMyLabelRow(row)).toEqual({ source: 'user_confirm', rockClass: 'basalt', matchedModel: true, createdAt: '2026-09-30T00:00:00Z' });
  });

  it('source вне (user_confirm|user_correct) — null, expert/golden эта функция не показывает клиенту', () => {
    expect(parseMyLabelRow({ source: 'expert', rock_class: 'basalt', matched_model: true, created_at: 'x' })).toBeNull();
    expect(parseMyLabelRow({ source: 'golden', rock_class: 'basalt', matched_model: true, created_at: 'x' })).toBeNull();
  });

  it('rock_class вне справочника ROCK_CLASSES — null, а не показ мусора пользователю', () => {
    expect(parseMyLabelRow({ source: 'user_correct', rock_class: 'not_a_rock', matched_model: false, created_at: 'x' })).toBeNull();
  });

  it('без created_at — null (нужен для выбора актуальной метки)', () => {
    expect(parseMyLabelRow({ source: 'user_confirm', rock_class: 'basalt', matched_model: true })).toBeNull();
  });

  it('не объект/не строка — null', () => {
    expect(parseMyLabelRow(null)).toBeNull();
    expect(parseMyLabelRow('строка')).toBeNull();
  });

  it('parseMyLabelRows отбрасывает невалидные строки, не мусорит в списке', () => {
    const rows = parseMyLabelRows([
      { source: 'user_confirm', rock_class: 'basalt', matched_model: true, created_at: '1' },
      { source: 'bogus', rock_class: 'basalt', matched_model: true, created_at: '2' },
      { source: 'user_correct', rock_class: 'sandstone', matched_model: false, created_at: '3' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.rockClass)).toEqual(['basalt', 'sandstone']);
  });

  it('parseMyLabelRows на не-массиве — пустой список', () => {
    expect(parseMyLabelRows(null)).toEqual([]);
    expect(parseMyLabelRows({})).toEqual([]);
  });
});

describe('latestLabel', () => {
  it('пустой список — null', () => {
    expect(latestLabel([])).toBeNull();
  });

  it('одна метка — она и есть текущая', () => {
    const row = { source: 'user_confirm' as const, rockClass: 'basalt' as const, matchedModel: true, createdAt: '2026-01-01T00:00:00Z' };
    expect(latestLabel([row])).toEqual(row);
  });

  it('подтверждение и исправление вместе — побеждает более свежая по created_at, а не порядок источника', () => {
    const confirm = { source: 'user_confirm' as const, rockClass: 'basalt' as const, matchedModel: true, createdAt: '2026-01-01T00:00:00Z' };
    const correct = { source: 'user_correct' as const, rockClass: 'sandstone' as const, matchedModel: false, createdAt: '2026-01-02T00:00:00Z' };
    expect(latestLabel([confirm, correct])).toEqual(correct);
    expect(latestLabel([correct, confirm])).toEqual(correct);
  });
});

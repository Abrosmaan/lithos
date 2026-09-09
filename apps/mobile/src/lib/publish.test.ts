// Поток D (T6.1): парсинг публичной витрины + инвариант «в public_finds нет точных координат» —
// по образцу apps/worker/src/limits/limits-migration.test.ts (текст миграции, не сеть/БД).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPORT_AUTOHIDE_THRESHOLD } from '@lithos/shared';
import { describe, expect, it, vi } from 'vitest';
import { cellCenter } from './geohash';

// publish.ts тянет ./supabase и ./auth (сессия, RPC) — в проде это react-native/expo-crypto; здесь тестируем
// только чистый разбор (parsePublicFindRow/normalizeReportReason), сеть не нужна. По этой же причине у
// cards.ts/auth.ts/diary.ts (сетевой слой) в репозитории нет прямых unit-тестов — заглушаем, чтобы не тащить
// react-native в vitest (тот же приём, что «не тестируем сетевой слой напрямую», просто явно, а не молчанием).
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./auth', () => ({ ensureUser: async () => ({ userId: 'test-user', deviceId: 'test-device' }) }));

const { decodeCursor, normalizeReportReason, parsePublicFindRow, REPORT_REASON_MAX } = await import('./publish');

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../supabase/migrations');
const MIGRATION = resolve(MIGRATIONS_DIR, '0007_public_showcase.sql');

describe('lithos.public_finds — колонки по тексту миграции', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  // Тело "select … from lithos.cards c" внутри "create or replace view lithos.public_finds as".
  const viewMatch = sql.match(/create\s+or\s+replace\s+view\s+lithos\.public_finds\s+as\s*([\s\S]*?);/i);

  it('миграция содержит представление public_finds', () => {
    expect(viewMatch).not.toBeNull();
  });

  const body = viewMatch![1]!;

  it('отдаёт только согласованный набор колонок (data-map.md «видно другим»)', () => {
    // Верхнеуровневые элементы select (без вложенных скобок — их тут и нет), последний идентификатор в каждом.
    const selectPart = body.match(/select([\s\S]*?)from\s+lithos\.cards/i)![1]!;
    const columns = selectPart
      .split(',')
      .map((c) => c.trim().replace(/\n/g, ' '))
      .filter(Boolean)
      .map((c) => {
        const asMatch = c.match(/\bas\s+(\w+)$/i);
        if (asMatch) return asMatch[1]!;
        const parts = c.split('.');
        return parts[parts.length - 1]!;
      });
    expect(columns).toEqual(['id', 'rock_class', 'tier', 'score', 'lore', 'name', 'user_name', 'cell_id', 'created_at', 'published_at', 'author_name']);
  });

  it('НИКОГДА не содержит lat/lng — точные координаты наружу не отдаются (правило владельца)', () => {
    expect(/\blat\b/i.test(body)).toBe(false);
    expect(/\blng\b/i.test(body)).toBe(false);
    expect(/latitude/i.test(body)).toBe(false);
    expect(/longitude/i.test(body)).toBe(false);
  });

  it('исключает скрытые и pending_review (сверка с WHERE-условием)', () => {
    expect(body).toMatch(/where[\s\S]*c\.published/i);
    expect(body).toMatch(/not\s+c\.hidden/i);
    expect(body).toMatch(/c\.verification\s*<>\s*'pending_review'/i);
  });

  it('грант select на представление выдан именно authenticated, не anon/public', () => {
    expect(sql).toMatch(/grant\s+select\s+on\s+lithos\.public_finds\s+to\s+authenticated\s*;/i);
    expect(sql).not.toMatch(/grant\s+select\s+on\s+lithos\.public_finds\s+to\s+(anon|public)\b/i);
  });
});

describe('parsePublicFindRow', () => {
  const base = {
    id: 'c1',
    rock_class: 'granite',
    tier: 'rare',
    score: 55,
    lore: 'Лор',
    name: 'Гранит',
    user_name: 'Мой камень',
    cell_id: 'szrv5f',
    created_at: '2026-09-01T10:00:00Z',
    published_at: '2026-09-02T10:00:00Z',
    author_name: 'Игорь',
  };

  it('парсит валидную строку и считает центр ячейки на клиенте', () => {
    const row = parsePublicFindRow(base);
    expect(row).not.toBeNull();
    expect(row!.id).toBe('c1');
    expect(row!.tier).toBe('rare');
    expect(row!.center).toEqual(cellCenter('szrv5f'));
  });

  it('без id или rock_class — null (битая строка, не показываем)', () => {
    expect(parsePublicFindRow({ ...base, id: null })).toBeNull();
    expect(parsePublicFindRow({ ...base, rock_class: undefined })).toBeNull();
    expect(parsePublicFindRow('не объект')).toBeNull();
  });

  it('тир вне enum → null, а не мусорная строка', () => {
    const row = parsePublicFindRow({ ...base, tier: 'not_a_tier' });
    expect(row!.tier).toBeNull();
  });

  it('нет cell_id → center = null (карта не рисует точку без ячейки)', () => {
    const row = parsePublicFindRow({ ...base, cell_id: null });
    expect(row!.cell_id).toBeNull();
    expect(row!.center).toBeNull();
  });

  it('автор без имени — author_name = null, текст «Без имени» решает экран, не клиент-lib', () => {
    const row = parsePublicFindRow({ ...base, author_name: null });
    expect(row!.author_name).toBeNull();
  });
});

describe('normalizeReportReason', () => {
  it('пусто/пробелы/undefined → null', () => {
    expect(normalizeReportReason(undefined)).toBeNull();
    expect(normalizeReportReason(null)).toBeNull();
    expect(normalizeReportReason('   ')).toBeNull();
    expect(normalizeReportReason('')).toBeNull();
  });

  it('обрезает пробелы по краям и ограничивает длину', () => {
    expect(normalizeReportReason('  на фото не камень  ')).toBe('на фото не камень');
    const long = 'a'.repeat(REPORT_REASON_MAX + 50);
    const out = normalizeReportReason(long)!;
    expect(out).toHaveLength(REPORT_REASON_MAX);
    expect(out).toBe('a'.repeat(REPORT_REASON_MAX));
  });
});

/**
 * Действующий порог жалоб по всем миграциям: `report_card` пересоздаётся через `create or replace`, а
 * править уже применённую миграцию нельзя (CLAUDE.md) — значит новое значение придёт отдельным файлом.
 * Побеждает последнее по порядку имён, как в `seededLimits()` из apps/worker/src/limits/limits-migration.test.ts.
 * Читать только 0007 было бы ложной гарантией: тест остался бы зелёным ровно в том случае, ради которого
 * он написан.
 */
function reportThresholdInMigrations(): number | null {
  let value: number | null = null;
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const fn of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+lithos\.report_card\b([\s\S]*?)\$\$\s*;/gi)) {
      const m = fn[1]!.match(/v_threshold\s+constant\s+int\s*:=\s*(\d+)/i);
      if (m) value = Number(m[1]);
    }
  }
  return value;
}

describe('порог автоскрытия жалобами — одно число на клиент и сервер', () => {
  // lithos.report_card не может импортировать TypeScript, поэтому держит порог константой в SQL.
  // Тот же приём, что в apps/worker/src/limits/limits-migration.test.ts: источник истины — packages/shared.
  it('действующий v_threshold в миграциях равен REPORT_AUTOHIDE_THRESHOLD', () => {
    expect(reportThresholdInMigrations()).toBe(REPORT_AUTOHIDE_THRESHOLD);
  });
});

describe('decodeCursor', () => {
  const ok = '2026-09-10T10:00:00+00:00|1b4e28ba-2fa1-11d2-883f-0016d3cca427';

  it('свой курсор разбирается', () => {
    expect(decodeCursor(ok)).toEqual({ publishedAt: '2026-09-10T10:00:00+00:00', id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' });
  });

  it('курсор с синтаксисом фильтра PostgREST отбрасывается, а не уезжает в запрос', () => {
    expect(decodeCursor('2026-09-10T10:00:00+00:00,and(id.eq.1)|1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBeNull();
    expect(decodeCursor('2026-09-10T10:00:00+00:00|not-a-uuid,or(id.gt.0)')).toBeNull();
  });

  it('пустой и бесформенный курсор — null (страница начнётся сначала)', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('|')).toBeNull();
    expect(decodeCursor('2026-09-10T10:00:00+00:00')).toBeNull();
  });
});

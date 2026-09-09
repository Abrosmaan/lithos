import { describe, expect, it } from 'vitest';
import { SCAN_ERROR_CODES } from './card-types';
import { DONE_WITHOUT_CARD_MAX_READS, isTerminalSnapshot, limitErrorCode, rejectText, RESULT_TIMEOUT_MS, resultPhase, stageStatusText } from './result-text';

describe('rejectText', () => {
  it('каждый код отказа → свой русский заголовок и подсказка', () => {
    const seen = new Set<string>();
    for (const code of SCAN_ERROR_CODES) {
      const t = rejectText(code);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.hint.length).toBeGreaterThan(10);
      expect(/[а-яё]/i.test(t.title)).toBe(true);
      seen.add(t.title);
    }
    expect(seen.size).toBe(SCAN_ERROR_CODES.length);
  });

  it('ключевые формулировки из постановки', () => {
    expect(rejectText('not_rock').title).toMatch(/не камень/);
    expect(rejectText('screen_photo').title).toBe('Фото с экрана не принимаем');
    expect(rejectText('dlq').title).toBe('Не удалось обработать');
    expect(rejectText('dlq').hint).toBe('Попробуйте ещё раз — мы ничего не потеряли.');
    expect(rejectText('photo_unavailable').title).toBe('Не удалось получить фото');
    expect(rejectText('photo_unavailable').hint).toMatch(/переснимите/i);
    expect(rejectText('parent_not_found').title).toBe('Исходная карточка не найдена');
  });

  it('неизвестный код / null → как dlq, без текста сервера', () => {
    expect(rejectText('permission denied for schema lithos')).toEqual(rejectText('dlq'));
    expect(rejectText(null)).toEqual(rejectText('dlq'));
    expect(rejectText(undefined)).toEqual(rejectText('dlq'));
  });
});

describe('лимиты T3.4', () => {
  it('rate_limited / budget_paused — русские тексты из постановки', () => {
    expect(rejectText('rate_limited').hint).toBe('Лимит сканов на сегодня исчерпан — возвращайтесь завтра.');
    expect(rejectText('budget_paused').title).toBe('Сервис перегружен');
    expect(rejectText('budget_paused').hint).toMatch(/^Обработаем в течение часа/);
  });
  it('limitErrorCode: код в сообщении RPC (raise exception rate_limited, миграция 0006), иначе null', () => {
    expect(limitErrorCode('rate_limited')).toBe('rate_limited');
    expect(limitErrorCode('P0001: budget_paused')).toBe('budget_paused');
    expect(limitErrorCode('scan x not found or not owned')).toBeNull();
    expect(limitErrorCode(null)).toBeNull();
    expect(limitErrorCode('')).toBeNull();
  });
  it('budget_paused при stage ≠ done и без карточки → paused; с карточкой — refining; done/failed — как обычно', () => {
    expect(resultPhase('preflight', false, 'budget_paused')).toBe('paused');
    expect(resultPhase('main', false, 'budget_paused')).toBe('paused');
    expect(resultPhase('main', true, 'budget_paused')).toBe('refining');
    expect(resultPhase('done', true, 'budget_paused')).toBe('done');
    expect(resultPhase('failed', false, 'rate_limited')).toBe('failed');
    expect(resultPhase('main', false, null)).toBe('determining');
    expect(resultPhase('main', false, 'something_else')).toBe('determining');
  });
});

describe('resultPhase', () => {
  it('до карточки — определяем; карточка до done — уточняем; done — финал; failed — отказ', () => {
    expect(resultPhase(null, false)).toBe('loading');
    expect(resultPhase('preflight', false)).toBe('determining');
    expect(resultPhase('main', false)).toBe('determining');
    expect(resultPhase('main', true)).toBe('refining');
    expect(resultPhase('escalation', true)).toBe('refining');
    expect(resultPhase('rules', true)).toBe('refining');
    expect(resultPhase('done', true)).toBe('done');
    expect(resultPhase('done', false)).toBe('determining'); // done без строки cards — ждём (RLS/гонка)
    expect(resultPhase('failed', false)).toBe('failed');
    expect(resultPhase('failed', true)).toBe('failed');
  });

  it('наблюдение останавливается: failed всегда; done — с карточкой или после лимита чтений без неё', () => {
    expect(isTerminalSnapshot('failed', false, 0)).toBe(true);
    expect(isTerminalSnapshot('done', true, 0)).toBe(true);
    expect(isTerminalSnapshot('done', false, 0)).toBe(false);
    expect(isTerminalSnapshot('done', false, DONE_WITHOUT_CARD_MAX_READS - 1)).toBe(false);
    expect(isTerminalSnapshot('done', false, DONE_WITHOUT_CARD_MAX_READS)).toBe(true);
    expect(isTerminalSnapshot('escalation', true, 99)).toBe(false);
    expect(isTerminalSnapshot(null, false, 99)).toBe(false);
  });

  it('статусы ступеней на русском, таймаут 90 с', () => {
    for (const s of ['preflight', 'gate', 'main', 'escalation', 'rules', 'done', 'failed'] as const) expect(stageStatusText(s)).toMatch(/[а-яё]/i);
    expect(RESULT_TIMEOUT_MS).toBe(90_000);
  });
});

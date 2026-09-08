import { describe, expect, it } from 'vitest';
import { TIERS } from './enums.js';
import {
  ANOMALY_REVIEW_MIN_TIER,
  BUDGET_SOFT_RATIO,
  MAX_SCANS_PER_DAY,
  NEW_ACCOUNT_HOURS,
  NEW_ACCOUNT_SCANS_PER_DAY,
  SCAN_LIMIT_SEED,
  budgetLevel,
  needsAnomalyReview,
  scanLimitFor,
} from './limits.js';

const H = 3_600_000;

describe('scanLimitFor', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  it('новый аккаунт (< NEW_ACCOUNT_HOURS) → NEW_ACCOUNT_SCANS_PER_DAY', () => {
    expect(scanLimitFor(now - 1 * H, now)).toBe(NEW_ACCOUNT_SCANS_PER_DAY);
    expect(scanLimitFor(new Date(now - (NEW_ACCOUNT_HOURS * H - 1)), now)).toBe(NEW_ACCOUNT_SCANS_PER_DAY);
  });
  it('старый аккаунт → MAX_SCANS_PER_DAY', () => {
    expect(scanLimitFor(now - NEW_ACCOUNT_HOURS * H, now)).toBe(MAX_SCANS_PER_DAY);
    expect(scanLimitFor(new Date(now - 48 * H).toISOString(), new Date(now))).toBe(MAX_SCANS_PER_DAY);
  });
  it('сид таблицы lithos.limits совпадает с константами', () => {
    expect(SCAN_LIMIT_SEED).toEqual({ max_scans_per_day: 10, new_account_scans_per_day: 20, new_account_hours: 24 });
    expect(MAX_SCANS_PER_DAY).toBeLessThan(NEW_ACCOUNT_SCANS_PER_DAY);
  });
});

describe('needsAnomalyReview', () => {
  it('ревью только при аномалии и тире ≥ epic', () => {
    expect(ANOMALY_REVIEW_MIN_TIER).toBe('epic');
    const from = TIERS.indexOf(ANOMALY_REVIEW_MIN_TIER);
    for (const [i, tier] of TIERS.entries()) {
      expect(needsAnomalyReview(true, tier)).toBe(i >= from);
      expect(needsAnomalyReview(false, tier)).toBe(false);
    }
  });
});

describe('budgetLevel', () => {
  it('пороги 80 % / 100 %', () => {
    expect(BUDGET_SOFT_RATIO).toBe(0.8);
    expect(budgetLevel(0, 1)).toBe('ok');
    expect(budgetLevel(0.79, 1)).toBe('ok');
    expect(budgetLevel(0.8, 1)).toBe('soft');
    expect(budgetLevel(0.99, 1)).toBe('soft');
    expect(budgetLevel(1, 1)).toBe('hard');
    expect(budgetLevel(5, 1)).toBe('hard');
  });
  it('бюджет не задан / некорректен → предохранитель выключен', () => {
    expect(budgetLevel(100, 0)).toBe('ok');
    expect(budgetLevel(100, -1)).toBe('ok');
    expect(budgetLevel(100, Number.NaN)).toBe('ok');
    expect(budgetLevel(100, Number.POSITIVE_INFINITY)).toBe('ok');
  });
});

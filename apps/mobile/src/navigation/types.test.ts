import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '../lib/prefs';
import { initialRoute } from './types';

describe('initialRoute', () => {
  it('не видел приветствия — Welcome, независимо от версии согласия', () => {
    expect(initialRoute({ welcomeSeen: false, consentVersion: 0 })).toBe('Welcome');
    expect(initialRoute({ welcomeSeen: false, consentVersion: CONSENT_VERSION })).toBe('Welcome');
  });

  it('видел приветствие, согласие устарело — Consent', () => {
    expect(initialRoute({ welcomeSeen: true, consentVersion: 0 })).toBe('Consent');
    expect(initialRoute({ welcomeSeen: true, consentVersion: CONSENT_VERSION - 1 })).toBe('Consent');
  });

  it('видел приветствие, согласие актуально — Tabs', () => {
    expect(initialRoute({ welcomeSeen: true, consentVersion: CONSENT_VERSION })).toBe('Tabs');
  });

  it('версия согласия выше текущей (даунгрейд приложения) — Tabs, повторно не спрашиваем', () => {
    expect(initialRoute({ welcomeSeen: true, consentVersion: CONSENT_VERSION + 1 })).toBe('Tabs');
  });
});

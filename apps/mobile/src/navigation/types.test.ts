import { describe, expect, it } from 'vitest';
import { initialRoute } from './types';

describe('initialRoute', () => {
  it('не видел приветствия — Welcome', () => {
    expect(initialRoute({ welcomeSeen: false })).toBe('Welcome');
  });

  it('видел приветствие — Tabs', () => {
    expect(initialRoute({ welcomeSeen: true })).toBe('Tabs');
  });
});

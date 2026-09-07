import { describe, expect, it } from 'vitest';
import { BreakerRegistry, CircuitBreaker } from './breaker.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('CircuitBreaker', () => {
  it('stays closed below 4 calls even if all fail', () => {
    const c = clock();
    const b = new CircuitBreaker({ now: c.now });
    b.onFailure();
    b.onFailure();
    b.onFailure();
    expect(b.state).toBe('closed');
    expect(b.allow()).toBe(true);
  });

  it('opens when > 25% of ≥ 4 calls fail within 60 s', () => {
    const c = clock();
    const b = new CircuitBreaker({ now: c.now });
    b.onSuccess();
    b.onSuccess();
    b.onSuccess();
    b.onFailure(); // 1/4 = 25% — not strictly greater
    expect(b.state).toBe('closed');
    b.onFailure(); // 2/5 = 40%
    expect(b.state).toBe('open');
    expect(b.allow()).toBe(false);
  });

  it('forgets samples older than the window', () => {
    const c = clock();
    const b = new CircuitBreaker({ now: c.now });
    b.onFailure();
    b.onFailure();
    b.onFailure();
    c.advance(61_000);
    b.onFailure(); // only one sample in the window now
    expect(b.state).toBe('closed');
  });

  it('goes half-open after 2 min and lets ~10% through', () => {
    const c = clock();
    let r = 0.5;
    const b = new CircuitBreaker({ now: c.now, random: () => r });
    for (let i = 0; i < 4; i++) b.onFailure();
    expect(b.state).toBe('open');
    c.advance(119_000);
    expect(b.allow()).toBe(false);
    c.advance(2_000);
    expect(b.state).toBe('half_open');
    expect(b.allow()).toBe(false); // 0.5 ≥ 0.1
    r = 0.05;
    expect(b.allow()).toBe(true);
  });

  it('half-open: probe success closes, probe failure re-opens', () => {
    const c = clock();
    const b = new CircuitBreaker({ now: c.now, random: () => 0 });
    for (let i = 0; i < 4; i++) b.onFailure();
    c.advance(120_000);
    expect(b.state).toBe('half_open');
    b.onFailure();
    expect(b.state).toBe('open');
    c.advance(120_000);
    expect(b.state).toBe('half_open');
    b.onSuccess();
    expect(b.state).toBe('closed');
    expect(b.stats()).toEqual({ state: 'closed', calls: 0, failures: 0 });
  });

  it('registry keeps one breaker per provider', () => {
    const reg = new BreakerRegistry();
    expect(reg.get('anthropic')).toBe(reg.get('anthropic'));
    expect(reg.get('anthropic')).not.toBe(reg.get('google'));
    expect(Object.keys(reg.snapshot()).sort()).toEqual(['anthropic', 'google']);
  });
});

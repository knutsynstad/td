import { describe, expect, it } from 'vitest';
import { hashString01 } from './hash';

describe('hashString01', () => {
  it('is deterministic', () => {
    expect(hashString01('hello')).toBe(hashString01('hello'));
  });
  it('returns value in [0, 1)', () => {
    const h = hashString01('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });
  it('returns consistent value for empty string', () => {
    const h = hashString01('');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
    expect(hashString01('')).toBe(h);
  });
});

import { describe, expect, it } from 'vitest';
import { isRecord } from './typeGuards';

describe('isRecord', () => {
  it('returns true for plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });
  it('returns false for array', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });
  it('returns false for primitives', () => {
    expect(isRecord(1)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

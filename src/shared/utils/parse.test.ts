import { describe, expect, it } from 'vitest';
import { parsePositiveInt } from './parse';

describe('parsePositiveInt', () => {
  it('parses number', () => {
    expect(parsePositiveInt(5)).toBe(5);
    expect(parsePositiveInt(5.7)).toBe(5);
  });
  it('parses string', () => {
    expect(parsePositiveInt('10')).toBe(10);
  });
  it('clamps negative to 0', () => {
    expect(parsePositiveInt(-3)).toBe(0);
  });
  it('returns 0 for invalid input', () => {
    expect(parsePositiveInt(NaN)).toBe(0);
    expect(parsePositiveInt('abc')).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { percentile, weightedSplit } from './numeric';

const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('weightedSplit', () => {
  it('sum equals total', () => {
    const r = seededRandom(1);
    const split = weightedSplit(100, 5, r);
    expect(split.reduce((a, v) => a + v, 0)).toBe(100);
  });
  it('returns correct length', () => {
    const r = seededRandom(2);
    expect(weightedSplit(50, 3, r)).toHaveLength(3);
  });
  it('returns empty for count <= 0', () => {
    expect(weightedSplit(10, 0)).toEqual([]);
    expect(weightedSplit(10, -1)).toEqual([]);
  });
});

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
  it('returns single element for single-item array', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });
  it('returns min at p=0 and max at p=1', () => {
    const arr = [1, 5, 10, 15, 20];
    expect(percentile(arr, 0)).toBe(1);
    expect(percentile(arr, 1)).toBe(20);
  });
  it('returns median for sorted array at p=0.5', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(percentile(arr, 0.5)).toBe(3);
  });
});

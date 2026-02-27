import { describe, expect, it } from 'vitest';
import { pickUniqueRandom, shuffle } from './array';

const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('shuffle', () => {
  it('preserves length', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toHaveLength(arr.length);
  });
  it('contains same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect([...shuffled].sort()).toEqual([...arr].sort());
  });
  it('is deterministic with seeded random', () => {
    const arr = [1, 2, 3, 4, 5];
    const r = seededRandom(123);
    const r2 = seededRandom(123);
    expect(shuffle(arr, r)).toEqual(shuffle([1, 2, 3, 4, 5], r2));
  });
  it('does not mutate input', () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('pickUniqueRandom', () => {
  it('returns requested count', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(pickUniqueRandom(arr, 3)).toHaveLength(3);
    expect(pickUniqueRandom(arr, 0)).toHaveLength(0);
    expect(pickUniqueRandom(arr, 10)).toHaveLength(5);
  });
  it('returns unique elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const picked = pickUniqueRandom(arr, 3, seededRandom(42));
    expect(new Set(picked).size).toBe(picked.length);
  });
});

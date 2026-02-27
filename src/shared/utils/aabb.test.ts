import { describe, expect, it } from 'vitest';
import { intersectsAabb } from './aabb';

describe('intersectsAabb', () => {
  it('returns true for overlapping boxes', () => {
    const a = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const b = { minX: 5, maxX: 15, minZ: 5, maxZ: 15 };
    expect(intersectsAabb(a, b)).toBe(true);
  });
  it('returns false for non-overlapping boxes', () => {
    const a = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const b = { minX: 20, maxX: 30, minZ: 20, maxZ: 30 };
    expect(intersectsAabb(a, b)).toBe(false);
  });
  it('returns true for touching boxes', () => {
    const a = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const b = { minX: 10, maxX: 20, minZ: 0, maxZ: 10 };
    expect(intersectsAabb(a, b)).toBe(true);
  });
});

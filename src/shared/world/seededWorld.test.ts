import { describe, expect, it } from 'vitest';
import { generateSeededWorldFeatures } from './seededWorld';
import { hashSeed } from './rng';

describe('generateSeededWorldFeatures', () => {
  it('is deterministic for a fixed seed', () => {
    const seed = hashSeed('alpha valley 01');
    const first = generateSeededWorldFeatures({
      seed,
      worldBounds: 64,
      margin: 3,
    });
    const second = generateSeededWorldFeatures({
      seed,
      worldBounds: 64,
      margin: 3,
    });
    expect(second).toEqual(first);
  });

  it('keeps rocks broadly distributed instead of single-area clumping', () => {
    const features = generateSeededWorldFeatures({
      seed: hashSeed('alpha valley 01'),
      worldBounds: 64,
      margin: 3,
    });
    expect(features.rocks.length).toBeGreaterThanOrEqual(50);
    expect(features.rocks.length).toBeLessThanOrEqual(95);
    const quadrants = [0, 0, 0, 0];
    for (const rock of features.rocks) {
      const east = rock.x >= 0 ? 1 : 0;
      const south = rock.z >= 0 ? 1 : 0;
      const idx = east + south * 2;
      quadrants[idx] += 1;
    }
    const nonEmptyQuadrants = quadrants.filter((count) => count > 0).length;
    expect(nonEmptyQuadrants).toBeGreaterThanOrEqual(3);
    const maxQuadrant = Math.max(...quadrants);
    expect(maxQuadrant / Math.max(1, features.rocks.length)).toBeLessThan(0.7);
  });
});

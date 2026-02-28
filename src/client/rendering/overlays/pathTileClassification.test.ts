import { describe, expect, it } from 'vitest';
import {
  classifyPathTile,
  parseGridKey,
  directionToYaw,
  snapYawToQuarterTurn,
} from './pathTileClassification';

describe('parseGridKey', () => {
  it('parses comma-separated coordinates', () => {
    expect(parseGridKey('5,10')).toEqual({ x: 5, z: 10 });
  });

  it('handles negative values', () => {
    expect(parseGridKey('-3,-7')).toEqual({ x: -3, z: -7 });
  });

  it('defaults to 0 for empty parts', () => {
    expect(parseGridKey('')).toEqual({ x: 0, z: 0 });
  });
});

describe('classifyPathTile', () => {
  const grid = new Set([
    '0,0',
    '1,0',
    '2,0',
    '0,1',
    '1,1',
    '2,1',
    '0,2',
    '1,2',
    '2,2',
  ]);
  const hasPathAt = (x: number, z: number) => grid.has(`${x},${z}`);

  it('classifies center tiles (all neighbors are path)', () => {
    const result = classifyPathTile(1, 1, hasPathAt);
    expect(result.variant).toBe('center');
  });

  it('classifies edge tiles (one grass neighbor)', () => {
    const result = classifyPathTile(1, 0, hasPathAt);
    expect(result.variant).toBe('edge');
    expect(result.directionDz).toBe(-1);
  });

  it('classifies outer corners (two adjacent grass neighbors)', () => {
    const result = classifyPathTile(0, 0, hasPathAt);
    expect(result.variant).toBe('outer-corner');
  });
});

describe('directionToYaw', () => {
  it('returns 0 for forward (0, 1)', () => {
    expect(directionToYaw(0, 1)).toBeCloseTo(0);
  });

  it('returns pi/2 for right (1, 0)', () => {
    expect(directionToYaw(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe('snapYawToQuarterTurn', () => {
  it('snaps near-zero to zero', () => {
    expect(snapYawToQuarterTurn(0.1)).toBeCloseTo(0);
  });

  it('snaps near pi/2 to pi/2', () => {
    expect(snapYawToQuarterTurn(Math.PI / 2 + 0.1)).toBeCloseTo(Math.PI / 2);
  });
});

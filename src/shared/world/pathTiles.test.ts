import { describe, expect, it } from 'vitest';
import { buildPathTilesFromPoints } from './pathTiles';

describe('buildPathTilesFromPoints', () => {
  it('fills 3-wide outside corner caps on one-cell turns', () => {
    const result = buildPathTilesFromPoints(
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
      [],
      16,
      1
    );
    const keys = new Set(result.tiles.map((tile) => `${tile.x},${tile.z}`));
    expect(keys.has('2,-1')).toBe(true);
  });

  it('flags diagonal segments as incomplete', () => {
    const result = buildPathTilesFromPoints(
      [
        { x: 0, z: 0 },
        { x: 1, z: 1 },
      ],
      [],
      16,
      1
    );
    expect(result.isComplete).toBe(false);
    expect(result.firstRejectedReason).toBe('diagonal');
  });
});

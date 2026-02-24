import { describe, expect, it } from 'vitest';
import { buildStaticMapStructures, sanitizeStaticMapStructures } from './staticStructures';

const WORLD_BOUNDS = 64;
const SPAWNER_ENTRY_INSET_CELLS = 3;
const SPAWNER_CLEARANCE_LENGTH_CELLS = 18;
const SPAWNER_CLEARANCE_HALF_WIDTH_CELLS = 4;
const CASTLE_HALF_EXTENT = 4;
const CASTLE_TREE_CLEARANCE_HALF_EXTENT = CASTLE_HALF_EXTENT + 6;

type Aabb = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const intersectsAabb = (a: Aabb, b: Aabb): boolean =>
  a.minX <= b.maxX &&
  a.maxX >= b.minX &&
  a.minZ <= b.maxZ &&
  a.maxZ >= b.minZ;

const getSpawnerClearanceZones = (): Aabb[] => {
  const entryCoord = WORLD_BOUNDS - SPAWNER_ENTRY_INSET_CELLS;
  const w = SPAWNER_CLEARANCE_HALF_WIDTH_CELLS;
  const len = SPAWNER_CLEARANCE_LENGTH_CELLS;
  return [
    { minX: -w, maxX: w, minZ: -entryCoord, maxZ: -entryCoord + len },
    { minX: -w, maxX: w, minZ: entryCoord - len, maxZ: entryCoord },
    { minX: entryCoord - len, maxX: entryCoord, minZ: -w, maxZ: w },
    { minX: -entryCoord, maxX: -entryCoord + len, minZ: -w, maxZ: w },
  ];
};

const CASTLE_TREE_CLEARANCE_ZONE: Aabb = {
  minX: -CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  maxX: CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  minZ: -CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  maxZ: CASTLE_TREE_CLEARANCE_HALF_EXTENT,
};

describe('buildStaticMapStructures', () => {
  it('keeps spawner entry corridors free of trees and rocks', () => {
    const structures = Object.values(buildStaticMapStructures(Date.now()));
    const clearances = getSpawnerClearanceZones();
    for (const structure of structures) {
      if (structure.ownerId !== 'Map') continue;
      if (structure.type !== 'tree' && structure.type !== 'rock') continue;
      const halfX =
        structure.type === 'tree'
          ? (structure.metadata?.treeFootprint ?? 2) * 0.5
          : (structure.metadata?.rock?.footprintX ?? 2) * 0.5;
      const halfZ =
        structure.type === 'tree'
          ? (structure.metadata?.treeFootprint ?? 2) * 0.5
          : (structure.metadata?.rock?.footprintZ ?? 2) * 0.5;
      const obstacle: Aabb = {
        minX: structure.center.x - halfX,
        maxX: structure.center.x + halfX,
        minZ: structure.center.z - halfZ,
        maxZ: structure.center.z + halfZ,
      };
      for (const clearance of clearances) {
        expect(intersectsAabb(obstacle, clearance)).toBe(false);
      }
    }
  });

  it('keeps map trees away from castle clearance zone', () => {
    const structures = Object.values(buildStaticMapStructures(Date.now()));
    for (const structure of structures) {
      if (structure.ownerId !== 'Map' || structure.type !== 'tree') continue;
      const half = (structure.metadata?.treeFootprint ?? 2) * 0.5;
      const obstacle: Aabb = {
        minX: structure.center.x - half,
        maxX: structure.center.x + half,
        minZ: structure.center.z - half,
        maxZ: structure.center.z + half,
      };
      expect(intersectsAabb(obstacle, CASTLE_TREE_CLEARANCE_ZONE)).toBe(false);
    }
  });

  it('sanitizes invalid existing map blockers from persisted structures', () => {
    const structures = buildStaticMapStructures(Date.now());
    structures['map-tree-castle-camper'] = {
      structureId: 'map-tree-castle-camper',
      ownerId: 'Map',
      type: 'tree',
      center: { x: 0, z: 0 },
      hp: 100,
      maxHp: 100,
      createdAtMs: Date.now(),
      metadata: { treeFootprint: 4 },
    };
    structures['map-rock-spawn-camper'] = {
      structureId: 'map-rock-spawn-camper',
      ownerId: 'Map',
      type: 'rock',
      center: { x: 0, z: -61 },
      hp: 100,
      maxHp: 100,
      createdAtMs: Date.now(),
      metadata: {
        rock: {
          footprintX: 4,
          footprintZ: 4,
          yawQuarterTurns: 0,
          modelIndex: 0,
          mirrorX: false,
          mirrorZ: false,
          verticalScale: 1,
        },
      },
    };
    const removed = sanitizeStaticMapStructures(structures);
    expect(removed).toEqual(
      expect.arrayContaining(['map-tree-castle-camper', 'map-rock-spawn-camper'])
    );
    expect(structures['map-tree-castle-camper']).toBeUndefined();
    expect(structures['map-rock-spawn-camper']).toBeUndefined();
  });
});

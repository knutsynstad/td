import type { StructureState } from '../../shared/game-state';
import {
  generateSeededWorldFeatures,
  type RockPlacement,
} from '../../shared/world/seededWorld';
import { hashSeed } from '../../shared/world/rng';

const WORLD_BOUNDS = 64;
const WORLD_SEED_INPUT: string | number = 'alpha valley 01';
const WORLD_SEED = hashSeed(WORLD_SEED_INPUT);
const CASTLE_HALF_EXTENT = 4;
const SPAWNER_ENTRY_INSET_CELLS = 3;
const SPAWNER_CLEARANCE_LENGTH_CELLS = 18;
const SPAWNER_CLEARANCE_HALF_WIDTH_CELLS = 4;
const CASTLE_TREE_CLEARANCE_HALF_EXTENT = CASTLE_HALF_EXTENT + 6;

const toStructureId = (prefix: string, x: number, z: number) =>
  `${prefix}-${Math.round(x)}-${Math.round(z)}`;

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

const toObstacleAabb = (x: number, z: number, halfX: number, halfZ: number): Aabb => ({
  minX: x - halfX,
  maxX: x + halfX,
  minZ: z - halfZ,
  maxZ: z + halfZ,
});

const getSpawnerClearanceZones = (): Aabb[] => {
  const entryCoord = WORLD_BOUNDS - SPAWNER_ENTRY_INSET_CELLS;
  const w = SPAWNER_CLEARANCE_HALF_WIDTH_CELLS;
  const len = SPAWNER_CLEARANCE_LENGTH_CELLS;
  return [
    // North lane: toward center from z = -entryCoord.
    {
      minX: -w,
      maxX: w,
      minZ: -entryCoord,
      maxZ: -entryCoord + len,
    },
    // South lane.
    {
      minX: -w,
      maxX: w,
      minZ: entryCoord - len,
      maxZ: entryCoord,
    },
    // East lane.
    {
      minX: entryCoord - len,
      maxX: entryCoord,
      minZ: -w,
      maxZ: w,
    },
    // West lane.
    {
      minX: -entryCoord,
      maxX: -entryCoord + len,
      minZ: -w,
      maxZ: w,
    },
  ];
};

const CASTLE_TREE_CLEARANCE_ZONE: Aabb = {
  minX: -CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  maxX: CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  minZ: -CASTLE_TREE_CLEARANCE_HALF_EXTENT,
  maxZ: CASTLE_TREE_CLEARANCE_HALF_EXTENT,
};

const intersectsSpawnerClearance = (x: number, z: number, halfX: number, halfZ: number): boolean => {
  const obstacleAabb = toObstacleAabb(x, z, halfX, halfZ);
  for (const clearance of getSpawnerClearanceZones()) {
    if (intersectsAabb(obstacleAabb, clearance)) return true;
  }
  return false;
};

const intersectsCastleTreeClearance = (
  x: number,
  z: number,
  halfX: number,
  halfZ: number
): boolean => intersectsAabb(toObstacleAabb(x, z, halfX, halfZ), CASTLE_TREE_CLEARANCE_ZONE);

const isDisallowedStaticStructure = (structure: StructureState): boolean => {
  if (structure.ownerId !== 'Map') return false;
  if (structure.type === 'tree') {
    const half = (structure.metadata?.treeFootprint ?? 2) * 0.5;
    return (
      intersectsSpawnerClearance(structure.center.x, structure.center.z, half, half) ||
      intersectsCastleTreeClearance(structure.center.x, structure.center.z, half, half)
    );
  }
  if (structure.type === 'rock') {
    const halfX = (structure.metadata?.rock?.footprintX ?? 2) * 0.5;
    const halfZ = (structure.metadata?.rock?.footprintZ ?? 2) * 0.5;
    return intersectsSpawnerClearance(structure.center.x, structure.center.z, halfX, halfZ);
  }
  return false;
};

export const sanitizeStaticMapStructures = (
  structures: Record<string, StructureState>
): string[] => {
  const removed: string[] = [];
  for (const [structureId, structure] of Object.entries(structures)) {
    if (!isDisallowedStaticStructure(structure)) continue;
    delete structures[structureId];
    removed.push(structureId);
  }
  return removed;
};

const createMapTowerStructures = (createdAtMs: number): StructureState[] => {
  const centerX = 0;
  const centerZ = 0;
  const outwardOffset = 6;
  const sideOffset = 4;
  const xOffset = CASTLE_HALF_EXTENT + outwardOffset;
  const zOffset = CASTLE_HALF_EXTENT + outwardOffset;
  const positions = [
    { x: centerX - sideOffset, z: centerZ + zOffset },
    { x: centerX + sideOffset, z: centerZ + zOffset },
    { x: centerX - sideOffset, z: centerZ - zOffset },
    { x: centerX + sideOffset, z: centerZ - zOffset },
    { x: centerX + xOffset, z: centerZ - sideOffset },
    { x: centerX + xOffset, z: centerZ + sideOffset },
    { x: centerX - xOffset, z: centerZ - sideOffset },
    { x: centerX - xOffset, z: centerZ + sideOffset },
  ];
  return positions.map((position) => ({
    structureId: toStructureId('map-tower', position.x, position.z),
    ownerId: 'Map',
    type: 'tower',
    center: position,
    hp: 100,
    maxHp: 100,
    createdAtMs,
  }));
};

const createMapTreeStructure = (
  tree: { x: number; z: number; footprint: 1 | 2 | 3 | 4 },
  createdAtMs: number
): StructureState => ({
  structureId: toStructureId('map-tree', tree.x, tree.z),
  ownerId: 'Map',
  type: 'tree',
  center: { x: tree.x, z: tree.z },
  hp: 100,
  maxHp: 100,
  createdAtMs,
  metadata: {
    treeFootprint: tree.footprint,
  },
});

const createMapRockStructure = (
  rock: RockPlacement,
  createdAtMs: number
): StructureState => ({
  structureId: toStructureId('map-rock', rock.x, rock.z),
  ownerId: 'Map',
  type: 'rock',
  center: { x: rock.x, z: rock.z },
  hp: 100,
  maxHp: 100,
  createdAtMs,
  metadata: {
    rock: {
      footprintX: rock.footprintX,
      footprintZ: rock.footprintZ,
      yawQuarterTurns: rock.yawQuarterTurns,
      modelIndex: rock.modelIndex,
      mirrorX: rock.mirrorX,
      mirrorZ: rock.mirrorZ,
      verticalScale: rock.verticalScale,
    },
  },
});

export const buildStaticMapStructures = (
  createdAtMs: number
): Record<string, StructureState> => {
  const structures: Record<string, StructureState> = {};
  for (const tower of createMapTowerStructures(createdAtMs)) {
    structures[tower.structureId] = tower;
  }
  const features = generateSeededWorldFeatures({
    seed: WORLD_SEED,
    worldBounds: WORLD_BOUNDS,
    margin: 3,
  });
  for (const tree of features.trees) {
    const half = tree.footprint * 0.5;
    if (intersectsSpawnerClearance(tree.x, tree.z, half, half)) continue;
    if (intersectsCastleTreeClearance(tree.x, tree.z, half, half)) continue;
    const structure = createMapTreeStructure(tree, createdAtMs);
    structures[structure.structureId] = structure;
  }
  for (const rock of features.rocks) {
    const halfX = rock.footprintX * 0.5;
    const halfZ = rock.footprintZ * 0.5;
    if (intersectsSpawnerClearance(rock.x, rock.z, halfX, halfZ)) continue;
    const structure = createMapRockStructure(rock, createdAtMs);
    structures[structure.structureId] = structure;
  }
  return structures;
};

export const hasStaticMapStructures = (
  structures: Record<string, StructureState>
): boolean => {
  for (const structure of Object.values(structures)) {
    if (structure.ownerId === 'Map') return true;
  }
  return false;
};

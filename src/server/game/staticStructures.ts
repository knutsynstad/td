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

const toStructureId = (prefix: string, x: number, z: number) =>
  `${prefix}-${Math.round(x)}-${Math.round(z)}`;

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
    const structure = createMapTreeStructure(tree, createdAtMs);
    structures[structure.structureId] = structure;
  }
  for (const rock of features.rocks) {
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

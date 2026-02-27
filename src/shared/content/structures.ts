import type { StructureState, StructureType } from '../game-state';

export type StructureDef = {
  type: StructureType;
  hp: number;
  maxHp: number;
  footprint: { halfX: number; halfZ: number };
  pathInflate: number;
  blocksPath: boolean;
  energyCost: number;
  deleteCost: number;
};

export const STRUCTURE_DEFS: Record<StructureType, StructureDef> = {
  wall: {
    type: 'wall',
    hp: 100,
    maxHp: 100,
    footprint: { halfX: 0.6, halfZ: 0.6 },
    pathInflate: 0.25,
    blocksPath: true,
    energyCost: 2,
    deleteCost: 0,
  },
  tower: {
    type: 'tower',
    hp: 100,
    maxHp: 100,
    footprint: { halfX: 1, halfZ: 1 },
    pathInflate: 0.4,
    blocksPath: true,
    energyCost: 20,
    deleteCost: 0,
  },
  bank: {
    type: 'bank',
    hp: 100,
    maxHp: 100,
    footprint: { halfX: 1.4, halfZ: 1.4 },
    pathInflate: 0.4,
    blocksPath: false,
    energyCost: 0,
    deleteCost: 0,
  },
  tree: {
    type: 'tree',
    hp: 100,
    maxHp: 100,
    footprint: { halfX: 1, halfZ: 1 },
    pathInflate: 0.4,
    blocksPath: true,
    energyCost: 0,
    deleteCost: 0,
  },
  rock: {
    type: 'rock',
    hp: 100,
    maxHp: 100,
    footprint: { halfX: 1, halfZ: 1 },
    pathInflate: 0.4,
    blocksPath: true,
    energyCost: 0,
    deleteCost: 0,
  },
};

export const getStructureDef = (type: StructureType): StructureDef =>
  STRUCTURE_DEFS[type];

export const getStructureFootprint = (
  s: StructureState
): { halfX: number; halfZ: number } => {
  const def = STRUCTURE_DEFS[s.type];
  if (s.type === 'tree') {
    const half = (s.metadata?.treeFootprint ?? 2) * 0.5;
    return { halfX: half, halfZ: half };
  }
  if (s.type === 'rock') {
    return {
      halfX: (s.metadata?.rock?.footprintX ?? 2) * 0.5,
      halfZ: (s.metadata?.rock?.footprintZ ?? 2) * 0.5,
    };
  }
  return def.footprint;
};

export const getStructureEnergyCost = (type: StructureType): number =>
  STRUCTURE_DEFS[type].energyCost;

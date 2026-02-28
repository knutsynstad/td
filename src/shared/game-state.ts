import { isRecord } from './utils';

export type Vec2 = {
  x: number;
  z: number;
};

export const DEFAULT_PLAYER_SPAWN: Vec2 = { x: 10, z: 0 };

export const parseVec2 = (value: unknown): Vec2 => {
  if (!isRecord(value)) return { x: 0, z: 0 };
  return {
    x: Number(value.x ?? 0),
    z: Number(value.z ?? 0),
  };
};

export type PlayerIntent = {
  desiredDir?: Vec2;
  target?: Vec2;
  updatedAtMs: number;
};

export type PlayerState = {
  playerId: string;
  username: string;
  position: Vec2;
  velocity: Vec2;
  speed: number;
  lastSeenMs: number;
};

export type StructureType =
  | 'wall'
  | 'tower'
  | 'tree'
  | 'rock'
  | 'castleCoins';

export type StructureMetadata = {
  treeFootprint?: 1 | 2 | 3 | 4;
  rock?: {
    footprintX: number;
    footprintZ: number;
    yawQuarterTurns: 0 | 1 | 2 | 3;
    modelIndex: 0 | 1;
    mirrorX: boolean;
    mirrorZ: boolean;
    verticalScale: number;
  };
};

export type StructureState = {
  structureId: string;
  ownerId: string;
  type: StructureType;
  center: Vec2;
  hp: number;
  maxHp: number;
  createdAtMs: number;
  metadata?: StructureMetadata;
};

export type MobState = {
  mobId: string;
  position: Vec2;
  velocity: Vec2;
  hp: number;
  maxHp: number;
  spawnerId: string;
  routeIndex: number;
  stuckMs?: number;
  lastProgressDistanceToGoal?: number;
};

export type SpawnerState = {
  spawnerId: string;
  totalCount: number;
  spawnedCount: number;
  aliveCount: number;
  spawnRatePerSecond: number;
  spawnAccumulator: number;
  gateOpen: boolean;
  routeState: 'reachable' | 'unstable' | 'blocked';
  route: Vec2[];
};

export type WaveState = {
  wave: number;
  active: boolean;
  nextWaveAtMs: number;
  spawners: SpawnerState[];
};

export type WorldMeta = {
  tickSeq: number;
  worldVersion: number;
  lastTickMs: number;
  lastStructureChangeTickSeq?: number;
  seed: number;
  coins: number;
  lives: number;
  nextMobSeq: number;
};

export type WorldState = {
  meta: WorldMeta;
  players: Record<string, PlayerState>;
  intents: Record<string, PlayerIntent>;
  structures: Record<string, StructureState>;
  mobs: Record<string, MobState>;
  wave: WaveState;
};

export type GameWorld = {
  meta: WorldMeta;
  mobs: Map<string, MobState>;
  structures: Map<string, StructureState>;
  players: Map<string, PlayerState>;
  intents: Map<string, PlayerIntent>;
  wave: WaveState;
  waveDirty: boolean;
};

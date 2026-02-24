export type Vec2 = {
  x: number;
  z: number;
};

export const DEFAULT_PLAYER_SPAWN: Vec2 = { x: 10, z: 0 };

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

export type StructureType = 'wall' | 'tower' | 'tree' | 'rock' | 'bank';

export type StructureState = {
  structureId: string;
  ownerId: string;
  type: StructureType;
  center: Vec2;
  hp: number;
  maxHp: number;
  createdAtMs: number;
};

export type MobState = {
  mobId: string;
  position: Vec2;
  velocity: Vec2;
  hp: number;
  maxHp: number;
  spawnerId: string;
};

export type SpawnerState = {
  spawnerId: string;
  totalCount: number;
  spawnedCount: number;
  aliveCount: number;
  spawnRatePerSecond: number;
  spawnAccumulator: number;
  gateOpen: boolean;
};

export type WaveState = {
  wave: number;
  active: boolean;
  nextWaveAtMs: number;
  spawners: SpawnerState[];
};

export type WorldMeta = {
  postId: string;
  tickSeq: number;
  worldVersion: number;
  lastTickMs: number;
  seed: number;
  energy: number;
  lives: number;
};

export type WorldState = {
  meta: WorldMeta;
  players: Record<string, PlayerState>;
  intents: Record<string, PlayerIntent>;
  structures: Record<string, StructureState>;
  mobs: Record<string, MobState>;
  wave: WaveState;
};

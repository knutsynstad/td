import type {
  PlayerIntent,
  WorldMeta,
  StructureState,
  Vec2,
  WaveState,
  WorldState,
} from './game-state';

export type EntityInterpolation = {
  from: Vec2;
  to: Vec2;
  t0: number;
  t1: number;
};

export type MoveIntentCommand = {
  type: 'moveIntent';
  playerId: string;
  intent: PlayerIntent;
  clientPosition?: Vec2;
};

export type BuildStructureCommand = {
  type: 'buildStructure';
  playerId: string;
  structure: {
    structureId: string;
    type: StructureState['type'];
    center: Vec2;
  };
};

export type BuildStructuresCommand = {
  type: 'buildStructures';
  playerId: string;
  structures: Array<{
    structureId: string;
    type: StructureState['type'];
    center: Vec2;
  }>;
};

export type RemoveStructureCommand = {
  type: 'removeStructure';
  playerId: string;
  structureId: string;
};

export type StartWaveCommand = {
  type: 'startWave';
  playerId: string;
};

export type GameCommand =
  | MoveIntentCommand
  | BuildStructureCommand
  | BuildStructuresCommand
  | RemoveStructureCommand
  | StartWaveCommand;

export type CommandEnvelope = {
  seq: number;
  sentAtMs: number;
  command: GameCommand;
};

export type PresenceDelta = {
  type: 'presenceDelta';
  joined?: {
    playerId: string;
    username: string;
    position: Vec2;
  };
  left?: {
    playerId: string;
    reason: 'timeout';
  };
};

export type MobPool = {
  ids: number[];
  px: number[];
  pz: number[];
  vx: number[];
  vz: number[];
  hp: number[];
  maxHp?: number[];
};

export type EntityDelta = {
  type: 'entityDelta';
  serverTimeMs: number;
  tickMs: number;
  players: Array<{
    playerId: string;
    username: string;
    interpolation: EntityInterpolation;
  }>;
  mobPool?: MobPool;
  fullMobList?: boolean;
  fullMobSnapshotId?: number;
  fullMobSnapshotChunkIndex?: number;
  fullMobSnapshotChunkCount?: number;
  despawnedMobIds: number[];
};

export type StructureDelta = {
  type: 'structureDelta';
  upserts: StructureState[];
  removes: string[];
  requiresPathRefresh: boolean;
};

export type WaveDelta = {
  type: 'waveDelta';
  wave: WaveState;
  lives?: number;
};

export type ResyncRequiredDelta = {
  type: 'resyncRequired';
  reason: string;
};

export type GameDelta =
  | PresenceDelta
  | EntityDelta
  | StructureDelta
  | WaveDelta
  | ResyncRequiredDelta;

export type DeltaBatch = {
  tickSeq: number;
  worldVersion: number;
  channelId?: string;
  events: GameDelta[];
};

export type JoinRequest = Record<string, never>;

export type JoinResponse = {
  type: 'join';
  playerId: string;
  username: string;
  channel: string;
  snapshot: WorldState;
};

export type CommandRequest = {
  envelope: CommandEnvelope;
};

export type CommandResponse = {
  type: 'commandAck';
  accepted: boolean;
  tickSeq: number;
  worldVersion: number;
  reason?: string;
};

export type HeartbeatRequest = {
  playerId: string;
  position?: Vec2;
};

export type HeartbeatResponse = {
  type: 'heartbeatAck';
  tickSeq: number;
  worldVersion: number;
  wave?: number;
  waveActive?: boolean;
  nextWaveAtMs?: number;
  serverTimeMs?: number;
  coins?: number;
};

export type CoinBalanceResponse = {
  type: 'coinBalance';
  coins: number;
};

export type ResyncRequest = {
  playerId?: string;
};

export type ResyncResponse = {
  type: 'snapshot';
  snapshot: WorldState;
  resetReason?: string;
};

export type StructuresSyncResponse = {
  type: 'structures';
  structures: Record<string, StructureState>;
  structureChangeSeq: number;
};

export type MetaSyncResponse = {
  type: 'meta';
  meta: WorldMeta;
};

export const isCommandRequest = (value: unknown): value is CommandRequest => {
  if (typeof value !== 'object' || value === null) return false;
  const maybeEnvelope = Reflect.get(value, 'envelope');
  if (typeof maybeEnvelope !== 'object' || maybeEnvelope === null) return false;
  const maybeCommand = Reflect.get(maybeEnvelope, 'command');
  if (typeof maybeCommand !== 'object' || maybeCommand === null) return false;
  return typeof Reflect.get(maybeCommand, 'type') === 'string';
};

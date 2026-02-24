import type { PlayerIntent, StructureState, Vec2, WaveState, WorldState } from "./game-state";

export type EntityInterpolation = {
  from: Vec2;
  to: Vec2;
  t0: number;
  t1: number;
};

export type MoveIntentCommand = {
  type: "moveIntent";
  playerId: string;
  intent: PlayerIntent;
  clientPosition?: Vec2;
};

export type BuildStructureCommand = {
  type: "buildStructure";
  playerId: string;
  structure: {
    structureId: string;
    type: StructureState["type"];
    center: Vec2;
  };
};

export type RemoveStructureCommand = {
  type: "removeStructure";
  playerId: string;
  structureId: string;
};

export type StartWaveCommand = {
  type: "startWave";
  playerId: string;
};

export type ShootCommand = {
  type: "shoot";
  playerId: string;
  target: Vec2;
};

export type GameCommand =
  | MoveIntentCommand
  | BuildStructureCommand
  | RemoveStructureCommand
  | StartWaveCommand
  | ShootCommand;

export type CommandEnvelope = {
  seq: number;
  sentAtMs: number;
  command: GameCommand;
};

export type PresenceDelta = {
  type: "presenceDelta";
  tickSeq: number;
  worldVersion: number;
  joined?: {
    playerId: string;
    username: string;
    position: Vec2;
  };
  left?: {
    playerId: string;
    reason: "timeout" | "disconnect";
  };
};

export type EntityDelta = {
  type: "entityDelta";
  tickSeq: number;
  worldVersion: number;
  players: Array<{
    playerId: string;
    username: string;
    interpolation: EntityInterpolation;
  }>;
  mobs: Array<{
    mobId: string;
    interpolation: EntityInterpolation;
    hp: number;
    maxHp: number;
  }>;
  despawnedMobIds: string[];
};

export type StructureDelta = {
  type: "structureDelta";
  tickSeq: number;
  worldVersion: number;
  upserts: StructureState[];
  removes: string[];
  requiresPathRefresh: boolean;
};

export type WaveDelta = {
  type: "waveDelta";
  tickSeq: number;
  worldVersion: number;
  wave: WaveState;
};

export type AckDelta = {
  type: "ack";
  tickSeq: number;
  worldVersion: number;
  ackSeq: number;
};

export type ResyncRequiredDelta = {
  type: "resyncRequired";
  tickSeq: number;
  worldVersion: number;
  reason: string;
};

export type GameDelta =
  | PresenceDelta
  | EntityDelta
  | StructureDelta
  | WaveDelta
  | AckDelta
  | ResyncRequiredDelta;

export type DeltaBatch = {
  type: "deltaBatch";
  tickSeq: number;
  worldVersion: number;
  events: GameDelta[];
};

export type JoinRequest = {
  lastKnownTickSeq?: number;
};

export type JoinResponse = {
  type: "join";
  playerId: string;
  username: string;
  channel: string;
  snapshot: WorldState;
};

export type CommandRequest = {
  envelope: CommandEnvelope;
};

export type CommandResponse = {
  type: "commandAck";
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
  type: "heartbeatAck";
  tickSeq: number;
  worldVersion: number;
};

export type CoinBalanceResponse = {
  type: "coinBalance";
  coins: number;
};

export type ResyncRequest = {
  tickSeq: number;
  playerId?: string;
};

export type ResyncResponse = {
  type: "snapshot";
  snapshot: WorldState;
};

export const isCommandRequest = (value: unknown): value is CommandRequest => {
  if (typeof value !== "object" || value === null) return false;
  const maybeEnvelope = Reflect.get(value, "envelope");
  if (typeof maybeEnvelope !== "object" || maybeEnvelope === null) return false;
  const maybeCommand = Reflect.get(maybeEnvelope, "command");
  if (typeof maybeCommand !== "object" || maybeCommand === null) return false;
  return typeof Reflect.get(maybeCommand, "type") === "string";
};

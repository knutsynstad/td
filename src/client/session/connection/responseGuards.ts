import type {
  CommandResponse,
  CoinBalanceResponse,
  DeltaBatch,
  HeartbeatResponse,
  JoinResponse,
  MetaSyncResponse,
  ResyncResponse,
  StructuresSyncResponse,
} from '../../../shared/game-protocol';
import type { Vec2 } from '../../../shared/game-state';
import { isRecord } from '../../../shared/utils';

export const isCoinBalanceResponse = (
  value: unknown
): value is CoinBalanceResponse =>
  isRecord(value) &&
  value.type === 'coinBalance' &&
  typeof value.coins === 'number';

export const isVec2 = (value: unknown): value is Vec2 =>
  isRecord(value) && typeof value.x === 'number' && typeof value.z === 'number';

export const isJoinResponse = (value: unknown): value is JoinResponse => {
  if (!isRecord(value)) return false;
  if (value.type !== 'join') return false;
  if (
    typeof value.playerId !== 'string' ||
    typeof value.username !== 'string' ||
    typeof value.channel !== 'string'
  ) {
    return false;
  }
  if (!isRecord(value.snapshot) || !isRecord(value.snapshot.players))
    return false;
  return true;
};

export const isDeltaBatch = (value: unknown): value is DeltaBatch =>
  isRecord(value) &&
  Array.isArray(value.events) &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

export const isHeartbeatResponse = (
  value: unknown
): value is HeartbeatResponse =>
  isRecord(value) &&
  value.type === 'heartbeatAck' &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

export const hasHeartbeatWaveState = (
  value: HeartbeatResponse
): value is HeartbeatResponse & {
  wave: number;
  waveActive: boolean;
  nextWaveAtMs: number;
} =>
  typeof value.wave === 'number' &&
  typeof value.waveActive === 'boolean' &&
  typeof value.nextWaveAtMs === 'number';

export const isResyncResponse = (value: unknown): value is ResyncResponse =>
  isRecord(value) && value.type === 'snapshot' && isRecord(value.snapshot);

export const isStructuresSyncResponse = (
  value: unknown
): value is StructuresSyncResponse =>
  isRecord(value) &&
  value.type === 'structures' &&
  isRecord(value.structures) &&
  typeof value.structureChangeSeq === 'number';

export const isMetaSyncResponse = (
  value: unknown
): value is MetaSyncResponse =>
  isRecord(value) && value.type === 'meta' && isRecord(value.meta);

export const isCommandResponse = (
  value: unknown
): value is CommandResponse =>
  isRecord(value) &&
  value.type === 'commandAck' &&
  typeof value.accepted === 'boolean' &&
  typeof value.tickSeq === 'number' &&
  typeof value.worldVersion === 'number';

export const parseJoinResponse = (value: unknown): JoinResponse => {
  if (!isJoinResponse(value)) {
    throw new Error('invalid join response');
  }
  return value;
};

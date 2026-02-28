import { redis } from '@devvit/web/server';
import {
  DEFAULT_PLAYER_SPAWN,
  parseVec2,
  type PlayerIntent,
  type PlayerState,
} from '../../shared/game-state';
import { PLAYER_SPEED } from '../../shared/content';
import { isRecord } from '../../shared/utils';
import { MAX_STRUCTURES } from '../config';
import { KEYS } from '../core/redis';

export function parsePlayerState(value: unknown): PlayerState {
  if (!isRecord(value)) {
    return {
      playerId: '',
      username: 'anonymous',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: PLAYER_SPEED,
      lastSeenMs: 0,
    };
  }
  return {
    playerId: String(value.playerId ?? ''),
    username: String(value.username ?? 'anonymous'),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    speed: Number(value.speed ?? PLAYER_SPEED),
    lastSeenMs: Number(value.lastSeenMs ?? 0),
  };
}

export function parseIntent(value: unknown): PlayerIntent {
  if (!isRecord(value)) {
    return { updatedAtMs: 0 };
  }
  const parsed: PlayerIntent = {
    updatedAtMs: Number(value.updatedAtMs ?? 0),
  };
  if (value.desiredDir) parsed.desiredDir = parseVec2(value.desiredDir);
  if (value.target) parsed.target = parseVec2(value.target);
  return parsed;
}

export async function touchPlayerPresence(
  player: PlayerState
): Promise<void> {
  await Promise.all([
    redis.hSet(KEYS.players, { [player.playerId]: JSON.stringify(player) }),
    redis.zAdd(KEYS.seen, {
      member: player.playerId,
      score: player.lastSeenMs,
    }),
  ]);
}

export async function removePlayers(playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;
  await Promise.all([
    redis.hDel(KEYS.players, playerIds),
    redis.hDel(KEYS.intents, playerIds),
    redis.zRem(KEYS.seen, playerIds),
  ]);
}

export async function removeOldPlayersByLastSeen(
  cutoffMs: number,
  limit = 250
): Promise<string[]> {
  const stale = await redis.zRange(KEYS.seen, 0, cutoffMs, {
    by: 'score',
    limit: { offset: 0, count: limit },
  });
  if (stale.length === 0) return [];
  const playerIds = stale.map((entry) => entry.member);
  await removePlayers(playerIds);
  return playerIds;
}

export async function enforceStructureCap(
  incomingCount = 1
): Promise<boolean> {
  const count = await redis.hLen(KEYS.structures);
  const safeIncoming = Math.max(0, Math.floor(incomingCount));
  return count + safeIncoming <= MAX_STRUCTURES;
}

export function createDefaultPlayer(
  playerId: string,
  username: string,
  nowMs: number
): PlayerState {
  return {
  playerId,
  username,
  position: { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z },
  velocity: { x: 0, z: 0 },
  speed: PLAYER_SPEED,
  lastSeenMs: nowMs,
};
}

import { redis } from '@devvit/web/server';
import {
  DEFAULT_PLAYER_SPAWN,
  type PlayerState,
} from '../../shared/game-state';
import { PLAYER_SPEED } from '../../shared/content';
import { MAX_STRUCTURES } from '../config';
import { KEYS } from '../core/keys';

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

export async function touchPlayerPresence(player: PlayerState): Promise<void> {
  await Promise.all([
    redis.hSet(KEYS.PLAYERS, { [player.playerId]: JSON.stringify(player) }),
    redis.zAdd(KEYS.SEEN, {
      member: player.playerId,
      score: player.lastSeenMs,
    }),
  ]);
}

export async function removePlayers(playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;
  await Promise.all([
    redis.hDel(KEYS.PLAYERS, playerIds),
    redis.hDel(KEYS.INTENTS, playerIds),
    redis.zRem(KEYS.SEEN, playerIds),
  ]);
}

export async function removeOldPlayersByLastSeen(
  cutoffMs: number,
  limit = 250
): Promise<string[]> {
  const stale = await redis.zRange(KEYS.SEEN, 0, cutoffMs, {
    by: 'score',
    limit: { offset: 0, count: limit },
  });
  if (stale.length === 0) return [];
  const playerIds = stale.map((entry) => entry.member);
  await removePlayers(playerIds);
  return playerIds;
}

export async function enforceStructureCap(incomingCount = 1): Promise<boolean> {
  const count = await redis.hLen(KEYS.STRUCTURES);
  const safeIncoming = Math.max(0, Math.floor(incomingCount));
  return count + safeIncoming <= MAX_STRUCTURES;
}

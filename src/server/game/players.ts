import { redis } from '@devvit/web/server';
import {
  DEFAULT_PLAYER_SPAWN,
  type PlayerState,
} from '../../shared/game-state';
import { PLAYER_SPEED } from '../../shared/content';
import { MAX_STRUCTURES, PLAYER_TIMEOUT_MS } from '../config';
import { KEYS } from '../core/keys';

const PLAYER_TTL_SECONDS = Math.ceil(PLAYER_TIMEOUT_MS / 1000);

export function createDefaultPlayer(
  playerId: string,
  username: string,
  nowMs: number
): PlayerState {
  return {
    playerId,
    username,
    position: { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z },
    speed: PLAYER_SPEED,
    lastSeenMs: nowMs,
  };
}

export async function touchPlayerPresence(player: PlayerState): Promise<void> {
  const key = KEYS.playerPresence(player.playerId);
  await Promise.all([
    redis.set(key, JSON.stringify(player), {
      expiration: new Date(Date.now() + PLAYER_TTL_SECONDS * 1000),
    }),
    redis.hSet(KEYS.PLAYER_IDS, { [player.playerId]: '1' }),
  ]);
}

export async function enforceStructureCap(incomingCount = 1): Promise<boolean> {
  const count = await redis.hLen(KEYS.STRUCTURES);
  const safeIncoming = Math.max(0, Math.floor(incomingCount));
  return count + safeIncoming <= MAX_STRUCTURES;
}

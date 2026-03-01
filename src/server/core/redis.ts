import { redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';

/**
 * The keys used for the Redis database.
 */
export const KEYS = {
  META: 'meta',
  PLAYERS: 'p:all',
  INTENTS: 'intents',
  STRUCTURES: 'structures',
  MOBS: 'mobs',
  WAVE: 'wave',
  QUEUE: 'queue',
  SEEN: 'seen',
  SNAPS: 'snaps',
  LEADER_LOCK: 'leaderLock',
  CASTLE_COIN_BALANCE: 'castle:coins',
  PLAYER: (userId: T2) => `p:${userId}`, // Hash
} as const;

/**
 * Field names for Redis hashes.
 */
export const FIELDS = {
  USER_COIN_BALANCE: 'coins',
  USER_COIN_LAST_ACCRUED_MS: 'lastAccruedMs',
} as const;

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Acquire a lock on a given key using SET NX with expiration.
 */
export async function acquireLock(
  key: string,
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> {
  const result = await redis.set(key, ownerToken, {
    expiration: new Date(Date.now() + ttlSeconds * 1000),
    nx: true,
  });
  return Boolean(result);
}

/**
 * Verify that the given token is the owner of the lock on a key.
 */
export async function verifyLock(
  key: string,
  ownerToken: string
): Promise<boolean> {
  const current = await redis.get(key);
  return current === ownerToken;
}

/**
 * Refresh the TTL on a lock, only if the caller still owns it.
 */
export async function refreshLock(
  key: string,
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> {
  const current = await redis.get(key);
  if (current !== ownerToken) return false;
  await redis.expire(key, ttlSeconds);
  return true;
}

/**
 * Release a lock using an optimistic transaction to avoid deleting a stolen lock.
 */
export async function releaseLock(
  key: string,
  ownerToken: string
): Promise<void> {
  const tx = await redis.watch(key);
  const current = await redis.get(key);
  if (current !== ownerToken) {
    await tx.unwatch();
    return;
  }
  await tx.multi();
  await tx.del(key);
  await tx.exec();
}

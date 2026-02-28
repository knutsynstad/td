import { redis } from '@devvit/web/server';
import { T2 } from '@devvit/web/shared';

/**
 * The keys used for the Redis database.
 */
export const KEYS = {
  META: 'meta',
  PLAYERS: 'players',
  INTENTS: 'intents',
  STRUCTURES: 'structures',
  MOBS: 'mobs',
  WAVE: 'wave',
  QUEUE: 'queue',
  SEEN: 'seen',
  SNAPS: 'snaps',
  LEADER_LOCK: 'leaderLock',
  CASTLE_COIN_BALANCE: 'castle:coins',
  PLAYER: (userId: T2) => `player:${userId}`, // Hash
} as const;

/**
 * Field names for Redis hashes.
 */
export const FIELDS = {
  USER_COIN_BALANCE: 'balance',
  USER_COIN_LAST_ACCRUED_MS: 'lastAccruedMs',
} as const;

/**
 * Sleep for a given number of milliseconds.
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves when the sleep is complete.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Acquire a lock on a given key.
 * @param key - The key to acquire the lock on.
 * @param ownerToken - The token of the owner of the lock.
 * @param ttlSeconds - The time to live for the lock in seconds.
 * @returns A promise that resolves to true if the lock was acquired, false otherwise.
 */
export const acquireLock = async (
  key: string,
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const result = await redis.set(key, ownerToken, {
    expiration: new Date(Date.now() + ttlSeconds * 1000),
    nx: true,
  });
  return Boolean(result);
};

/**
 * Verify that the given token is the owner of the lock on the given key.
 * @param key - The key to verify the lock on.
 * @param ownerToken - The token of the owner of the lock.
 * @returns A promise that resolves to true if the token is the owner of the lock, false otherwise.
 */
export const verifyLock = async (
  key: string,
  ownerToken: string
): Promise<boolean> => {
  const current = await redis.get(key);
  return current === ownerToken;
};

/**
 * Refresh the lock on a given key.
 * @param key - The key to refresh the lock on.
 * @param ownerToken - The token of the owner of the lock.
 * @param ttlSeconds - The time to live for the lock in seconds.
 * @returns A promise that resolves to true if the lock was refreshed, false otherwise.
 */
export const refreshLock = async (
  key: string,
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const current = await redis.get(key);
  if (current !== ownerToken) return false;
  await redis.expire(key, ttlSeconds);
  return true;
};

/**
 * Release a lock on a given key.
 * @param key - The key to release the lock on.
 * @param ownerToken - The token of the owner of the lock.
 * @returns A promise that resolves when the lock is released.
 */
export const releaseLock = async (
  key: string,
  ownerToken: string
): Promise<void> => {
  const tx = await redis.watch(key);
  const current = await redis.get(key);
  if (current !== ownerToken) {
    await tx.unwatch();
    return;
  }
  await tx.multi();
  await tx.del(key);
  await tx.exec();
};

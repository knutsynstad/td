import { redis } from '@devvit/web/server';
import {
  acquireLock,
  verifyLock,
  refreshLock,
  releaseLock,
} from '../core/lock';
import { getGameRedisKeys } from './keys';

export const acquireLeaderLock = async (
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  return acquireLock(keys.leaderLock, ownerToken, ttlSeconds);
};

export const verifyLeaderLock = async (
  ownerToken: string
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  return verifyLock(keys.leaderLock, ownerToken);
};

export const refreshLeaderLock = async (
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  return refreshLock(keys.leaderLock, ownerToken, ttlSeconds);
};

export const releaseLeaderLock = async (
  ownerToken: string
): Promise<void> => {
  const keys = getGameRedisKeys();
  return releaseLock(keys.leaderLock, ownerToken);
};

export const markTickPublish = async (tickSeq: number): Promise<void> => {
  const keys = getGameRedisKeys();
  await redis.set(
    keys.lastPublishTickSeq,
    String(Math.max(0, Math.floor(tickSeq)))
  );
};

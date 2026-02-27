import { redis } from '@devvit/web/server';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

export const verifyLock = async (
  key: string,
  ownerToken: string
): Promise<boolean> => {
  const current = await redis.get(key);
  return current === ownerToken;
};

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

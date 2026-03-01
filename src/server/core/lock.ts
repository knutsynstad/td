import { redis } from '@devvit/web/server';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function acquireLock(
  key: string,
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> {
  const result = await redis.set(key, ownerToken, {
    expiration: new Date(Date.now() + ttlSeconds * 1_000),
    nx: true,
  });
  return Boolean(result);
}

export async function verifyLock(
  key: string,
  ownerToken: string
): Promise<boolean> {
  const current = await redis.get(key);
  return current === ownerToken;
}

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

export async function forceDeleteLock(key: string): Promise<void> {
  await redis.del(key);
}

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

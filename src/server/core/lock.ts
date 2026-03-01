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

export async function writeHeartbeat(key: string): Promise<void> {
  await redis.set(key, String(Date.now()), {
    expiration: new Date(Date.now() + 30_000),
  });
}

export async function readHeartbeat(key: string): Promise<number | null> {
  const val = await redis.get(key);
  if (!val) return null;
  const ts = parseInt(val, 10);
  return isNaN(ts) ? null : ts;
}

export async function forceDeleteLock(key: string): Promise<void> {
  await redis.del(key);
}

export async function getLeaderStartMs(key: string): Promise<number | null> {
  const value = await redis.get(key);
  if (!value) return null;
  const ts = parseInt(value.split(':')[1] ?? '', 10);
  return isNaN(ts) ? null : ts;
}

async function checkHeartbeatStale(
  heartbeatKey: string,
  heartbeatStaleMs: number
): Promise<boolean> {
  const hb = await readHeartbeat(heartbeatKey);
  if (hb === null) return false;
  return Date.now() - hb > heartbeatStaleMs;
}

export async function registerFollower(
  key: string,
  token: string,
  ttlSeconds: number
): Promise<void> {
  await redis.set(key, token, {
    expiration: new Date(Date.now() + ttlSeconds * 1_000),
  });
}

export async function isActiveFollower(
  key: string,
  token: string
): Promise<boolean> {
  const current = await redis.get(key);
  return current === token;
}

export async function clearFollower(key: string): Promise<void> {
  await redis.del(key);
}

export async function waitForLock(
  key: string,
  ownerToken: string,
  ttlSeconds: number,
  waitMs: number,
  pollIntervalMs: number,
  aggressivePollWindowMs?: number,
  aggressivePollIntervalMs?: number,
  heartbeatKey?: string,
  heartbeatStaleMs?: number,
  shouldContinue?: () => Promise<boolean>
): Promise<boolean> {
  const deadline = Date.now() + waitMs;

  if (aggressivePollWindowMs && aggressivePollIntervalMs) {
    const leaderStart = await getLeaderStartMs(key);
    if (leaderStart !== null) {
      const expectedRelease = leaderStart + (waitMs - aggressivePollWindowMs);
      const coarseSleepTarget = Math.max(
        0,
        Math.min(
          expectedRelease - aggressivePollWindowMs - Date.now(),
          deadline - aggressivePollWindowMs - Date.now()
        )
      );

      let coarseSlept = 0;
      while (coarseSlept < coarseSleepTarget && Date.now() < deadline) {
        if (shouldContinue && !(await shouldContinue())) return false;

        const chunk = Math.min(pollIntervalMs, coarseSleepTarget - coarseSlept);
        await sleep(chunk);
        coarseSlept += chunk;

        if (heartbeatKey && heartbeatStaleMs) {
          const stale = await checkHeartbeatStale(
            heartbeatKey,
            heartbeatStaleMs
          );
          if (stale) {
            await forceDeleteLock(key);
            const acquired = await acquireLock(key, ownerToken, ttlSeconds);
            if (acquired) return true;
          }
        }
      }

      while (Date.now() < deadline) {
        if (shouldContinue && !(await shouldContinue())) return false;

        const acquired = await acquireLock(key, ownerToken, ttlSeconds);
        if (acquired) return true;

        if (heartbeatKey && heartbeatStaleMs) {
          const stale = await checkHeartbeatStale(
            heartbeatKey,
            heartbeatStaleMs
          );
          if (stale) {
            await forceDeleteLock(key);
            const retried = await acquireLock(key, ownerToken, ttlSeconds);
            if (retried) return true;
          }
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(aggressivePollIntervalMs, remaining));
      }
      return false;
    }
  }

  while (Date.now() < deadline) {
    if (shouldContinue && !(await shouldContinue())) return false;

    const acquired = await acquireLock(key, ownerToken, ttlSeconds);
    if (acquired) return true;

    if (heartbeatKey && heartbeatStaleMs) {
      const stale = await checkHeartbeatStale(heartbeatKey, heartbeatStaleMs);
      if (stale) {
        await forceDeleteLock(key);
        const retried = await acquireLock(key, ownerToken, ttlSeconds);
        if (retried) return true;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  return false;
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

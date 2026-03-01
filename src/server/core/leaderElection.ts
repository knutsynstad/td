import { redis } from '@devvit/web/server';
import {
  acquireLock,
  forceDeleteLock,
  sleep,
} from './lock';

export type LeaderHeartbeat = {
  key: string;
  staleMs: number;
};

export type AggressivePoll = {
  windowMs: number;
  intervalMs: number;
};

export type PollForLeadershipOptions = {
  lockKey: string;
  candidateToken: string;
  lockTtlSeconds: number;
  waitMs: number;
  pollIntervalMs: number;
  aggressivePoll?: AggressivePoll;
  heartbeat?: LeaderHeartbeat;
  shouldContinue?: () => Promise<boolean>;
};

/**
 * Write current timestamp to the heartbeat key.
 * Leader writes; followers use this to detect stale leaders.
 */
export async function writeLeaderHeartbeat(key: string): Promise<void> {
  await redis.set(key, String(Date.now()), {
    expiration: new Date(Date.now() + 30_000),
  });
}

/**
 * Read last heartbeat timestamp.
 */
export async function readLeaderHeartbeat(key: string): Promise<number | null> {
  const val = await redis.get(key);
  if (!val) return null;
  const ts = parseInt(val, 10);
  return isNaN(ts) ? null : ts;
}

function isLeaderHeartbeatStale(
  heartbeat: LeaderHeartbeat,
  lastMs: number | null
): boolean {
  if (lastMs === null) return false;
  return Date.now() - lastMs > heartbeat.staleMs;
}

/**
 * Parse leader start time from lock value.
 * Expects format: leader:${timestamp}:${random}
 */
export async function parseLeaderStartTimeMs(
  lockKey: string
): Promise<number | null> {
  const value = await redis.get(lockKey);
  if (!value) return null;
  const ts = parseInt(value.split(':')[1] ?? '', 10);
  return isNaN(ts) ? null : ts;
}

/**
 * Register as the active candidate at the follower gate.
 * Only one candidate can hold the gate; used to gate polling.
 */
export async function registerFollowerGate(
  gateKey: string,
  token: string,
  ttlSeconds: number
): Promise<void> {
  await redis.set(gateKey, token, {
    expiration: new Date(Date.now() + ttlSeconds * 1_000),
  });
}

/**
 * Check if the given token still holds the follower gate.
 */
export async function isFollowerGateActive(
  gateKey: string,
  token: string
): Promise<boolean> {
  const current = await redis.get(gateKey);
  return current === token;
}

/**
 * Clear the follower gate (caller acquired leadership).
 */
export async function clearFollowerGate(gateKey: string): Promise<void> {
  await redis.del(gateKey);
}

/**
 * Poll until leadership is acquired or deadline expires.
 * Supports: aggressive poll near expected release, heartbeat-based takeover,
 * and abort via shouldContinue.
 */
export async function pollForLeadership(
  options: PollForLeadershipOptions
): Promise<boolean> {
  const {
    lockKey,
    candidateToken,
    lockTtlSeconds,
    waitMs,
    pollIntervalMs,
    aggressivePoll,
    heartbeat,
    shouldContinue,
  } = options;

  const deadline = Date.now() + waitMs;

  if (aggressivePoll) {
    const leaderStart = await parseLeaderStartTimeMs(lockKey);
    if (leaderStart !== null) {
      const expectedRelease = leaderStart + (waitMs - aggressivePoll.windowMs);
      const coarseSleepTarget = Math.max(
        0,
        Math.min(
          expectedRelease - aggressivePoll.windowMs - Date.now(),
          deadline - aggressivePoll.windowMs - Date.now()
        )
      );

      let coarseSlept = 0;
      while (coarseSlept < coarseSleepTarget && Date.now() < deadline) {
        if (shouldContinue && !(await shouldContinue())) return false;

        const chunk = Math.min(pollIntervalMs, coarseSleepTarget - coarseSlept);
        await sleep(chunk);
        coarseSlept += chunk;

        if (heartbeat) {
          const last = await readLeaderHeartbeat(heartbeat.key);
          if (isLeaderHeartbeatStale(heartbeat, last)) {
            await forceDeleteLock(lockKey);
            const acquired = await acquireLock(
              lockKey,
              candidateToken,
              lockTtlSeconds
            );
            if (acquired) return true;
          }
        }
      }

      while (Date.now() < deadline) {
        if (shouldContinue && !(await shouldContinue())) return false;

        const acquired = await acquireLock(
          lockKey,
          candidateToken,
          lockTtlSeconds
        );
        if (acquired) return true;

        if (heartbeat) {
          const last = await readLeaderHeartbeat(heartbeat.key);
          if (isLeaderHeartbeatStale(heartbeat, last)) {
            await forceDeleteLock(lockKey);
            const retried = await acquireLock(
              lockKey,
              candidateToken,
              lockTtlSeconds
            );
            if (retried) return true;
          }
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(aggressivePoll.intervalMs, remaining));
      }
      return false;
    }
  }

  while (Date.now() < deadline) {
    if (shouldContinue && !(await shouldContinue())) return false;

    const acquired = await acquireLock(
      lockKey,
      candidateToken,
      lockTtlSeconds
    );
    if (acquired) return true;

    if (heartbeat) {
      const last = await readLeaderHeartbeat(heartbeat.key);
      if (isLeaderHeartbeatStale(heartbeat, last)) {
        await forceDeleteLock(lockKey);
        const retried = await acquireLock(
          lockKey,
          candidateToken,
          lockTtlSeconds
        );
        if (retried) return true;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  return false;
}

import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { runMaintenance, runSchedulerTick } from '../game/service';

type TaskResponse = {
  status: 'success' | 'error';
  stalePlayers?: number;
  tickSeq?: number;
  worldVersion?: number;
  eventCount?: number;
  remainingSteps?: number;
  message?: string;
};

export const schedulerRoutes = new Hono();
const SCHEDULER_TICK_INTERVAL_MS = 100;
const SCHEDULER_TICK_WINDOW_MS =
  process.env.NODE_ENV === 'test' ? 250 : 60_000;
const SCHEDULER_TICK_LOCK_TTL_SECONDS =
  process.env.NODE_ENV === 'test' ? 5 : 70;
const SCHEDULER_TICK_LOCK_PREFIX = 'game:tick:lock:';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getLockScope = (): string =>
  context.subredditId ?? context.subredditName ?? 'global';

const getTickLockKey = (scope: string): string =>
  `${SCHEDULER_TICK_LOCK_PREFIX}${scope}`;

const createOwnerToken = (scope: string): string =>
  `${scope}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

schedulerRoutes.post('/game-maintenance', async (c) => {
  try {
    const result = await runMaintenance();
    return c.json<TaskResponse>({
      status: 'success',
      stalePlayers: result.stalePlayers,
    });
  } catch (error) {
    return c.json<TaskResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'maintenance failed',
      },
      500
    );
  }
});

schedulerRoutes.post('/game-tick', async (c) => {
  const scope = getLockScope();
  const lockKey = getTickLockKey(scope);
  const ownerToken = createOwnerToken(scope);
  const startedAt = Date.now();
  const endAt = startedAt + SCHEDULER_TICK_WINDOW_MS;
  let nextTickAt = startedAt;
  let lastResult:
    | {
        tickSeq: number;
        worldVersion: number;
        eventCount: number;
        remainingSteps: number;
      }
    | undefined;

  try {
    await redis.set(lockKey, ownerToken, {
      expiration: new Date(Date.now() + SCHEDULER_TICK_LOCK_TTL_SECONDS * 1000),
    });
  } catch (error) {
    return c.json<TaskResponse>(
      {
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'tick lock acquisition failed',
      },
      500
    );
  }

  try {
    while (Date.now() < endAt) {
      const nowMs = Date.now();
      if (nowMs < nextTickAt) {
        await sleep(nextTickAt - nowMs);
      }

      const currentOwner = await redis.get(lockKey);
      if (currentOwner !== ownerToken) {
        break;
      }

      await redis.expire(lockKey, SCHEDULER_TICK_LOCK_TTL_SECONDS);
      lastResult = await runSchedulerTick();

      const afterRunMs = Date.now();
      const intervalsElapsed = Math.max(
        1,
        Math.ceil((afterRunMs - startedAt) / SCHEDULER_TICK_INTERVAL_MS)
      );
      nextTickAt = startedAt + intervalsElapsed * SCHEDULER_TICK_INTERVAL_MS;
    }

    return c.json<TaskResponse>({
      status: 'success',
      tickSeq: lastResult?.tickSeq,
      worldVersion: lastResult?.worldVersion,
      eventCount: lastResult?.eventCount,
      remainingSteps: lastResult?.remainingSteps,
    });
  } catch (error) {
    return c.json<TaskResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'tick failed',
      },
      500
    );
  } finally {
    const currentOwner = await redis.get(lockKey);
    if (currentOwner === ownerToken) {
      await redis.del(lockKey);
    }
  }
});

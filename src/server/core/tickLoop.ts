import {
  acquireLock,
  clearFollower,
  isActiveFollower,
  refreshLock,
  registerFollower,
  releaseLock,
  sleep,
  verifyLock,
  waitForLock,
  writeHeartbeat,
} from './lock';

/*
 * Types
 */

export type TickLoopConfig = {
  windowMs: number;
  tickIntervalMs: number;
  lockKey: string;
  lockTtlSeconds: number;
  lockRefreshIntervalTicks: number;
  channelName: string;
  followerPollMs?: number;
  followerPollIntervalMs?: number;
  followerAggressivePollWindowMs?: number;
  followerAggressivePollIntervalMs?: number;
  heartbeatKey?: string;
  heartbeatStaleMs?: number;
  followerGateKey?: string;
  followerGateTtlSeconds?: number;
};

export type TickContext = {
  nowMs: number;
  ticksProcessed: number;
};

export type TickResult = {
  tickSeq: number;
  commandCount: number;
  deltaCount: number;
};

type TickLoopHandlers<TState> = {
  onInit: () => Promise<TState>;
  onTick: (state: TState, ctx: TickContext) => Promise<TickResult>;
  onTeardown: (state: TState) => Promise<void>;
};

type TickLoopResult = {
  ownerToken: string;
  durationMs: number;
  ticksProcessed: number;
};

/**
 * Create a unique owner token for the tick loop.
 */
function createOwnerToken(): string {
  return `leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generic tick loop: acquire a lock (optionally polling as a follower),
 * run ticks at a fixed interval for a time window, then teardown.
 * Total invocation time is capped so the loop + any follower wait fits
 * within the platform request timeout.
 */
export async function runTickLoop<TState>(
  config: TickLoopConfig,
  handlers: TickLoopHandlers<TState>
): Promise<TickLoopResult> {
  const ownerToken = createOwnerToken();
  const invocationStartedAt = Date.now();
  let ticksProcessed = 0;

  let acquired = await acquireLock(
    config.lockKey,
    ownerToken,
    config.lockTtlSeconds
  );

  if (!acquired && config.followerPollMs && config.followerPollIntervalMs) {
    if (config.followerGateKey && config.followerGateTtlSeconds) {
      await registerFollower(
        config.followerGateKey,
        ownerToken,
        config.followerGateTtlSeconds
      );
    }

    const shouldContinue = config.followerGateKey
      ? () => isActiveFollower(config.followerGateKey!, ownerToken)
      : undefined;

    acquired = await waitForLock(
      config.lockKey,
      ownerToken,
      config.lockTtlSeconds,
      config.followerPollMs,
      config.followerPollIntervalMs,
      config.followerAggressivePollWindowMs,
      config.followerAggressivePollIntervalMs,
      config.heartbeatKey,
      config.heartbeatStaleMs,
      shouldContinue
    );

    if (acquired && config.followerGateKey) {
      await clearFollower(config.followerGateKey);
    }
  }

  if (!acquired) {
    return {
      ownerToken,
      durationMs: Date.now() - invocationStartedAt,
      ticksProcessed: 0,
    };
  }

  const tickStartedAt = Date.now();
  const timeSpentWaiting = tickStartedAt - invocationStartedAt;
  const remainingWindowMs = Math.max(0, config.windowMs - timeSpentWaiting);
  const endAt = tickStartedAt + remainingWindowMs;
  let nextTick = tickStartedAt;

  if (config.heartbeatKey) {
    await writeHeartbeat(config.heartbeatKey);
  }

  const state = await handlers.onInit();

  try {
    while (Date.now() < endAt) {
      const now = Date.now();
      if (now < nextTick) {
        await sleep(nextTick - now);
      }

      const nowMs = Date.now();

      if (
        ticksProcessed > 0 &&
        ticksProcessed % config.lockRefreshIntervalTicks === 0
      ) {
        const stillOwner = await verifyLock(config.lockKey, ownerToken);
        if (!stillOwner) {
          break;
        }
        const stillRefreshed = await refreshLock(
          config.lockKey,
          ownerToken,
          config.lockTtlSeconds
        );
        if (!stillRefreshed) {
          break;
        }
        if (config.heartbeatKey) {
          await writeHeartbeat(config.heartbeatKey);
        }
      }

      await handlers.onTick(state, {
        nowMs,
        ticksProcessed,
      });

      ticksProcessed += 1;

      const afterSend = Date.now();
      const intervalsElapsed = Math.max(
        1,
        Math.ceil((afterSend - tickStartedAt) / config.tickIntervalMs)
      );
      nextTick = tickStartedAt + intervalsElapsed * config.tickIntervalMs;
    }
  } catch {
    // Tick errors are non-fatal; teardown and lock release still happen below.
  } finally {
    try {
      await handlers.onTeardown(state);
    } catch {
      // Teardown errors are non-fatal; the lock is released below.
    }
    await releaseLock(config.lockKey, ownerToken);
  }

  const durationMs = Date.now() - invocationStartedAt;
  return { ownerToken, durationMs, ticksProcessed };
}

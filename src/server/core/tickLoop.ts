import {
  acquireLock,
  refreshLock,
  releaseLock,
  sleep,
  verifyLock,
} from './lock';

export type TickLoopConfig = {
  windowMs: number;
  tickIntervalMs: number;
  lockKey: string;
  lockTtlSeconds: number;
  lockRefreshIntervalTicks: number;
  channelName: string;
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

export type TickLoopHandlers<TState> = {
  onInit: () => Promise<TState>;
  onTick: (state: TState, ctx: TickContext) => Promise<TickResult>;
  onTeardown: (state: TState) => Promise<void>;
};

export type TickLoopResult = {
  ownerToken: string;
  durationMs: number;
  ticksProcessed: number;
};

function createOwnerToken(): string {
  return `leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generic tick loop: acquire a lock, run ticks at a fixed interval for a time window, then teardown.
 */
export async function runTickLoop<TState>(
  config: TickLoopConfig,
  handlers: TickLoopHandlers<TState>
): Promise<TickLoopResult> {
  const ownerToken = createOwnerToken();
  const startedAt = Date.now();
  const endAt = startedAt + config.windowMs;
  let nextTick = startedAt;
  let ticksProcessed = 0;

  const acquired = await acquireLock(
    config.lockKey,
    ownerToken,
    config.lockTtlSeconds
  );
  if (!acquired) {
    return {
      ownerToken,
      durationMs: Date.now() - startedAt,
      ticksProcessed: 0,
    };
  }

  console.info('Game loop started', {
    ownerToken,
    channel: config.channelName,
  });

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
          console.warn('Leader lock stolen, exiting loop', { ownerToken });
          break;
        }
        const stillRefreshed = await refreshLock(
          config.lockKey,
          ownerToken,
          config.lockTtlSeconds
        );
        if (!stillRefreshed) {
          console.warn('Leader lock lost during refresh', { ownerToken });
          break;
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
        Math.ceil((afterSend - startedAt) / config.tickIntervalMs)
      );
      nextTick = startedAt + intervalsElapsed * config.tickIntervalMs;
    }
  } catch (error) {
    console.error('Game loop error', { ownerToken, error });
  } finally {
    try {
      await handlers.onTeardown(state);
    } catch (teardownError) {
      console.error('Tick loop teardown failed', { ownerToken, teardownError });
    }
    await releaseLock(config.lockKey, ownerToken);
  }

  const durationMs = Date.now() - startedAt;
  console.info('Game loop ended', { ownerToken, durationMs, ticksProcessed });
  return { ownerToken, durationMs, ticksProcessed };
}

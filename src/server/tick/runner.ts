import {
  acquireLock,
  refreshLock,
  releaseLock,
  sleep,
  verifyLock,
} from '../core/lock';
import type { InstrumentationConfig } from './instrumentation';
import { createTickInstrumentation } from './instrumentation';
import { createGameLoopLogger } from './logger';
import { createTickTimer } from './timer';

export type TickLoopConfig = {
  windowMs: number;
  tickIntervalMs: number;
  lockKey: string;
  lockTtlSeconds: number;
  lockRefreshIntervalTicks: number;
  channelName: string;
  instrumentation: InstrumentationConfig;
};

export type TickContext = {
  nowMs: number;
  ticksProcessed: number;
  timer: ReturnType<typeof createTickTimer>;
};

export type TickResult = {
  tickSeq: number;
  commandCount: number;
  deltaCount: number;
  perf?: unknown;
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

const createOwnerToken = (): string =>
  `leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

export const runTickLoop = async <TState>(
  config: TickLoopConfig,
  handlers: TickLoopHandlers<TState>
): Promise<TickLoopResult> => {
  const ownerToken = createOwnerToken();
  const startedAt = Date.now();
  const endAt = startedAt + config.windowMs;
  let nextTick = startedAt;
  let ticksProcessed = 0;

  const logger = createGameLoopLogger();
  const instrumentation = createTickInstrumentation(config.instrumentation);
  const timer = createTickTimer();

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

  logger.onStarted(ownerToken, config.channelName);

  const state = await handlers.onInit();

  try {
    while (Date.now() < endAt) {
      const now = Date.now();
      if (now < nextTick) {
        await sleep(nextTick - now);
      }

      timer.startTick();
      const nowMs = Date.now();

      if (
        ticksProcessed > 0 &&
        ticksProcessed % config.lockRefreshIntervalTicks === 0
      ) {
        const stillOwner = await verifyLock(config.lockKey, ownerToken);
        if (!stillOwner) {
          logger.onLockStolen(ownerToken);
          break;
        }
        const stillRefreshed = await refreshLock(
          config.lockKey,
          ownerToken,
          config.lockTtlSeconds
        );
        if (!stillRefreshed) {
          logger.onLockLost(ownerToken);
          break;
        }
      }

      const result = await handlers.onTick(state, {
        nowMs,
        ticksProcessed,
        timer,
      });

      ticksProcessed += 1;

      const timing = timer.getTiming();
      instrumentation.recordTick({
        ...timing,
        tickSeq: result.tickSeq,
        commandCount: result.commandCount,
        deltaCount: result.deltaCount,
        ticksProcessed,
        perf: result.perf,
      });

      const afterSend = Date.now();
      const intervalsElapsed = Math.max(
        1,
        Math.ceil((afterSend - startedAt) / config.tickIntervalMs)
      );
      nextTick = startedAt + intervalsElapsed * config.tickIntervalMs;
    }
  } catch (error) {
    logger.onError(ownerToken, error);
  } finally {
    await handlers.onTeardown(state);
    await releaseLock(config.lockKey, ownerToken);
  }

  const durationMs = Date.now() - startedAt;
  logger.onEnded(ownerToken, durationMs, ticksProcessed);
  return { ownerToken, durationMs, ticksProcessed };
};

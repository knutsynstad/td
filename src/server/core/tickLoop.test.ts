import { vi, expect, describe, it, beforeEach, afterEach } from 'vitest';

vi.mock('./lock', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  verifyLock: vi.fn().mockResolvedValue(true),
  refreshLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { runTickLoop, type TickLoopConfig, type TickResult } from './tickLoop';
import { acquireLock, verifyLock, refreshLock, releaseLock } from './lock';

const baseConfig: TickLoopConfig = {
  windowMs: 100,
  tickIntervalMs: 25,
  lockKey: 'test-lock',
  lockTtlSeconds: 30,
  lockRefreshIntervalTicks: 5,
  channelName: 'test-channel',
};

const TICK_RESULT: TickResult = { tickSeq: 0, commandCount: 0, deltaCount: 0 };

describe('runTickLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: 1000 });
    vi.mocked(acquireLock).mockResolvedValue(true);
    vi.mocked(verifyLock).mockResolvedValue(true);
    vi.mocked(refreshLock).mockResolvedValue(true);
    vi.mocked(releaseLock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns 0 ticks when lock is not acquired', async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(false);
    const onInit = vi.fn();
    const onTick = vi.fn();
    const onTeardown = vi.fn();

    const result = await runTickLoop(baseConfig, {
      onInit,
      onTick,
      onTeardown,
    });

    expect(result.ticksProcessed).toBe(0);
    expect(onInit).not.toHaveBeenCalled();
    expect(onTick).not.toHaveBeenCalled();
    expect(onTeardown).not.toHaveBeenCalled();
  });

  it('runs ticks within the time window', async () => {
    const onInit = vi.fn().mockResolvedValue('state');
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(baseConfig.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    const result = await runTickLoop(baseConfig, {
      onInit,
      onTick,
      onTeardown,
    });

    expect(result.ticksProcessed).toBe(4);
    expect(onInit).toHaveBeenCalledOnce();
    expect(onTick).toHaveBeenCalledTimes(4);
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(onTeardown).toHaveBeenCalledWith('state');
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('refreshes lock at configured interval', async () => {
    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 200,
      lockRefreshIntervalTicks: 3,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(verifyLock).toHaveBeenCalledTimes(2);
    expect(refreshLock).toHaveBeenCalledTimes(2);
  });

  it('exits early when lock is stolen', async () => {
    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 200,
      lockRefreshIntervalTicks: 2,
    };
    vi.mocked(verifyLock).mockResolvedValueOnce(false);

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    const result = await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(result.ticksProcessed).toBe(2);
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('calls teardown and releaseLock even when onTick throws', async () => {
    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockRejectedValue(new Error('tick boom'));
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    const result = await runTickLoop(baseConfig, {
      onInit,
      onTick,
      onTeardown,
    });

    expect(result.ticksProcessed).toBe(0);
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});

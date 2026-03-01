import { vi, expect, describe, it, beforeEach, afterEach } from 'vitest';

vi.mock('./lock', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  verifyLock: vi.fn().mockResolvedValue(true),
  refreshLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
  waitForLock: vi.fn().mockResolvedValue(false),
  getLeaderStartMs: vi.fn().mockResolvedValue(null),
  writeHeartbeat: vi.fn().mockResolvedValue(undefined),
  readHeartbeat: vi.fn().mockResolvedValue(null),
  forceDeleteLock: vi.fn().mockResolvedValue(undefined),
  registerFollower: vi.fn().mockResolvedValue(undefined),
  isActiveFollower: vi.fn().mockResolvedValue(true),
  clearFollower: vi.fn().mockResolvedValue(undefined),
}));

import { runTickLoop, type TickLoopConfig, type TickResult } from './tickLoop';
import {
  acquireLock,
  clearFollower,
  isActiveFollower,
  verifyLock,
  refreshLock,
  registerFollower,
  releaseLock,
  waitForLock,
  writeHeartbeat,
} from './lock';

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
    vi.mocked(waitForLock).mockResolvedValue(false);
    vi.mocked(writeHeartbeat).mockResolvedValue(undefined);
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

  it('polls as follower when lock is held and follower config is set', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 100,
      followerPollMs: 80,
      followerPollIntervalMs: 10,
    };

    const onInit = vi.fn().mockResolvedValue('s');
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    const result = await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(waitForLock).toHaveBeenCalledWith(
      'test-lock',
      expect.any(String),
      30,
      80,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(onInit).toHaveBeenCalledOnce();
    expect(result.ticksProcessed).toBe(2);
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('returns 0 ticks when follower polling fails', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockResolvedValue(false);

    const config: TickLoopConfig = {
      ...baseConfig,
      followerPollMs: 50,
      followerPollIntervalMs: 10,
    };

    const onInit = vi.fn();
    const onTick = vi.fn();
    const onTeardown = vi.fn();

    const result = await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(waitForLock).toHaveBeenCalledOnce();
    expect(result.ticksProcessed).toBe(0);
    expect(onInit).not.toHaveBeenCalled();
  });

  it('forwards aggressive poll params to waitForLock', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      followerPollMs: 80,
      followerPollIntervalMs: 500,
      followerAggressivePollWindowMs: 2_000,
      followerAggressivePollIntervalMs: 50,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(waitForLock).toHaveBeenCalledWith(
      'test-lock',
      expect.any(String),
      30,
      80,
      500,
      2_000,
      50,
      undefined,
      undefined,
      undefined
    );
  });

  it('caps tick window by time spent as follower', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(80);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 100,
      followerPollMs: 90,
      followerPollIntervalMs: 10,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    const result = await runTickLoop(config, { onInit, onTick, onTeardown });

    // 80ms spent waiting, 20ms remaining window = 0 full ticks at 25ms interval
    // but the loop checks Date.now() < endAt *before* sleeping, so it should
    // not process any ticks if remaining time < tickInterval
    expect(result.ticksProcessed).toBeLessThanOrEqual(1);
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('writes heartbeat on acquire and during lock refresh', async () => {
    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 200,
      lockRefreshIntervalTicks: 3,
      heartbeatKey: 'hb',
      heartbeatStaleMs: 3_000,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    // 1 initial heartbeat + 2 refreshes (at tick 3 and tick 6) = 3 writes
    expect(writeHeartbeat).toHaveBeenCalledTimes(3);
    expect(writeHeartbeat).toHaveBeenCalledWith('hb');
  });

  it('passes heartbeat config to waitForLock', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      followerPollMs: 80,
      followerPollIntervalMs: 500,
      heartbeatKey: 'hb',
      heartbeatStaleMs: 3_000,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(waitForLock).toHaveBeenCalledWith(
      'test-lock',
      expect.any(String),
      30,
      80,
      500,
      undefined,
      undefined,
      'hb',
      3_000,
      undefined
    );
  });

  it('registers follower gate and passes shouldContinue to waitForLock', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 100,
      followerPollMs: 80,
      followerPollIntervalMs: 10,
      followerGateKey: 'fg',
      followerGateTtlSeconds: 15,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(registerFollower).toHaveBeenCalledWith('fg', expect.any(String), 15);
    expect(waitForLock).toHaveBeenCalledWith(
      'test-lock',
      expect.any(String),
      30,
      80,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.any(Function)
    );
    expect(clearFollower).toHaveBeenCalledWith('fg');
  });

  it('does not register follower gate when gate key is absent', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(waitForLock).mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return true;
    });

    const config: TickLoopConfig = {
      ...baseConfig,
      windowMs: 100,
      followerPollMs: 80,
      followerPollIntervalMs: 10,
    };

    const onInit = vi.fn().mockResolvedValue(null);
    const onTick = vi.fn().mockImplementation(async () => {
      vi.advanceTimersByTime(config.tickIntervalMs);
      return TICK_RESULT;
    });
    const onTeardown = vi.fn().mockResolvedValue(undefined);

    await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(registerFollower).not.toHaveBeenCalled();
    expect(clearFollower).not.toHaveBeenCalled();
  });

  it('exits follower wait when displaced by another follower', async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    vi.mocked(isActiveFollower).mockResolvedValue(false);
    vi.mocked(waitForLock).mockResolvedValue(false);

    const config: TickLoopConfig = {
      ...baseConfig,
      followerPollMs: 80,
      followerPollIntervalMs: 10,
      followerGateKey: 'fg',
      followerGateTtlSeconds: 15,
    };

    const onInit = vi.fn();
    const onTick = vi.fn();
    const onTeardown = vi.fn();

    const result = await runTickLoop(config, { onInit, onTick, onTeardown });

    expect(registerFollower).toHaveBeenCalledOnce();
    expect(result.ticksProcessed).toBe(0);
    expect(clearFollower).not.toHaveBeenCalled();
    expect(onInit).not.toHaveBeenCalled();
  });
});

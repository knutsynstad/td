import { describe, expect, it, vi } from 'vitest';
import { createClockSkew } from './clockSkew';

describe('createClockSkew', () => {
  it('toPerfTime converts server epoch to perf time after sync', () => {
    const baseDate = 1_000_000;
    const basePerf = 500;
    vi.setSystemTime(baseDate);
    vi.stubGlobal('performance', {
      now: () => basePerf,
    });

    const skew = createClockSkew();
    skew.sync(baseDate);

    const serverEpoch = baseDate + 100;
    const result = skew.toPerfTime(serverEpoch);

    expect(result).toBeCloseTo(basePerf + 100, 0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sync uses exponential smoothing after first sample', () => {
    vi.setSystemTime(1000);
    vi.stubGlobal('performance', { now: () => 0 });

    const skew = createClockSkew();
    skew.sync(1000);
    const first = skew.toPerfTime(1000);
    skew.sync(1000);
    const second = skew.toPerfTime(1000);

    expect(first).toBe(0);
    expect(second).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createDeltaBuffer } from './deltaBuffer';
import type { DeltaBatch } from '../../../shared/game-protocol';

const mkBatch = (tickSeq: number): DeltaBatch => ({
  tickSeq,
  worldVersion: 1,
  events: [
    {
      type: 'waveDelta',
      wave: { wave: 1, active: false, nextWaveAtMs: 0, spawners: [] },
    },
  ],
});

describe('createDeltaBuffer', () => {
  it('replayNewerThan only includes batches with tickSeq > threshold', () => {
    const buffer = createDeltaBuffer();
    buffer.push(mkBatch(10));
    buffer.push(mkBatch(20));
    buffer.push(mkBatch(30));

    const replayed: number[] = [];
    buffer.replayNewerThan(15, (_batch, _event, batchTickSeq) => {
      replayed.push(batchTickSeq);
    });

    expect(replayed).toEqual([20, 30]);
  });

  it('replayNewerThan skips batches at or below threshold', () => {
    const buffer = createDeltaBuffer();
    buffer.push(mkBatch(10));

    const replayed: number[] = [];
    buffer.replayNewerThan(10, (_batch, _event, batchTickSeq) => {
      replayed.push(batchTickSeq);
    });

    expect(replayed).toHaveLength(0);
  });

  it('clear empties buffer', () => {
    const buffer = createDeltaBuffer();
    buffer.push(mkBatch(10));
    buffer.clear();

    const replayed: number[] = [];
    buffer.replayNewerThan(0, (_batch, _event, batchTickSeq) => {
      replayed.push(batchTickSeq);
    });

    expect(replayed).toHaveLength(0);
  });

  it('evicts oldest batches when over capacity', () => {
    vi.stubGlobal('performance', { now: () => 0 });
    const buffer = createDeltaBuffer();
    for (let i = 0; i < 60; i++) {
      buffer.push(mkBatch(i));
    }

    const replayed: number[] = [];
    buffer.replayNewerThan(-1, (_batch, _event, batchTickSeq) => {
      replayed.push(batchTickSeq);
    });

    expect(replayed.length).toBeLessThanOrEqual(50);
    vi.unstubAllGlobals();
  });
});

import type { DeltaBatch } from '../../../shared/game-protocol';

const MAX_BATCHES = 50;
const MAX_MS = 10_000;

type BufferedBatch = { batch: DeltaBatch; receivedAtMs: number };

export type DeltaBuffer = {
  push: (batch: DeltaBatch) => void;
  replayNewerThan: (
    tickSeq: number,
    callback: (batch: DeltaBatch, event: unknown, batchTickSeq: number) => void
  ) => void;
  clear: () => void;
};

export const createDeltaBuffer = (): DeltaBuffer => {
  const buffer: BufferedBatch[] = [];

  const push = (batch: DeltaBatch): void => {
    const receivedAtMs =
      typeof performance !== 'undefined' ? performance.now() : 0;
    buffer.push({ batch, receivedAtMs });
    while (buffer.length > MAX_BATCHES) {
      buffer.shift();
    }
    const cutoffMs = receivedAtMs - MAX_MS;
    while (buffer.length > 0 && buffer[0]!.receivedAtMs < cutoffMs) {
      buffer.shift();
    }
  };

  const replayNewerThan = (
    tickSeq: number,
    callback: (batch: DeltaBatch, event: unknown, batchTickSeq: number) => void
  ): void => {
    for (const { batch } of buffer) {
      if (batch.tickSeq <= tickSeq) continue;
      for (const event of batch.events) {
        if (!event || typeof event !== 'object') continue;
        callback(batch, event, batch.tickSeq);
      }
    }
  };

  const clear = (): void => {
    buffer.length = 0;
  };

  return { push, replayNewerThan, clear };
};

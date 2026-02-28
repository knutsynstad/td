import { realtime } from '@devvit/web/server';
import type { JsonValue } from '@devvit/shared';

const encoder = new TextEncoder();

const jsonByteLength = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length;

export type BroadcastConfig = {
  maxBatchBytes: number;
  maxBatchEvents: number;
  envelopeOverhead: number;
};

export const broadcastBatched = async <T>(
  channel: string,
  events: T[],
  config: BroadcastConfig,
  wrapBatch: (batch: T[]) => JsonValue
): Promise<void> => {
  if (events.length === 0) return;

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBytes = config.envelopeOverhead;

  for (const event of events) {
    const eventBytes = jsonByteLength(event);

    const wouldExceedBytes =
      currentBatch.length > 0 &&
      currentBytes + eventBytes > config.maxBatchBytes;
    const wouldExceedCount = currentBatch.length >= config.maxBatchEvents;

    if (wouldExceedBytes || wouldExceedCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = config.envelopeOverhead;
    }

    currentBatch.push(event);
    currentBytes += eventBytes;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchEvents = batches[batchIndex]!;
    const payload = wrapBatch(batchEvents);
    try {
      await realtime.send(channel, payload);
    } catch (error) {
      const messageSizeBytes = encoder.encode(JSON.stringify(payload)).length;
      console.error('Realtime broadcast failed', {
        channel,
        eventCount: events.length,
        batchIndex,
        totalBatches: batches.length,
        batchEventCount: batchEvents.length,
        messageSizeBytes,
        error,
      });
    }
  }
};

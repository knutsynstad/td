import { realtime } from '@devvit/web/server';
import type { JsonValue } from '@devvit/shared';

/**
 * The channels used for the realtime communication.
 */
export const CHANNELS = {
  game: 'game_global',
} as const;

export const broadcastBatched = async <T>(
  channel: string,
  events: T[],
  maxBatchEvents: number,
  wrapBatch: (batch: T[]) => JsonValue
): Promise<void> => {
  if (events.length === 0) return;

  for (let i = 0; i < events.length; i += maxBatchEvents) {
    const batchEvents = events.slice(i, i + maxBatchEvents);
    const payload = wrapBatch(batchEvents);
    try {
      await realtime.send(channel, payload);
    } catch (error) {
      console.error('Realtime broadcast failed', { channel, error });
    }
  }
};

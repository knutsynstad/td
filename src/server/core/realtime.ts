import { realtime } from '@devvit/web/server';
import type { JsonValue } from '@devvit/shared';
import { MAX_BATCH_EVENTS } from '../config';

/**
 * The channels used for the realtime communication.
 */
export const CHANNELS = {
  game: 'game_global',
} as const;

/**
 * Broadcast a list of events to a channel, batched into chunks of MAX_BATCH_EVENTS per message.
 */
export async function broadcast<T>(
  channel: string,
  events: T[],
  wrapBatch: (batch: T[]) => JsonValue
): Promise<void> {
  if (events.length === 0) return;

  // TODO: Investigate sending messages in parallel and any additional client handling required to support out-of-order delivery.
  for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
    const batchEvents = events.slice(i, i + MAX_BATCH_EVENTS);
    const payload = wrapBatch(batchEvents);
    try {
      await realtime.send(channel, payload);
    } catch (error) {
      console.error('Realtime broadcast failed', { channel, error });
    }
  }
}

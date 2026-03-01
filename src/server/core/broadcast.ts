import { realtime } from '@devvit/web/server';
import type { DeltaBatch, GameDelta } from '../../shared/game-protocol';
import { MAX_BATCH_EVENTS } from '../config';

export const CHANNELS = {
  game: 'game_global',
} as const;

// Sends game state to clients. Triggered on ticks, join, heartbeat (when stale), and reset.
// Events: snapshots (wave, mob pool, player positions), incremental (structure, presence, moved players), or resyncRequired signal.
// TODO: Investigate sending messages in parallel and any additional client handling required to support out-of-order delivery.
export async function broadcast(
  worldVersion: number,
  tickSeq: number,
  events: GameDelta[]
): Promise<void> {
  if (events.length === 0) return;

  for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
    const batchEvents = events.slice(i, i + MAX_BATCH_EVENTS);
    const payload: DeltaBatch = { tickSeq, worldVersion, events: batchEvents };
    try {
      await realtime.send(CHANNELS.game, payload);
    } catch (error) {
      console.error('Realtime broadcast failed', {
        channel: CHANNELS.game,
        error,
      });
    }
  }
}

import { realtime } from '@devvit/web/server';
import type { DeltaBatch, GameDelta } from '../../shared/game-protocol';
import { MAX_BATCH_EVENTS } from '../config';

export const CHANNELS = {
  game: 'game_global',
} as const;

const BROADCAST_LOG_INTERVAL = 10;
let broadcastLogCounter = 0;

// Sends game state to clients. Triggered on ticks, join, heartbeat (when stale), and reset.
// Events: snapshots (wave, mob pool, player positions), incremental (structure, presence, moved players), or resyncRequired signal.
// TODO: Investigate sending messages in parallel and any additional client handling required to support out-of-order delivery.
export async function broadcast(
  worldVersion: number,
  tickSeq: number,
  events: GameDelta[],
  channelOverride?: string
): Promise<void> {
  if (events.length === 0) return;

  const channel = channelOverride ?? CHANNELS.game;

  for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
    const batchEvents = events.slice(i, i + MAX_BATCH_EVENTS);
    const payload: DeltaBatch = {
      tickSeq,
      worldVersion,
      channelId: channel,
      events: batchEvents,
    };
    try {
      broadcastLogCounter += 1;
      if (broadcastLogCounter % BROADCAST_LOG_INTERVAL === 0) {
        const payloadBytes = JSON.stringify(payload).length;
        const eventTypes = [...new Set(batchEvents.map((e) => e.type))];
        console.log('[Broadcast]', {
          tickSeq,
          events: batchEvents.length,
          types: eventTypes,
          bytes: payloadBytes,
          channel,
        });
      }
      await realtime.send(channel, payload);
    } catch (error) {
      console.error('Realtime broadcast failed', {
        channel,
        error,
      });
    }
  }
}

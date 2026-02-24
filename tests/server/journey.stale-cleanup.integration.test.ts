import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest(
  'heartbeat removes stale players and emits leave deltas',
  async ({ mocks }) => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    const joinBody = await joinResponse.json();
    const playerId = String(joinBody.playerId);
    const channel = String(joinBody.channel);

    const stalePlayerId = 'stale-player';
    const stalePlayer = {
      playerId: stalePlayerId,
      username: 'stale',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: 8,
      lastSeenMs: Date.now() - 30_000,
    };
    await redis.hSet('g:global:p', {
      [stalePlayerId]: JSON.stringify(stalePlayer),
    });
    await redis.hSet('g:global:i', {
      [stalePlayerId]: JSON.stringify({ updatedAtMs: stalePlayer.lastSeenMs }),
    });
    await redis.zAdd('g:global:ls', {
      member: stalePlayerId,
      score: stalePlayer.lastSeenMs,
    });

    const heartbeatResponse = await postJson(app, '/api/game/heartbeat', {
      playerId,
      position: { x: 10, z: 0 },
    });
    expect(heartbeatResponse.status).toBe(200);

    const resyncResponse = await postJson(app, '/api/game/resync', {
      tickSeq: 0,
      playerId,
    });
    const resyncBody = await resyncResponse.json();
    expect(resyncBody.snapshot.players[stalePlayerId]).toBeUndefined();

    const messages = mocks.realtime.getSentMessagesForChannel(channel);
    const events = messages.flatMap(
      (message) =>
        (
          message.data?.msg as
            | {
                events?: Array<{ type?: string; left?: { playerId?: string } }>;
              }
            | undefined
        )?.events ?? []
    );
    expect(
      events.some(
        (event) =>
          event.type === 'presenceDelta' &&
          event.left?.playerId === stalePlayerId
      )
    ).toBe(true);
  }
);

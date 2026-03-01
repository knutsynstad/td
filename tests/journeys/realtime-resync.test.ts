import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { KEYS } from '../../src/server/core/keys';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest(
  'realtime emits delta batches and resync returns snapshot',
  async ({ mocks }) => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    const joinBody = await joinResponse.json();
    const playerId = String(joinBody.playerId);
    const channel = String(joinBody.channel);

    await redis.hSet(KEYS.META, {
      lastTickMs: String(Date.now() - 60_000),
    });

    const heartbeatResponse = await postJson(app, '/api/game/heartbeat', {
      playerId,
      position: { x: 10, z: 0 },
    });
    expect(heartbeatResponse.status).toBe(200);

    const messages = mocks.realtime.getSentMessagesForChannel(channel);
    expect(messages.length).toBeGreaterThan(0);
    const payload = messages.at(-1)?.data?.msg as
      | { events?: Array<{ type?: string }> }
      | undefined;
    expect(Array.isArray(payload?.events)).toBe(true);
    expect(
      payload?.events?.some((event) => event.type === 'resyncRequired')
    ).toBe(true);

    const resyncResponse = await postJson(app, '/api/game/resync', {
      tickSeq: 0,
      playerId,
    });
    expect(resyncResponse.status).toBe(200);
    const resyncBody = await resyncResponse.json();
    expect(resyncBody.type).toBe('snapshot');
    expect(typeof resyncBody.snapshot.meta.coins).toBe('number');
  }
);

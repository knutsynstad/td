import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { KEYS } from '../../src/server/core/keys';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest(
  'expired player keys are excluded from resync snapshot',
  async () => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    const joinBody = await joinResponse.json();
    const playerId = String(joinBody.playerId);

    const stalePlayerId = 'stale-player';
    await redis.hSet(KEYS.PLAYER_IDS, { [stalePlayerId]: '1' });
    await redis.hSet(KEYS.INTENTS, {
      [stalePlayerId]: JSON.stringify({ updatedAtMs: Date.now() - 30_000 }),
    });

    const resyncResponse = await postJson(app, '/api/game/resync', {
      tickSeq: 0,
      playerId,
    });
    const resyncBody = await resyncResponse.json();
    expect(resyncBody.snapshot.players[stalePlayerId]).toBeUndefined();
  }
);

import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { KEYS, FIELDS } from '../../src/server/core/keys';
import {
  createTestApp,
  devvitTest,
  makeEnvelope,
  postJson,
  TEST_USER_ID,
} from '../helpers/devvitTest';

devvitTest(
  'player shoot mob: dealDamages accepted, damage applied, mob despawned, entityDelta broadcast',
  async ({ mocks }) => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    expect(joinResponse.status).toBe(200);
    const joinBody = await joinResponse.json();
    const playerId = String(joinBody.playerId);
    const channel = String(joinBody.channel);

    const now = Date.now();
    await redis.hSet(KEYS.META, {
      tickSeq: '1',
      worldVersion: '0',
      lastTickMs: String(now - 200),
      seed: '1',
      coins: '100',
      lives: '1',
      nextMobSeq: '2',
    });
    await redis.set(
      KEYS.WAVE,
      JSON.stringify({
        wave: 1,
        active: true,
        nextWaveAtMs: 0,
        spawners: [
          {
            spawnerId: 'wave-1-north',
            totalCount: 0,
            spawnedCount: 0,
            aliveCount: 1,
            spawnRatePerSecond: 0,
            spawnAccumulator: 0,
            gateOpen: true,
            routeState: 'reachable',
            route: [{ x: 0, z: 7 }],
          },
        ],
      })
    );
    await redis.hSet(KEYS.MOBS, {
      '1': JSON.stringify({
        mobId: '1',
        position: { x: 0, z: 6.5 },
        velocity: { x: 0, z: 0 },
        hp: 100,
        maxHp: 100,
        spawnerId: 'wave-1-north',
        routeIndex: 0,
      }),
    });
    await redis.hSet(KEYS.PLAYER(TEST_USER_ID), {
      [FIELDS.USER_COIN_BALANCE]: '100',
      [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(now),
    });

    const cmd = makeEnvelope(1, {
      type: 'dealDamages',
      hits: [{ mobId: '1', damage: 150, source: 'player', playerId }],
    });
    const commandResponse = await postJson(app, '/api/game/command', cmd);
    expect(commandResponse.status).toBe(200);
    const commandBody = await commandResponse.json();
    expect(commandBody.accepted).toBe(true);

    const tickResponse = await postJson(
      app,
      '/internal/scheduler/server-clock?windowMs=500',
      {}
    );
    expect(tickResponse.status).toBe(200);

    const messages = mocks.realtime.getSentMessagesForChannel(channel);
    expect(messages.length).toBeGreaterThan(0);

    const allEvents = messages.flatMap(
      (m) =>
        (
          m.data?.msg as {
            events?: Array<{
              type?: string;
              despawnedMobIds?: number[];
            }>;
          }
        )?.events ?? []
    );

    const entityDelta = allEvents.find((e) => e.type === 'entityDelta');
    expect(entityDelta).toBeDefined();
    expect(entityDelta?.despawnedMobIds).toContain(1);

    const resyncResponse = await postJson(app, '/api/game/resync', {
      tickSeq: 0,
      playerId,
    });
    expect(resyncResponse.status).toBe(200);
    const resyncBody = await resyncResponse.json();
    expect(resyncBody.type).toBe('snapshot');
    expect(resyncBody.snapshot.mobs).not.toHaveProperty('1');
  }
);

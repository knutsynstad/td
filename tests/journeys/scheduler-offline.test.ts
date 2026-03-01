import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { KEYS } from '../../src/server/core/keys';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest(
  'scheduler tick advances simulation without active players',
  async () => {
    const app = createTestApp();
    const now = Date.now();
    await redis.hSet(KEYS.META, {
      tickSeq: '1',
      worldVersion: '0',
      lastTickMs: String(now - 15_000),
      seed: '1',
      coins: '100',
      lives: '1',
    });
    await redis.set(
      KEYS.WAVE,
      JSON.stringify({
        wave: 1,
        active: true,
        nextWaveAtMs: 0,
        spawners: [
          {
            spawnerId: 'wave-1-east',
            totalCount: 10,
            spawnedCount: 0,
            aliveCount: 0,
            spawnRatePerSecond: 10,
            spawnAccumulator: 0,
            gateOpen: false,
          },
        ],
      })
    );

    const tickResponse = await postJson(
      app,
      '/internal/scheduler/server-clock?windowMs=500',
      {}
    );
    expect(tickResponse.status).toBe(200);
    const tickBody = await tickResponse.json();
    expect(tickBody.status).toBe('ok');
    expect(Number(tickBody.ticksProcessed)).toBeGreaterThan(0);
  }
);

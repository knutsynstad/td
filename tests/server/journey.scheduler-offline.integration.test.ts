import { expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest(
  'scheduler tick advances simulation without active players',
  async () => {
    const app = createTestApp();
    const now = Date.now();
    await redis.hSet('g:global:m', {
      tickSeq: '1',
      worldVersion: '0',
      lastTickMs: String(now - 15_000),
      seed: '1',
      energy: '100',
      lives: '1',
    });
    await redis.set(
      'g:global:w',
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
      '/internal/scheduler/server-clock',
      {}
    );
    expect(tickResponse.status).toBe(200);
    const tickBody = await tickResponse.json();
    expect(tickBody.status).toBe('success');
    expect(Number(tickBody.tickSeq)).toBeGreaterThan(1);
  }
);

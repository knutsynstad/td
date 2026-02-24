import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { joinGame, resetGame, resyncGame, runSchedulerTick } from './service';

const test = createDevvitTest();

test('runSchedulerTick returns progress fields', async () => {
  await joinGame();
  const result = await runSchedulerTick();
  expect(typeof result.tickSeq).toBe('number');
  expect(typeof result.worldVersion).toBe('number');
  expect(typeof result.eventCount).toBe('number');
  expect(typeof result.remainingSteps).toBe('number');
});

test('resetGame resets wave progression without economy tax', async () => {
  await joinGame();
  await runSchedulerTick();
  await resetGame();
  const snapshot = await resyncGame();
  expect(snapshot.snapshot.wave.wave).toBe(0);
  expect(snapshot.snapshot.wave.active).toBe(false);
  expect(snapshot.snapshot.wave.nextWaveAtMs).toBe(0);
  expect(Object.keys(snapshot.snapshot.mobs)).toHaveLength(0);
  expect(Object.keys(snapshot.snapshot.structures)).toHaveLength(0);
});

import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { joinGame, resetGame, resyncGame, runLeaderLoop } from './service';

const test = createDevvitTest();

test('runLeaderLoop returns result fields', async () => {
  await joinGame();
  const result = await runLeaderLoop(500);
  expect(typeof result.ownerToken).toBe('string');
  expect(typeof result.durationMs).toBe('number');
  expect(result.ticksProcessed).toBeGreaterThan(0);
});

test('resetGame resets wave progression without economy tax', async () => {
  await joinGame();
  await resetGame();
  const snapshot = await resyncGame();
  expect(snapshot.snapshot.wave.wave).toBe(0);
  expect(snapshot.snapshot.wave.active).toBe(false);
  expect(snapshot.snapshot.wave.nextWaveAtMs).toBe(0);
  expect(Object.keys(snapshot.snapshot.mobs)).toHaveLength(0);
  const structures = Object.values(snapshot.snapshot.structures);
  expect(structures.length).toBeGreaterThan(0);
  expect(structures.every((structure) => structure.ownerId === 'Map')).toBe(true);
});

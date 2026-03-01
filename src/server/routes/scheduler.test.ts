import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { runGameLoop } from '../simulation/gameLoop';

const test = createDevvitTest();

test('game loop processes ticks within short window', async () => {
  const result = await runGameLoop(500);
  expect(result.ticksProcessed).toBeGreaterThan(0);
  expect(result.durationMs).toBeGreaterThanOrEqual(400);
  expect(result.durationMs).toBeLessThan(3000);
});

test('scheduler maintenance route is importable', async () => {
  const { schedulerRoutes } = await import('./scheduler');
  expect(schedulerRoutes).toBeDefined();
});

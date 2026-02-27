import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { runLeaderLoop } from '../game';

const test = createDevvitTest();

test('leader loop processes ticks within short window', async () => {
  const result = await runLeaderLoop(500);
  expect(result.ticksProcessed).toBeGreaterThan(0);
  expect(result.durationMs).toBeGreaterThanOrEqual(400);
  expect(result.durationMs).toBeLessThan(3000);
});

test('scheduler maintenance route is importable', async () => {
  const { schedulerRoutes } = await import('./scheduler');
  expect(schedulerRoutes).toBeDefined();
});

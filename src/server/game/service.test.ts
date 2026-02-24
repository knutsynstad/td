import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { joinGame, runSchedulerTick } from './service';

const test = createDevvitTest();

test('runSchedulerTick returns progress fields', async () => {
  await joinGame('global');
  const result = await runSchedulerTick('global');
  expect(typeof result.tickSeq).toBe('number');
  expect(typeof result.worldVersion).toBe('number');
  expect(typeof result.eventCount).toBe('number');
  expect(typeof result.remainingSteps).toBe('number');
});

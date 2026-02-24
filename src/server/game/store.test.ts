import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import {
  acquireLeaderLock,
  markTickPublish,
  releaseLeaderLock,
  verifyLeaderLock,
} from './store';

const test = createDevvitTest();

test('acquire and release leader lock', async () => {
  const acquired = await acquireLeaderLock('owner-a', 70);
  expect(acquired).toBe(true);
  const isOwner = await verifyLeaderLock('owner-a');
  expect(isOwner).toBe(true);
  await releaseLeaderLock('owner-a');
  const afterRelease = await verifyLeaderLock('owner-a');
  expect(afterRelease).toBe(false);
});

test('markTickPublish stores sequence', async () => {
  await markTickPublish(42);
});

import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { acquireLock, releaseLock, verifyLock } from '../core/redis';
import { KEYS } from '../core/redis';

const test = createDevvitTest();

test('acquire and release leader lock', async () => {
  const acquired = await acquireLock(KEYS.leaderLock, 'owner-a', 70);
  expect(acquired).toBe(true);
  const isOwner = await verifyLock(KEYS.leaderLock, 'owner-a');
  expect(isOwner).toBe(true);
  await releaseLock(KEYS.leaderLock, 'owner-a');
  const afterRelease = await verifyLock(KEYS.leaderLock, 'owner-a');
  expect(afterRelease).toBe(false);
});

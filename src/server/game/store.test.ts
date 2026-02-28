import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { acquireLock, releaseLock, verifyLock } from '../core/lock';
import { getGameRedisKeys } from './keys';

const test = createDevvitTest();
const getKeys = () => getGameRedisKeys();

test('acquire and release leader lock', async () => {
  const keys = getKeys();
  const acquired = await acquireLock(keys.leaderLock, 'owner-a', 70);
  expect(acquired).toBe(true);
  const isOwner = await verifyLock(keys.leaderLock, 'owner-a');
  expect(isOwner).toBe(true);
  await releaseLock(keys.leaderLock, 'owner-a');
  const afterRelease = await verifyLock(keys.leaderLock, 'owner-a');
  expect(afterRelease).toBe(false);
});

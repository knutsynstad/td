import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import {
  acquireLock,
  forceDeleteLock,
  refreshLock,
  releaseLock,
  verifyLock,
} from './lock';
import { KEYS } from './keys';

const test = createDevvitTest();

const key = (suffix: string) => `lock-test:${suffix}`;

test('acquire and release leader lock', async () => {
  const acquired = await acquireLock(KEYS.LEADER_LOCK, 'owner-a', 70);
  expect(acquired).toBe(true);
  const isOwner = await verifyLock(KEYS.LEADER_LOCK, 'owner-a');
  expect(isOwner).toBe(true);
  await releaseLock(KEYS.LEADER_LOCK, 'owner-a');
  const afterRelease = await verifyLock(KEYS.LEADER_LOCK, 'owner-a');
  expect(afterRelease).toBe(false);
});

test('acquireLock returns false when lock already held', async () => {
  const k = key('acquire-held');
  const first = await acquireLock(k, 'owner-a', 70);
  expect(first).toBe(true);
  const second = await acquireLock(k, 'owner-b', 70);
  expect(second).toBe(false);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await releaseLock(k, 'owner-a');
});

test('verifyLock returns false for wrong owner', async () => {
  const k = key('verify-wrong');
  await acquireLock(k, 'owner-a', 70);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  expect(await verifyLock(k, 'owner-b')).toBe(false);
  await releaseLock(k, 'owner-a');
});

test('verifyLock returns false when no key exists', async () => {
  const k = key('verify-none');
  expect(await verifyLock(k, 'owner-a')).toBe(false);
});

test('releaseLock no-op when caller is not owner', async () => {
  const k = key('release-other');
  await acquireLock(k, 'owner-a', 70);
  await releaseLock(k, 'owner-b');
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await releaseLock(k, 'owner-a');
});

test('releaseLock no-op when key does not exist', async () => {
  const k = key('release-missing');
  await releaseLock(k, 'owner-a');
  expect(await verifyLock(k, 'owner-a')).toBe(false);
});

test('refreshLock succeeds when owner holds lock', async () => {
  const k = key('refresh-owner');
  await acquireLock(k, 'owner-a', 70);
  const refreshed = await refreshLock(k, 'owner-a', 90);
  expect(refreshed).toBe(true);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await releaseLock(k, 'owner-a');
});

test('refreshLock returns false for wrong owner', async () => {
  const k = key('refresh-wrong');
  await acquireLock(k, 'owner-a', 70);
  const refreshed = await refreshLock(k, 'owner-b', 90);
  expect(refreshed).toBe(false);
  await releaseLock(k, 'owner-a');
});

test('refreshLock returns false when no lock exists', async () => {
  const k = key('refresh-none');
  const refreshed = await refreshLock(k, 'owner-a', 70);
  expect(refreshed).toBe(false);
});

test('forceDeleteLock deletes regardless of owner', async () => {
  const k = key('force-del');
  await acquireLock(k, 'owner-a', 70);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await forceDeleteLock(k);
  expect(await verifyLock(k, 'owner-a')).toBe(false);
});

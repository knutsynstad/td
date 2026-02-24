import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import {
  acquireTickLease,
  getTickHealth,
  markTickPublish,
  markTickRun,
  releaseTickLease,
} from './store';

const test = createDevvitTest();

test('acquire and release tick lease', async () => {
  const nowMs = Date.now();
  const lease = await acquireTickLease('owner-a', nowMs, 5_000);
  expect(lease).not.toBeNull();
  if (!lease) return;
  const released = await releaseTickLease('owner-a', lease.token);
  expect(released).toBe(true);
});

test('tick health reflects run and publish markers', async () => {
  const nowMs = Date.now();
  await markTickRun(nowMs);
  await markTickPublish(42);
  const health = await getTickHealth();
  expect(health.lastTickRunMs).toBe(nowMs);
  expect(health.lastPublishTickSeq).toBe(42);
});

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
  const lease = await acquireTickLease('global', 'owner-a', nowMs, 5_000);
  expect(lease).not.toBeNull();
  if (!lease) return;
  const released = await releaseTickLease('global', 'owner-a', lease.token);
  expect(released).toBe(true);
});

test('tick health reflects run and publish markers', async () => {
  const nowMs = Date.now();
  await markTickRun('global', nowMs);
  await markTickPublish('global', 42);
  const health = await getTickHealth('global');
  expect(health.lastTickRunMs).toBe(nowMs);
  expect(health.lastPublishTickSeq).toBe(42);
});

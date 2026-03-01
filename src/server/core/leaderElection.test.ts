import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { acquireLock, releaseLock, verifyLock } from './lock';
import {
  clearFollowerGate,
  isFollowerGateActive,
  parseLeaderStartTimeMs,
  pollForLeadership,
  readLeaderHeartbeat,
  registerFollowerGate,
  writeLeaderHeartbeat,
} from './leaderElection';

const test = createDevvitTest();

const key = (suffix: string) => `leader-election-test:${suffix}`;

test('writeLeaderHeartbeat and readLeaderHeartbeat round-trip', async () => {
  const k = key('heartbeat');
  const before = Date.now();
  await writeLeaderHeartbeat(k);
  const ts = await readLeaderHeartbeat(k);
  const after = Date.now();
  expect(ts).not.toBeNull();
  expect(ts!).toBeGreaterThanOrEqual(before);
  expect(ts!).toBeLessThanOrEqual(after);
});

test('readLeaderHeartbeat returns null when key absent', async () => {
  const k = key('heartbeat-absent');
  expect(await readLeaderHeartbeat(k)).toBe(null);
});

test('readLeaderHeartbeat returns null for invalid value', async () => {
  const { redis } = await import('@devvit/web/server');
  const k = key('heartbeat-invalid');
  await redis.set(k, 'not-a-number', {
    expiration: new Date(Date.now() + 30_000),
  });
  expect(await readLeaderHeartbeat(k)).toBe(null);
});

test('registerFollowerGate, isFollowerGateActive, clearFollowerGate lifecycle', async () => {
  const k = key('follower-gate');
  await registerFollowerGate(k, 'token-x', 60);
  expect(await isFollowerGateActive(k, 'token-x')).toBe(true);
  expect(await isFollowerGateActive(k, 'token-y')).toBe(false);
  await clearFollowerGate(k);
  expect(await isFollowerGateActive(k, 'token-x')).toBe(false);
});

test('parseLeaderStartTimeMs parses leader:timestamp format', async () => {
  const { redis } = await import('@devvit/web/server');
  const k = key('leader-start');
  await redis.set(k, 'leader:12345:xyz', {
    expiration: new Date(Date.now() + 60_000),
  });
  expect(await parseLeaderStartTimeMs(k)).toBe(12345);
});

test('parseLeaderStartTimeMs returns null when key missing', async () => {
  const k = key('leader-missing');
  expect(await parseLeaderStartTimeMs(k)).toBe(null);
});

test('parseLeaderStartTimeMs returns null for invalid format', async () => {
  const { redis } = await import('@devvit/web/server');
  const k = key('leader-invalid');
  await redis.set(k, 'no-colon', {
    expiration: new Date(Date.now() + 60_000),
  });
  expect(await parseLeaderStartTimeMs(k)).toBe(null);
});

test('pollForLeadership acquires when lock freed within deadline', async () => {
  const k = key('poll-acquire');
  await acquireLock(k, 'owner-a', 70);
  const releaser = (async () => {
    await new Promise((r) => setTimeout(r, 50));
    await releaseLock(k, 'owner-a');
  })();
  const acquired = await pollForLeadership({
    lockKey: k,
    candidateToken: 'owner-b',
    lockTtlSeconds: 70,
    waitMs: 200,
    pollIntervalMs: 20,
  });
  await releaser;
  expect(acquired).toBe(true);
  expect(await verifyLock(k, 'owner-b')).toBe(true);
  await releaseLock(k, 'owner-b');
});

test('pollForLeadership returns false on timeout', async () => {
  const k = key('poll-timeout');
  await acquireLock(k, 'owner-a', 300);
  const acquired = await pollForLeadership({
    lockKey: k,
    candidateToken: 'owner-b',
    lockTtlSeconds: 70,
    waitMs: 30,
    pollIntervalMs: 10,
  });
  expect(acquired).toBe(false);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await releaseLock(k, 'owner-a');
});

test('pollForLeadership uses leaderWindowMs for expected release timing', async () => {
  const { redis } = await import('@devvit/web/server');
  const k = key('poll-leader-window');
  const leaderStart = Date.now();
  await redis.set(k, `leader:${leaderStart}:abc123`, {
    expiration: new Date(Date.now() + 60_000),
  });

  const releaser = (async () => {
    await new Promise((r) => setTimeout(r, 80));
    await releaseLock(k, `leader:${leaderStart}:abc123`);
  })();

  const acquired = await pollForLeadership({
    lockKey: k,
    candidateToken: 'candidate-a',
    lockTtlSeconds: 70,
    waitMs: 200,
    pollIntervalMs: 20,
    leaderWindowMs: 50,
    aggressivePoll: { windowMs: 40, intervalMs: 10 },
  });
  await releaser;
  expect(acquired).toBe(true);
  expect(await verifyLock(k, 'candidate-a')).toBe(true);
  await releaseLock(k, 'candidate-a');
});

test('pollForLeadership aborts when shouldContinue returns false', async () => {
  const k = key('poll-abort');
  await acquireLock(k, 'owner-a', 300);
  let pollCount = 0;
  const acquired = await pollForLeadership({
    lockKey: k,
    candidateToken: 'owner-b',
    lockTtlSeconds: 70,
    waitMs: 500,
    pollIntervalMs: 50,
    shouldContinue: async () => {
      pollCount++;
      return pollCount < 2;
    },
  });
  expect(acquired).toBe(false);
  expect(pollCount).toBe(2);
  expect(await verifyLock(k, 'owner-a')).toBe(true);
  await releaseLock(k, 'owner-a');
});

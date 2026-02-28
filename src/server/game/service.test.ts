import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import type { CommandEnvelope } from '../../shared/game-protocol';
import type { StructureState } from '../../shared/game-state';

const TEST_USER_ID = 'test-user';
import {
  applyCommand,
  getCoinBalance,
  joinGame,
  resetGame,
  resyncGame,
} from './handlers';
import { runGameLoop } from './gameLoop';
import { loadWorldState, persistWorldState } from './world';

const test = createDevvitTest();

test('runGameLoop returns result fields', async () => {
  await joinGame(TEST_USER_ID);
  const result = await runGameLoop(500);
  expect(typeof result.ownerToken).toBe('string');
  expect(typeof result.durationMs).toBe('number');
  expect(result.ticksProcessed).toBeGreaterThan(0);
});

test('resetGame resets wave progression without economy tax', async () => {
  await joinGame(TEST_USER_ID);
  await resetGame(TEST_USER_ID);
  const snapshot = await resyncGame(TEST_USER_ID);
  expect(snapshot.snapshot.wave.wave).toBe(0);
  expect(snapshot.snapshot.wave.active).toBe(false);
  expect(snapshot.snapshot.wave.nextWaveAtMs).toBe(0);
  expect(Object.keys(snapshot.snapshot.mobs)).toHaveLength(0);
  const structures = Object.values(snapshot.snapshot.structures);
  expect(structures.length).toBeGreaterThan(0);
  expect(structures.every((s: StructureState) => s.ownerId === 'Map')).toBe(
    true
  );
});

test('applyCommand charges total cost for batched buildStructures', async () => {
  await resetGame(TEST_USER_ID);
  const joined = await joinGame(TEST_USER_ID);
  const beforeCoins = await getCoinBalance(TEST_USER_ID);
  const envelope: CommandEnvelope = {
    seq: 1,
    sentAtMs: Date.now(),
    command: {
      type: 'buildStructures',
      playerId: joined.playerId,
      structures: [
        {
          structureId: 'batch-wall-1',
          type: 'wall',
          center: { x: 12, z: 12 },
        },
        {
          structureId: 'batch-wall-2',
          type: 'wall',
          center: { x: 13, z: 12 },
        },
      ],
    },
  };
  const response = await applyCommand(envelope, TEST_USER_ID);
  const afterCoins = await getCoinBalance(TEST_USER_ID);
  const spent = beforeCoins - afterCoins;

  expect(response.accepted).toBe(true);
  expect(spent).toBeGreaterThan(3.99);
  expect(spent).toBeLessThan(4.01);
});

test('applyCommand rejects empty buildStructures payloads', async () => {
  await resetGame(TEST_USER_ID);
  const joined = await joinGame(TEST_USER_ID);
  const beforeCoins = await getCoinBalance(TEST_USER_ID);
  const envelope: CommandEnvelope = {
    seq: 2,
    sentAtMs: Date.now(),
    command: {
      type: 'buildStructures',
      playerId: joined.playerId,
      structures: [],
    },
  };
  const response = await applyCommand(envelope, TEST_USER_ID);
  const afterCoins = await getCoinBalance(TEST_USER_ID);

  expect(response.accepted).toBe(false);
  expect(response.reason).toBe('no structures requested');
  expect(afterCoins).toBe(beforeCoins);
});

test('resync heals invalid map trees near castle and spawn entry lanes', async () => {
  await resetGame(TEST_USER_ID);
  const seeded = await resyncGame(TEST_USER_ID);
  const world = seeded.snapshot;
  world.structures['map-tree-castle-camper'] = {
    structureId: 'map-tree-castle-camper',
    ownerId: 'Map',
    type: 'tree',
    center: { x: 0, z: 0 },
    hp: 100,
    maxHp: 100,
    createdAtMs: Date.now(),
    metadata: { treeFootprint: 4 },
  };
  world.structures['map-tree-spawn-camper'] = {
    structureId: 'map-tree-spawn-camper',
    ownerId: 'Map',
    type: 'tree',
    center: { x: 0, z: -61 },
    hp: 100,
    maxHp: 100,
    createdAtMs: Date.now(),
    metadata: { treeFootprint: 3 },
  };
  await persistWorldState(world);

  const healed = await resyncGame(TEST_USER_ID);
  expect(healed.snapshot.structures['map-tree-castle-camper']).toBeUndefined();
  expect(healed.snapshot.structures['map-tree-spawn-camper']).toBeUndefined();

  const reloaded = await loadWorldState();
  expect(reloaded.structures['map-tree-castle-camper']).toBeUndefined();
  expect(reloaded.structures['map-tree-spawn-camper']).toBeUndefined();
});

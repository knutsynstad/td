import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../shared/game-protocol';
import type { WorldState } from '../../shared/game-state';
import {
  AUTO_WAVE_INITIAL_DELAY_MS,
  FULL_MOB_DELTA_INTERVAL_MS,
  FULL_MOB_SNAPSHOT_CHUNK_SIZE,
  MAX_DELTA_MOBS,
  SIM_TICK_MS,
} from './config';
import { runSimulation } from './simulation';

const world = (nowMs: number): WorldState => ({
  meta: {
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: nowMs,
    seed: 1,
    energy: 100,
    lives: 1,
  },
  players: {},
  intents: {},
  structures: {},
  mobs: {},
  wave: {
    wave: 0,
    active: false,
    nextWaveAtMs: 0,
    spawners: [],
  },
});

describe('runSimulation', () => {
  it('schedules initial wave when world is fresh', () => {
    const nowMs = Date.now();
    const result = runSimulation(world(nowMs), nowMs, [], 1);
    expect(result.world.wave.nextWaveAtMs).toBe(
      nowMs + AUTO_WAVE_INITIAL_DELAY_MS
    );
    expect(result.deltas.some((delta) => delta.type === 'waveDelta')).toBe(
      true
    );
  });

  it('activates scheduled wave once due', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.nextWaveAtMs = nowMs;
    const result = runSimulation(gameWorld, nowMs + 100, [], 5);
    expect(result.world.wave.active).toBe(true);
    expect(result.world.wave.wave).toBe(1);
    expect(result.world.wave.spawners.length).toBeGreaterThan(0);
  });

  it('builds routes without single-cell ABA kinks', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.nextWaveAtMs = nowMs;
    const result = runSimulation(gameWorld, nowMs + 100, [], 5);
    for (const spawner of result.world.wave.spawners) {
      const runs: Array<{ dir: string; len: number }> = [];
      for (let i = 1; i < spawner.route.length; i += 1) {
        const prev = spawner.route[i - 1]!;
        const curr = spawner.route[i]!;
        const dx = Math.round(curr.x - prev.x);
        const dz = Math.round(curr.z - prev.z);
        const dir = `${dx},${dz}`;
        if (runs.length === 0 || runs[runs.length - 1]!.dir !== dir) {
          runs.push({ dir, len: 1 });
        } else {
          runs[runs.length - 1]!.len += 1;
        }
      }
      for (let i = 1; i < runs.length - 1; i += 1) {
        const before = runs[i - 1]!;
        const middle = runs[i]!;
        const after = runs[i + 1]!;
        const isSingleCellKink =
          middle.len === 1 &&
          before.dir === after.dir &&
          before.dir !== middle.dir;
        expect(isSingleCellKink).toBe(false);
      }
    }
  });

  it('applies batched buildStructures commands in a single tick', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    const commands: CommandEnvelope[] = [
      {
        seq: 1,
        sentAtMs: nowMs,
        command: {
          type: 'buildStructures',
          playerId: 'player-1',
          structures: [
            {
              structureId: 'wall-a',
              type: 'wall',
              center: { x: 10, z: 10 },
            },
            {
              structureId: 'wall-b',
              type: 'wall',
              center: { x: 11, z: 10 },
            },
          ],
        },
      },
    ];

    const result = runSimulation(gameWorld, nowMs + 100, commands, 1);
    expect(result.world.structures['wall-a']?.type).toBe('wall');
    expect(result.world.structures['wall-b']?.type).toBe('wall');

    const structureDelta = result.deltas.find(
      (delta) => delta.type === 'structureDelta'
    );
    expect(structureDelta?.type).toBe('structureDelta');
    if (structureDelta?.type === 'structureDelta') {
      expect(structureDelta.upserts.map((entry) => entry.structureId)).toEqual(
        expect.arrayContaining(['wall-a', 'wall-b'])
      );
      expect(structureDelta.upserts).toHaveLength(2);
      expect(structureDelta.requiresPathRefresh).toBe(true);
    }
  });

  it('despawns mobs that remain stuck for over two minutes', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 1,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'reachable',
        route: [{ x: 20, z: 20 }],
      },
    ];
    gameWorld.mobs['stuck-mob'] = {
      mobId: 'stuck-mob',
      position: { x: 20, z: 20 },
      velocity: { x: 0, z: 0 },
      hp: 100,
      maxHp: 100,
      spawnerId: 'wave-1-north',
      routeIndex: 0,
      stuckMs: 0,
      lastProgressDistanceToGoal: 1000,
    };
    const runUntilMs = nowMs + 121_000;
    const maxSteps = Math.ceil((runUntilMs - nowMs) / 100) + 5;
    const result = runSimulation(gameWorld, runUntilMs, [], maxSteps);

    expect(result.world.mobs['stuck-mob']).toBeUndefined();
    const entityDelta = result.deltas.find((delta) => delta.type === 'entityDelta');
    expect(entityDelta?.type).toBe('entityDelta');
    if (entityDelta?.type === 'entityDelta') {
      expect(entityDelta.despawnedMobIds).toContain('stuck-mob');
    }
  });

  it('keeps blocked-route mobs moving toward side entry, not castle fallback', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 1,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'blocked',
        route: [{ x: 0, z: -61 }, { x: 0, z: 7 }],
      },
    ];
    gameWorld.mobs['blocked-route-mob'] = {
      mobId: 'blocked-route-mob',
      position: { x: 0, z: -50 },
      velocity: { x: 0, z: 0 },
      hp: 100,
      maxHp: 100,
      spawnerId: 'wave-1-north',
      routeIndex: 0,
    };

    const result = runSimulation(gameWorld, nowMs + 100, [], 1);
    expect(result.world.mobs['blocked-route-mob']).toBeDefined();
    const moved = result.world.mobs['blocked-route-mob']!;
    expect(moved.position.z).toBeLessThan(-50);
  });

  it('auto-removes player obstacles first when paths are fully blocked', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'blocked',
        route: [],
      },
    ];
    gameWorld.structures['player-blocker'] = {
      structureId: 'player-blocker',
      ownerId: 'player-1',
      type: 'rock',
      center: { x: 0, z: -32 },
      hp: 100,
      maxHp: 100,
      createdAtMs: nowMs,
      metadata: {
        rock: {
          footprintX: 200,
          footprintZ: 200,
          yawQuarterTurns: 0,
          modelIndex: 0,
          mirrorX: false,
          mirrorZ: false,
          verticalScale: 1,
        },
      },
    };
    gameWorld.structures['map-nonblocker'] = {
      structureId: 'map-nonblocker',
      ownerId: 'Map',
      type: 'tower',
      center: { x: 40, z: 40 },
      hp: 100,
      maxHp: 100,
      createdAtMs: nowMs - 1,
    };

    const result = runSimulation(gameWorld, nowMs, [], 1);
    expect(result.world.structures['player-blocker']).toBeUndefined();
    expect(result.world.structures['map-nonblocker']).toBeDefined();
    expect(result.world.wave.spawners[0]?.routeState).toBe('reachable');
    const structureDelta = result.deltas.find(
      (delta) => delta.type === 'structureDelta'
    );
    expect(structureDelta?.type).toBe('structureDelta');
    if (structureDelta?.type === 'structureDelta') {
      expect(structureDelta.removes).toContain('player-blocker');
      expect(structureDelta.removes).not.toContain('map-nonblocker');
    }
  });

  it('falls back to removing map geometry when no player obstacle resolves block', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'blocked',
        route: [],
      },
    ];
    gameWorld.structures['map-blocker'] = {
      structureId: 'map-blocker',
      ownerId: 'Map',
      type: 'rock',
      center: { x: 0, z: -32 },
      hp: 100,
      maxHp: 100,
      createdAtMs: nowMs,
      metadata: {
        rock: {
          footprintX: 200,
          footprintZ: 200,
          yawQuarterTurns: 0,
          modelIndex: 0,
          mirrorX: false,
          mirrorZ: false,
          verticalScale: 1,
        },
      },
    };

    const result = runSimulation(gameWorld, nowMs, [], 1);
    expect(result.world.structures['map-blocker']).toBeUndefined();
    expect(result.world.wave.spawners[0]?.routeState).toBe('reachable');
    const structureDelta = result.deltas.find(
      (delta) => delta.type === 'structureDelta'
    );
    expect(structureDelta?.type).toBe('structureDelta');
    if (structureDelta?.type === 'structureDelta') {
      expect(structureDelta.removes).toContain('map-blocker');
    }
  });

  it('includes priority mob slices in entity deltas', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.players['p1'] = {
      playerId: 'p1',
      username: 'one',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: 1,
      lastSeenMs: nowMs,
    };
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'reachable',
        route: [{ x: 0, z: -5 }, { x: 0, z: 0 }],
      },
    ];
    for (let i = 0; i < 16; i += 1) {
      gameWorld.mobs[`m-${i}`] = {
        mobId: `m-${i}`,
        position: { x: i - 8, z: i - 7 },
        velocity: { x: 0, z: 0 },
        hp: i % 3 === 0 ? 70 : 100,
        maxHp: 100,
        spawnerId: 'wave-1-north',
        routeIndex: 0,
      };
    }
    const result = runSimulation(gameWorld, nowMs + 100, [], 1);
    const entityDelta = result.deltas.find((delta) => delta.type === 'entityDelta');
    expect(entityDelta?.type).toBe('entityDelta');
    if (entityDelta?.type === 'entityDelta') {
      if (entityDelta.priorityMobs) {
        expect(entityDelta.priorityMobs.nearPlayers.length).toBeGreaterThan(0);
        expect(entityDelta.priorityMobs.castleThreats.length).toBeGreaterThan(0);
      } else {
        expect(entityDelta.mobs.length).toBeGreaterThan(0);
      }
    }
  });

  it('sends compact mob deltas between full snapshot intervals', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    const intervalTicks = Math.max(
      1,
      Math.round(FULL_MOB_DELTA_INTERVAL_MS / SIM_TICK_MS)
    );
    gameWorld.meta.tickSeq = 1;
    gameWorld.meta.lastStructureChangeTickSeq = 0;
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'reachable',
        route: [{ x: 0, z: -5 }, { x: 0, z: 0 }],
      },
    ];
    for (let i = 0; i < MAX_DELTA_MOBS + 40; i += 1) {
      gameWorld.mobs[`compact-${i}`] = {
        mobId: `compact-${i}`,
        position: { x: i * 0.1, z: -10 },
        velocity: { x: 0, z: 0 },
        hp: 100,
        maxHp: 100,
        spawnerId: 'wave-1-north',
        routeIndex: 0,
      };
    }
    const result = runSimulation(gameWorld, nowMs + SIM_TICK_MS, [], 1);
    const entityDelta = result.deltas.find((delta) => delta.type === 'entityDelta');
    expect(entityDelta?.type).toBe('entityDelta');
    if (entityDelta?.type === 'entityDelta') {
      expect(entityDelta.tickSeq % intervalTicks).not.toBe(0);
      expect(entityDelta.fullMobList).toBe(false);
      expect(entityDelta.mobs.length).toBe(MAX_DELTA_MOBS);
      expect(entityDelta.priorityMobs).toBeDefined();
    }
  });

  it('sends full mob snapshots every five seconds', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    const intervalTicks = Math.max(
      1,
      Math.round(FULL_MOB_DELTA_INTERVAL_MS / SIM_TICK_MS)
    );
    gameWorld.meta.tickSeq = intervalTicks - 1;
    gameWorld.meta.lastStructureChangeTickSeq = 0;
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'reachable',
        route: [{ x: 0, z: -5 }, { x: 0, z: 0 }],
      },
    ];
    for (let i = 0; i < FULL_MOB_SNAPSHOT_CHUNK_SIZE + 25; i += 1) {
      gameWorld.mobs[`full-${i}`] = {
        mobId: `full-${i}`,
        position: { x: i * 0.1, z: -10 },
        velocity: { x: 0, z: 0 },
        hp: 100,
        maxHp: 100,
        spawnerId: 'wave-1-north',
        routeIndex: 0,
      };
    }
    const result = runSimulation(gameWorld, nowMs + SIM_TICK_MS, [], 1);
    const entityDeltas = result.deltas.filter((delta) => delta.type === 'entityDelta');
    expect(entityDeltas.length).toBe(2);
    for (let i = 0; i < entityDeltas.length; i += 1) {
      const entityDelta = entityDeltas[i]!;
      expect(entityDelta.tickSeq % intervalTicks).toBe(0);
      expect(entityDelta.fullMobList).toBe(true);
      expect(entityDelta.priorityMobs).toBeUndefined();
      expect(entityDelta.fullMobSnapshotId).toBe(entityDelta.tickSeq);
      expect(entityDelta.fullMobSnapshotChunkCount).toBe(2);
      expect(entityDelta.fullMobSnapshotChunkIndex).toBe(i);
      expect(entityDelta.mobs).toHaveLength(0);
      expect(entityDelta.mobSnapshotCompact).toBeDefined();
      if (entityDelta.mobSnapshotCompact) {
        const compact = entityDelta.mobSnapshotCompact;
        expect(compact.mobIds.length).toBe(compact.px.length);
        expect(compact.mobIds.length).toBe(compact.pz.length);
        expect(compact.mobIds.length).toBe(compact.vx.length);
        expect(compact.mobIds.length).toBe(compact.vz.length);
        expect(compact.mobIds.length).toBe(compact.hp.length);
        expect(compact.mobIds.length).toBe(compact.maxHp.length);
      }
    }
    const allMobIds = new Set(entityDeltas.flatMap((delta) => delta.mobSnapshotCompact?.mobIds ?? []));
    expect(allMobIds.size).toBe(FULL_MOB_SNAPSHOT_CHUNK_SIZE + 25);
    expect(entityDeltas[0]?.despawnedMobIds).toHaveLength(0);
  });

  it('sends full mob snapshots for one second after structure changes', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.meta.tickSeq = 9;
    gameWorld.wave.wave = 1;
    gameWorld.wave.active = true;
    gameWorld.wave.spawners = [
      {
        spawnerId: 'wave-1-north',
        totalCount: 0,
        spawnedCount: 0,
        aliveCount: 0,
        spawnRatePerSecond: 0,
        spawnAccumulator: 0,
        gateOpen: true,
        routeState: 'reachable',
        route: [{ x: 0, z: -5 }, { x: 0, z: 0 }],
      },
    ];
    for (let i = 0; i < MAX_DELTA_MOBS + 40; i += 1) {
      gameWorld.mobs[`burst-${i}`] = {
        mobId: `burst-${i}`,
        position: { x: i * 0.1, z: -10 },
        velocity: { x: 0, z: 0 },
        hp: 100,
        maxHp: 100,
        spawnerId: 'wave-1-north',
        routeIndex: 0,
      };
    }
    const commandNow: CommandEnvelope[] = [
      {
        seq: 1,
        sentAtMs: nowMs,
        command: {
          type: 'buildStructure',
          playerId: 'player-1',
          structure: {
            structureId: 'burst-wall',
            type: 'wall',
            center: { x: 20, z: 20 },
          },
        },
      },
    ];
    const first = runSimulation(gameWorld, nowMs + SIM_TICK_MS, commandNow, 1);
    const firstEntity = first.deltas.find((delta) => delta.type === 'entityDelta');
    expect(firstEntity?.type).toBe('entityDelta');
    if (firstEntity?.type === 'entityDelta') {
      expect(firstEntity.fullMobList).toBe(true);
    }
  });
});

import type { GameWorld, MobState, WorldMeta } from '../../shared/game-state';
import { MOB_DEFS, DEFAULT_MOB_TYPE } from '../../shared/content/mobs';
import { getWaveMobCount, getWaveSpawnRate } from '../../shared/content/waves';
import { weightedSplit } from '../../shared/utils';
import {
  MAX_MOBS,
  AUTO_WAVE_INITIAL_DELAY_MS,
  AUTO_WAVE_INTERMISSION_MS,
} from '../config';
import {
  toSideDef,
  getSpawnerSpawnPoint,
  pickSpawnerSidesForWave,
  recomputeSpawnerRoutes,
} from './pathfinding';

const baseMob = MOB_DEFS[DEFAULT_MOB_TYPE];

export const makeMob = (meta: WorldMeta, spawnerId: string): MobState => {
  const side = toSideDef(spawnerId);
  const spawn = getSpawnerSpawnPoint(side);
  const seq = meta.nextMobSeq;
  meta.nextMobSeq = seq + 1;
  return {
    mobId: String(seq),
    position: spawn,
    velocity: { x: 0, z: 0 },
    hp: baseMob.hp,
    maxHp: baseMob.maxHp,
    spawnerId,
    routeIndex: 0,
    stuckMs: 0,
    lastProgressDistanceToGoal: Number.POSITIVE_INFINITY,
  };
};

const prepareNextWaveSpawners = (
  world: GameWorld
): GameWorld['wave']['spawners'] => {
  const nextWave = world.wave.wave + 1;
  const totalMobCount = getWaveMobCount(nextWave);
  const sides = pickSpawnerSidesForWave(nextWave);
  const split = weightedSplit(totalMobCount, sides.length, Math.random);
  return split.map((count, index) => {
    const side = sides[index]!;
    return {
      spawnerId: `wave-${nextWave}-${side.id}`,
      totalCount: count,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond:
        getWaveSpawnRate(nextWave) * (0.9 + Math.random() * 0.4),
      spawnAccumulator: 0,
      gateOpen: false,
      routeState: 'blocked' as const,
      route: [],
    };
  });
};

const prepareUpcomingWave = (world: GameWorld): void => {
  world.wave.spawners = prepareNextWaveSpawners(world);
  recomputeSpawnerRoutes(world);
};

export const activateWave = (world: GameWorld): boolean => {
  if (world.wave.active) return false;
  if (world.wave.spawners.length === 0) {
    prepareUpcomingWave(world);
  }
  world.wave.wave += 1;
  world.wave.active = true;
  for (const spawner of world.wave.spawners) {
    spawner.spawnedCount = 0;
    spawner.aliveCount = 0;
    spawner.spawnAccumulator = 0;
    spawner.gateOpen = false;
  }
  world.wave.nextWaveAtMs = 0;
  return true;
};

export const ensureInitialWaveSchedule = (world: GameWorld): boolean => {
  if (world.wave.wave > 0 || world.wave.active || world.wave.nextWaveAtMs > 0) {
    return false;
  }
  if (world.wave.spawners.length === 0) {
    prepareUpcomingWave(world);
  }
  world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INITIAL_DELAY_MS;
  return true;
};

export const ensureWaveSpawnersPrepared = (world: GameWorld): void => {
  if (world.wave.active || world.wave.spawners.length > 0) return;
  prepareUpcomingWave(world);
};

const maybeActivateScheduledWave = (world: GameWorld): boolean => {
  if (world.wave.active || world.wave.nextWaveAtMs <= 0) return false;
  if (world.meta.lastTickMs < world.wave.nextWaveAtMs) return false;
  return activateWave(world);
};

export const updateWave = (
  world: GameWorld,
  deltaSeconds: number
): { changed: boolean; spawned: number } => {
  let changed = false;
  let spawned = 0;
  if (maybeActivateScheduledWave(world)) {
    changed = true;
  }
  if (!world.wave.active) return { changed: false, spawned: 0 };
  let currentMobCount = world.mobs.size;
  for (const spawner of world.wave.spawners) {
    if (!spawner.gateOpen) spawner.gateOpen = true;
    spawner.spawnAccumulator += spawner.spawnRatePerSecond * deltaSeconds;
    const toSpawn = Math.floor(spawner.spawnAccumulator);
    if (toSpawn <= 0) continue;
    const roomLeft = Math.max(0, MAX_MOBS - currentMobCount);
    const spawnCount = Math.min(
      roomLeft,
      toSpawn,
      spawner.totalCount - spawner.spawnedCount
    );
    for (let i = 0; i < spawnCount; i += 1) {
      const mob = makeMob(world.meta, spawner.spawnerId);
      world.mobs.set(mob.mobId, mob);
      spawner.spawnedCount += 1;
      spawner.aliveCount += 1;
      spawner.spawnAccumulator -= 1;
      spawned += 1;
      currentMobCount += 1;
      changed = true;
    }
  }

  const allSpawned = world.wave.spawners.every(
    (spawner) => spawner.spawnedCount >= spawner.totalCount
  );
  const aliveMobs = currentMobCount;
  if (allSpawned && aliveMobs === 0) {
    world.wave.active = false;
    prepareUpcomingWave(world);
    world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INTERMISSION_MS;
    changed = true;
  }
  return { changed, spawned };
};

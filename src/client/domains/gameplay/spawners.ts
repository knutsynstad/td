import * as THREE from 'three';
import { weightedSplit } from '../../../shared/utils';
import type { WaveSpawner } from './types/entities';

type SpawnerOptions = {
  wave: number;
  totalMobCount: number;
  doorPositions: THREE.Vector3[];
  baseSpawnRate: number;
  random?: () => number;
};

export const createWaveSpawners = (opts: SpawnerOptions): WaveSpawner[] => {
  const random = opts.random ?? Math.random;
  const spawnerCount = opts.doorPositions.length;
  if (spawnerCount === 0) return [];
  const split = weightedSplit(opts.totalMobCount, spawnerCount, random);

  return split.map((count, index) => {
    const position = opts.doorPositions[index]!.clone();
    const id = `wave-${opts.wave}-spawner-${index}`;
    return {
      id,
      position,
      gateOpen: false,
      totalCount: count,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond: opts.baseSpawnRate * (0.9 + random() * 0.4),
      spawnAccumulator: 0,
      routeState: 'reachable',
    };
  });
};

export const emitFromSpawner = (
  spawner: WaveSpawner,
  delta: number,
  onSpawn: (spawner: WaveSpawner) => boolean
) => {
  if (spawner.spawnedCount >= spawner.totalCount) return;
  spawner.spawnAccumulator += spawner.spawnRatePerSecond * delta;
  const remaining = spawner.totalCount - spawner.spawnedCount;
  const toSpawn = Math.min(remaining, Math.floor(spawner.spawnAccumulator), 1);
  if (toSpawn <= 0) return;
  for (let i = 0; i < toSpawn; i += 1) {
    const didSpawn = onSpawn(spawner);
    if (!didSpawn) break;
    spawner.spawnAccumulator -= 1;
    spawner.spawnedCount += 1;
    spawner.aliveCount += 1;
  }
};

export const areWaveSpawnersDone = (spawners: WaveSpawner[]) => {
  for (const spawner of spawners) {
    if (spawner.spawnedCount < spawner.totalCount) return false;
    if (spawner.aliveCount > 0) return false;
  }
  return true;
};

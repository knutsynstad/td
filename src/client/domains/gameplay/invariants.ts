import type {
  DestructibleCollider,
  MobEntity,
  StaticCollider,
  WaveSpawner,
} from './types/entities';
import type { StructureStore } from './structureStore';

export const assertCoinsInBounds = (coins: number, coinsCap: number) => {
  if (coins < 0 || coins > coinsCap) {
    throw new Error(
      `Coins invariant violated: coins=${coins}, cap=${coinsCap}`
    );
  }
};

export const assertSpawnerCounts = (spawners: WaveSpawner[]) => {
  for (const spawner of spawners) {
    if (spawner.spawnedCount > spawner.totalCount) {
      throw new Error(
        `Spawner invariant violated: spawnedCount>${spawner.totalCount} for ${spawner.id}`
      );
    }
    if (
      spawner.spawnedCount < 0 ||
      spawner.aliveCount < 0 ||
      spawner.totalCount < 0
    ) {
      throw new Error(
        `Spawner invariant violated: negative count for ${spawner.id}`
      );
    }
  }
};

export const assertStructureStoreConsistency = (
  store: StructureStore,
  staticColliders: StaticCollider[]
) => {
  const destructibleCount = staticColliders.filter(
    (collider): collider is DestructibleCollider =>
      collider.type === 'wall' ||
      collider.type === 'tower' ||
      collider.type === 'tree' ||
      collider.type === 'rock' ||
      collider.type === 'castleCoins'
  ).length;
  if (store.structureStates.size !== destructibleCount) {
    throw new Error(
      `Structure invariant violated: states=${store.structureStates.size}, destructibles=${destructibleCount}`
    );
  }
};

export const assertMobSpawnerReferences = (
  mobs: MobEntity[],
  spawnerIds: Set<string>
) => {
  for (const mob of mobs) {
    if (mob.spawnerId && !spawnerIds.has(mob.spawnerId)) {
      throw new Error(
        `Mob invariant violated: unknown spawnerId=${mob.spawnerId}`
      );
    }
  }
};

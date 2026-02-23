import type { DestructibleCollider, MobEntity, StaticCollider, WaveSpawner } from './types'
import type { StructureStore } from './structures'

export const assertEnergyInBounds = (energy: number, energyCap: number) => {
  if (energy < 0 || energy > energyCap) {
    throw new Error(`Energy invariant violated: energy=${energy}, cap=${energyCap}`)
  }
}

export const assertSpawnerCounts = (spawners: WaveSpawner[]) => {
  for (const spawner of spawners) {
    if (spawner.spawnedCount > spawner.totalCount) {
      throw new Error(
        `Spawner invariant violated: spawnedCount>${spawner.totalCount} for ${spawner.id}`
      )
    }
    if (spawner.spawnedCount < 0 || spawner.aliveCount < 0 || spawner.totalCount < 0) {
      throw new Error(`Spawner invariant violated: negative count for ${spawner.id}`)
    }
  }
}

export const assertStructureStoreConsistency = (
  store: StructureStore,
  staticColliders: StaticCollider[]
) => {
  const destructibleCount = staticColliders.filter(
    (collider): collider is DestructibleCollider =>
      collider.type === 'wall'
      || collider.type === 'tower'
      || collider.type === 'tree'
      || collider.type === 'rock'
      || collider.type === 'bank'
  ).length
  if (store.structureStates.size !== destructibleCount) {
    throw new Error(
      `Structure invariant violated: states=${store.structureStates.size}, destructibles=${destructibleCount}`
    )
  }
}

export const assertMobSpawnerReferences = (mobs: MobEntity[], spawnerIds: Set<string>) => {
  for (const mob of mobs) {
    if (mob.spawnerId && !spawnerIds.has(mob.spawnerId)) {
      throw new Error(`Mob invariant violated: unknown spawnerId=${mob.spawnerId}`)
    }
  }
}

import * as THREE from 'three'
import type { WaveSpawner } from './types'

type SpawnerOptions = {
  wave: number
  totalMobCount: number
  doorPositions: THREE.Vector3[]
  baseSpawnRate: number
}

const weightedSplit = (total: number, count: number): number[] => {
  if (count <= 0) return []
  const weights = Array.from({ length: count }, () => 0.75 + Math.random())
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const raw = weights.map((weight) => (weight / weightSum) * total)
  const base = raw.map((value) => Math.floor(value))
  let remainder = total - base.reduce((sum, value) => sum + value, 0)
  while (remainder > 0) {
    let bestIdx = 0
    let bestFrac = -1
    for (let i = 0; i < raw.length; i += 1) {
      const frac = raw[i]! - base[i]!
      if (frac > bestFrac) {
        bestFrac = frac
        bestIdx = i
      }
    }
    base[bestIdx] = (base[bestIdx] ?? 0) + 1
    remainder -= 1
  }
  return base
}

export const createWaveSpawners = (opts: SpawnerOptions): WaveSpawner[] => {
  const spawnerCount = opts.doorPositions.length
  if (spawnerCount === 0) return []
  const split = weightedSplit(opts.totalMobCount, spawnerCount)

  return split.map((count, index) => {
    const position = opts.doorPositions[index]!.clone()
    const id = `wave-${opts.wave}-spawner-${index}`
    return {
      id,
      position,
      totalCount: count,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond: opts.baseSpawnRate * (0.9 + Math.random() * 0.4),
      spawnAccumulator: 0,
      routeState: 'reachable'
    }
  })
}

export const emitFromSpawner = (
  spawner: WaveSpawner,
  delta: number,
  onSpawn: (spawner: WaveSpawner) => boolean
) => {
  if (spawner.spawnedCount >= spawner.totalCount) return
  spawner.spawnAccumulator += spawner.spawnRatePerSecond * delta
  const remaining = spawner.totalCount - spawner.spawnedCount
  // Keep door output gradual: never burst large batches in one tick.
  const toSpawn = Math.min(remaining, Math.floor(spawner.spawnAccumulator), 1)
  if (toSpawn <= 0) return
  for (let i = 0; i < toSpawn; i += 1) {
    const didSpawn = onSpawn(spawner)
    if (!didSpawn) break
    spawner.spawnAccumulator -= 1
    spawner.spawnedCount += 1
    spawner.aliveCount += 1
  }
}

export const areWaveSpawnersDone = (spawners: WaveSpawner[]) => {
  for (const spawner of spawners) {
    if (spawner.spawnedCount < spawner.totalCount) return false
    if (spawner.aliveCount > 0) return false
  }
  return true
}

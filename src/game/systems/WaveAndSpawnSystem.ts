import * as THREE from 'three'
import type { WaveSpawner } from '../types'
import { createWaveSpawners, emitFromSpawner } from '../spawners'
import { selectActiveDoorsForWave } from '../borderDoors'

type WaveAndSpawnSystemConfig = {
  borderDoors: THREE.Vector3[]
  minSpawners: number
  maxSpawners: number
  baseSpawnRate: number
  random: () => number
}

type SpawnWaveContext = {
  wave: number
  activeWaveSpawners: WaveSpawner[]
  spawnerById: Map<string, WaveSpawner>
  refreshSpawnerPathline: (spawner: WaveSpawner) => void
  clearWaveOverlays: () => void
}

export const createWaveAndSpawnSystem = (config: WaveAndSpawnSystemConfig) => {
  return {
    spawnWave(context: SpawnWaveContext): number {
      const nextWave = context.wave + 1
      const count = (5 + nextWave * 2) * 10
      context.clearWaveOverlays()
      context.activeWaveSpawners.length = 0
      context.spawnerById.clear()

      const activeDoors = selectActiveDoorsForWave(
        config.borderDoors,
        nextWave,
        config.minSpawners,
        config.maxSpawners,
        config.random
      )
      const created = createWaveSpawners({
        wave: nextWave,
        totalMobCount: count,
        doorPositions: activeDoors,
        baseSpawnRate: config.baseSpawnRate,
        random: config.random
      })
      for (const spawner of created) {
        context.activeWaveSpawners.push(spawner)
        context.spawnerById.set(spawner.id, spawner)
        context.refreshSpawnerPathline(spawner)
      }
      return nextWave
    },

    emit(spawners: WaveSpawner[], delta: number, onSpawn: (spawner: WaveSpawner) => boolean) {
      for (const spawner of spawners) {
        emitFromSpawner(spawner, delta, onSpawn)
      }
    }
  }
}

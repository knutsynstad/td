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
  refreshSpawnerPathline: (spawner: WaveSpawner) => void
  clearWaveOverlays: () => void
}

type StartPreparedWaveContext = {
  preparedWave: PreparedWave
  activeWaveSpawners: WaveSpawner[]
  spawnerById: Map<string, WaveSpawner>
  onReleaseSpawnerMobs: (spawner: WaveSpawner) => void
}

export type PreparedWave = {
  wave: number
  spawners: WaveSpawner[]
}

export const createWaveAndSpawnSystem = (config: WaveAndSpawnSystemConfig) => {
  return {
    prepareNextWave(context: SpawnWaveContext): PreparedWave {
      const nextWave = context.wave + 1
      const count = (5 + nextWave * 2) * 10
      context.clearWaveOverlays()

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
        context.refreshSpawnerPathline(spawner)
      }
      return {
        wave: nextWave,
        spawners: created
      }
    },

    startPreparedWave(context: StartPreparedWaveContext): number {
      context.activeWaveSpawners.length = 0
      context.spawnerById.clear()
      for (const spawner of context.preparedWave.spawners) {
        spawner.gateOpen = false
        context.activeWaveSpawners.push(spawner)
        context.spawnerById.set(spawner.id, spawner)
        context.onReleaseSpawnerMobs(spawner)
      }
      return context.preparedWave.wave
    },

    emit(spawners: WaveSpawner[], delta: number, onSpawn: (spawner: WaveSpawner) => boolean) {
      for (const spawner of spawners) {
        emitFromSpawner(spawner, delta, onSpawn)
      }
    }
  }
}

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { WaveSpawner } from '../src/client/game/types'
import { createWaveAndSpawnSystem } from '../src/client/game/systems/WaveAndSpawnSystem'

describe('wave and spawn integration', () => {
  it('spawns a new wave and updates spawner registries', () => {
    const activeWaveSpawners: WaveSpawner[] = []
    const spawnerById = new Map<string, WaveSpawner>()
    const refreshed: string[] = []
    const cleared: string[] = []

    const system = createWaveAndSpawnSystem({
      borderDoors: [new THREE.Vector3(10, 0, 0), new THREE.Vector3(-10, 0, 0)],
      minSpawners: 1,
      maxSpawners: 2,
      baseSpawnRate: 10,
      random: () => 0.5
    })

    const preparedWave = system.prepareNextWave({
      wave: 0,
      refreshSpawnerPathline: (spawner) => refreshed.push(spawner.id),
      clearWaveOverlays: () => {
        cleared.push('ok')
      },
    })
    const nextWave = system.startPreparedWave({
      preparedWave,
      activeWaveSpawners,
      spawnerById,
      onReleaseSpawnerMobs: () => {},
    })

    expect(nextWave).toBe(1)
    expect(cleared).toHaveLength(1)
    expect(activeWaveSpawners.length).toBeGreaterThan(0)
    expect(spawnerById.size).toBe(activeWaveSpawners.length)
    expect(refreshed.length).toBe(activeWaveSpawners.length)
  })
})

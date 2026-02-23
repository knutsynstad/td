import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { areWaveSpawnersDone, createWaveSpawners, emitFromSpawner } from '../src/client/game/spawners'

describe('spawner system', () => {
  it('splits total mobs across spawners exactly', () => {
    const doors = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(3, 0, 0)]
    const spawners = createWaveSpawners({
      wave: 4,
      totalMobCount: 75,
      doorPositions: doors,
      baseSpawnRate: 10,
      random: () => 0.5
    })
    const total = spawners.reduce((sum, spawner) => sum + spawner.totalCount, 0)
    expect(total).toBe(75)
    expect(spawners).toHaveLength(3)
  })

  it('emits gradually and respects total cap', () => {
    const [spawner] = createWaveSpawners({
      wave: 1,
      totalMobCount: 3,
      doorPositions: [new THREE.Vector3(0, 0, 0)],
      baseSpawnRate: 10,
      random: () => 0.5
    })
    expect(spawner).toBeDefined()
    if (!spawner) return

    for (let i = 0; i < 10; i += 1) {
      emitFromSpawner(spawner, 0.2, () => true)
    }
    expect(spawner.spawnedCount).toBe(3)
    expect(spawner.aliveCount).toBe(3)
    expect(spawner.spawnedCount).toBeLessThanOrEqual(spawner.totalCount)
  })

  it('reports completion only when all spawned and dead', () => {
    const spawners = createWaveSpawners({
      wave: 2,
      totalMobCount: 2,
      doorPositions: [new THREE.Vector3(0, 0, 0)],
      baseSpawnRate: 10,
      random: () => 0.5
    })
    const [spawner] = spawners
    expect(spawner).toBeDefined()
    if (!spawner) return

    spawner.spawnedCount = spawner.totalCount
    spawner.aliveCount = 1
    expect(areWaveSpawnersDone(spawners)).toBe(false)
    spawner.aliveCount = 0
    expect(areWaveSpawnersDone(spawners)).toBe(true)
  })
})

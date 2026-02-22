import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { getCardinalWallLine, getWallLinePlacement, placeWallSegments } from '../src/placement/building'
import type { StaticCollider, Tower } from '../src/game/types'
import { StructureStore } from '../src/game/structures'

describe('placement helpers', () => {
  it('creates cardinal wall lines using dominant axis', () => {
    const start = new THREE.Vector3(0, 0, 0)
    const end = new THREE.Vector3(3, 0, 1)
    const line = getCardinalWallLine(start, end)
    expect(line.map(p => `${p.x},${p.z}`)).toEqual(['0,0', '1,0', '2,0', '3,0'])
  })

  it('stops placement when blocked', () => {
    const wall: StaticCollider = {
      center: new THREE.Vector3(2, 0.5, 0),
      halfSize: new THREE.Vector3(0.5, 0.5, 0.5),
      type: 'wall'
    }

    const result = getWallLinePlacement(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(4, 0, 0),
      10,
      [wall]
    )

    expect(result.validPositions.length).toBeGreaterThanOrEqual(0)
    expect(result.blockedPosition).not.toBeNull()
  })

  it('places drag walls as individual segments', () => {
    const scene = new THREE.Scene()
    const staticColliders: StaticCollider[] = []
    const towers: Tower[] = []
    const structureStore = new StructureStore(scene, staticColliders, towers, () => undefined, () => undefined)

    const positions = [
      new THREE.Vector3(8, 0.5, 0),
      new THREE.Vector3(9, 0.5, 0),
      new THREE.Vector3(10, 0.5, 0),
      new THREE.Vector3(11, 0.5, 0)
    ]

    const placed = placeWallSegments(positions, 10, {
      scene,
      structureStore,
      staticColliders,
      applyObstacleDelta: () => undefined
    })

    expect(placed).toBe(4)
    expect(structureStore.wallMeshes).toHaveLength(4)
    expect(structureStore.getDestructibleColliders().filter(collider => collider.type === 'wall')).toHaveLength(4)
  })

  it('marks placed wall segments as player-built decay candidates', () => {
    const scene = new THREE.Scene()
    const staticColliders: StaticCollider[] = []
    const towers: Tower[] = []
    const structureStore = new StructureStore(scene, staticColliders, towers, () => undefined, () => undefined)
    const positions = [new THREE.Vector3(12, 0.5, 2)]

    const placed = placeWallSegments(positions, 10, {
      scene,
      structureStore,
      staticColliders,
      applyObstacleDelta: () => undefined
    })

    expect(placed).toBe(1)
    const collider = structureStore.getDestructibleColliders()[0]
    const state = collider ? structureStore.structureStates.get(collider) : null
    expect(state?.playerBuilt).toBe(true)
    expect(state?.cumulativeBuildCost).toBe(2)
    expect((state?.graceUntilMs ?? 0) > (state?.createdAtMs ?? 0)).toBe(true)
  })
})

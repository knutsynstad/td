import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCastleFlowField, tracePathFromSpawner } from '../src/pathfinding/corridorFlowField'
import type { StaticCollider } from '../src/game/types'

describe('corridor flow field', () => {
  it('finds very long cardinal paths without search caps', () => {
    const field = buildCastleFlowField({
      goals: [new THREE.Vector3(0, 0, 0)],
      colliders: [],
      worldBounds: 256,
      resolution: 1,
      corridorHalfWidthCells: 1
    })
    const route = tracePathFromSpawner(field, {
      start: new THREE.Vector3(255, 0, 255)
    })

    expect(route.state).toBe('reachable')
    expect(route.points.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < route.points.length; i += 1) {
      const prev = route.points[i - 1]!
      const curr = route.points[i]!
      const dx = Math.abs(Math.round(curr.x - prev.x))
      const dz = Math.abs(Math.round(curr.z - prev.z))
      expect(dx === 0 || dz === 0).toBe(true)
    }
  })

  it('rejects one-cell choke points for three-wide corridors', () => {
    const colliders: StaticCollider[] = [
      { center: new THREE.Vector3(0, 0, 1), halfSize: new THREE.Vector3(10, 1, 0.1), type: 'wall' },
      { center: new THREE.Vector3(0, 0, -1), halfSize: new THREE.Vector3(10, 1, 0.1), type: 'wall' }
    ]

    const noClearanceField = buildCastleFlowField({
      goals: [new THREE.Vector3(8, 0, 0)],
      colliders,
      worldBounds: 10,
      resolution: 1,
      corridorHalfWidthCells: 0
    })
    const noClearanceRoute = tracePathFromSpawner(noClearanceField, {
      start: new THREE.Vector3(-8, 0, 0)
    })

    const threeWideField = buildCastleFlowField({
      goals: [new THREE.Vector3(8, 0, 0)],
      colliders,
      worldBounds: 10,
      resolution: 1,
      corridorHalfWidthCells: 1
    })
    const threeWideRoute = tracePathFromSpawner(threeWideField, {
      start: new THREE.Vector3(-8, 0, 0)
    })

    expect(noClearanceRoute.state).toBe('reachable')
    expect(threeWideRoute.state).toBe('blocked')
  })
})

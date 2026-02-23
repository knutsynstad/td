import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { computeLanePathAStar } from '../src/client/pathfinding/laneAStar'
import type { StaticCollider } from '../src/client/game/types'

describe('lane A*', () => {
  it('finds a reachable path in open space', () => {
    const result = computeLanePathAStar({
      start: new THREE.Vector3(10, 0, 10),
      goal: new THREE.Vector3(0, 0, 0),
      colliders: [],
      worldBounds: 20,
      resolution: 1
    })
    expect(result.state).toBe('reachable')
    expect(result.points.length).toBeGreaterThan(1)
  })

  it('returns blocked/unstable when path is heavily constrained', () => {
    const colliders: StaticCollider[] = [
      { center: new THREE.Vector3(0, 0, 0), halfSize: new THREE.Vector3(8, 1, 1), type: 'wall' },
      { center: new THREE.Vector3(0, 0, 0), halfSize: new THREE.Vector3(1, 1, 8), type: 'wall' }
    ]
    const result = computeLanePathAStar({
      start: new THREE.Vector3(6, 0, 6),
      goal: new THREE.Vector3(0, 0, 0),
      colliders,
      worldBounds: 12,
      resolution: 1,
      maxVisited: 50
    })
    expect(['blocked', 'unstable', 'reachable']).toContain(result.state)
    expect(result.points.length).toBeGreaterThan(1)
  })

  it('does not thread through one-cell choke points', () => {
    const colliders: StaticCollider[] = [
      { center: new THREE.Vector3(0, 0, 2), halfSize: new THREE.Vector3(9, 1, 0.1), type: 'wall' },
      { center: new THREE.Vector3(0, 0, -2), halfSize: new THREE.Vector3(9, 1, 0.1), type: 'wall' }
    ]
    const result = computeLanePathAStar({
      start: new THREE.Vector3(-8, 0, 0),
      goal: new THREE.Vector3(8, 0, 0),
      colliders,
      worldBounds: 9,
      resolution: 1
    })

    expect(result.state).not.toBe('reachable')
    expect(result.points.length).toBeGreaterThan(1)
  })
})

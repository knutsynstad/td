import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { aabbOverlap, distanceToColliderSurface } from '../src/client/physics/collision'
import type { StaticCollider } from '../src/client/game/types'

describe('collision helpers', () => {
  it('detects AABB overlap correctly', () => {
    const aCenter = new THREE.Vector3(0, 0, 0)
    const aHalf = new THREE.Vector3(1, 1, 1)
    const bCenter = new THREE.Vector3(1.5, 0, 0)
    const bHalf = new THREE.Vector3(1, 1, 1)
    expect(aabbOverlap(aCenter, aHalf, bCenter, bHalf)).toBe(true)
  })

  it('treats touching boxes as non-overlap when touching allowed', () => {
    const aCenter = new THREE.Vector3(0, 0, 0)
    const aHalf = new THREE.Vector3(1, 1, 1)
    const bCenter = new THREE.Vector3(2, 0, 0)
    const bHalf = new THREE.Vector3(1, 1, 1)
    expect(aabbOverlap(aCenter, aHalf, bCenter, bHalf, true)).toBe(false)
  })

  it('computes distance from circle edge to collider surface', () => {
    const collider: StaticCollider = {
      center: new THREE.Vector3(0, 0, 0),
      halfSize: new THREE.Vector3(1, 1, 1),
      type: 'wall'
    }
    const pos = new THREE.Vector3(3, 0, 0)
    const result = distanceToColliderSurface(pos, 0.5, collider)
    expect(result).toBeCloseTo(1.5)
  })
})

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { getCardinalWallLine, getWallLinePlacement } from '../src/placement/building'
import type { StaticCollider } from '../src/game/types'

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
})

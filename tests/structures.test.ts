import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { StructureStore } from '../src/game/structures'
import type { StaticCollider, Tower } from '../src/game/types'

const makeTower = (): Tower => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial())
  const rangeRing = new THREE.Mesh(new THREE.RingGeometry(4, 5, 16), new THREE.MeshBasicMaterial())
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), new THREE.MeshBasicMaterial())
  return {
    mesh,
    range: 5,
    damage: 4,
    rangeLevel: 0,
    damageLevel: 0,
    speedLevel: 0,
    killCount: 0,
    builtBy: 'test',
    shootCooldown: 0,
    shootCadence: 0.25,
    laserVisibleTime: 0,
    laser,
    rangeRing,
    typeId: 'base',
    level: 1
  }
}

describe('structure store', () => {
  it('adds and removes wall colliders consistently', () => {
    const scene = new THREE.Scene()
    const staticColliders: StaticCollider[] = []
    const towers: Tower[] = []
    const removed: Tower[] = []
    const store = new StructureStore(scene, staticColliders, towers, (tower) => removed.push(tower), () => undefined)

    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const collider = store.addWallCollider(
      new THREE.Vector3(2, 0.5, 2),
      new THREE.Vector3(0.5, 0.5, 0.5),
      wallMesh,
      100
    )
    expect(store.structureStates.size).toBe(1)
    expect(store.getDestructibleColliders()).toHaveLength(1)
    store.removeStructureCollider(collider)
    expect(store.structureStates.size).toBe(0)
    expect(store.getDestructibleColliders()).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })

  it('destroys towers on damage and removes them from active tower list', () => {
    const scene = new THREE.Scene()
    const staticColliders: StaticCollider[] = []
    const towers: Tower[] = []
    const removed: Tower[] = []
    const store = new StructureStore(scene, staticColliders, towers, (tower) => removed.push(tower), () => undefined)

    const tower = makeTower()
    towers.push(tower)
    const collider = store.addTowerCollider(
      new THREE.Vector3(3, 1, 3),
      new THREE.Vector3(0.5, 1, 0.5),
      tower.mesh,
      tower,
      10
    )
    const destroyed = store.damageStructure(collider, 20)
    expect(destroyed).toBe(true)
    expect(towers).toHaveLength(0)
    expect(removed).toHaveLength(1)
  })
})

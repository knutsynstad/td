import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeLanePathAStar } from '../../src/client/pathfinding/laneAStar'
import { buildCastleFlowField, tracePathFromSpawner } from '../../src/client/pathfinding/corridorFlowField'
import { createEntityMotionSystem } from '../../src/client/entities/motion'
import { StructureStore } from '../../src/client/game/structures'
import { SpatialGrid } from '../../src/client/utils/SpatialGrid'
import type { Entity, StaticCollider, Tower } from '../../src/client/game/types'

const WORLD_BOUNDS = 64
const GRID_SIZE = 1

const makeMob = (x: number, z: number): Entity => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial())
  mesh.position.set(x, 0.4, z)
  return {
    mesh,
    radius: 0.45,
    speed: 3,
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(0, 0, 0),
    kind: 'mob',
    hp: 3,
    maxHp: 3,
    baseY: 0.4,
    waypoints: [new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 0, 0)],
    waypointIndex: 1,
    berserkMode: false,
    berserkTarget: null,
    laneBlocked: false,
    siegeAttackCooldown: 0,
    unreachableTime: 0
  }
}

const runMobFrameStep = (count: number): number => {
  const scene = new THREE.Scene()
  const staticColliders: StaticCollider[] = []
  const towers: Tower[] = []
  const structureStore = new StructureStore(scene, staticColliders, towers, () => undefined, () => undefined)
  const spatialGrid = new SpatialGrid(3)
  const npcs: Entity[] = []
  const motion = createEntityMotionSystem({
    structureStore,
    staticColliders,
    spatialGrid,
    npcs,
    constants: {
      mobBerserkAttackCooldown: 0.8,
      mobBerserkDamage: 2,
      mobBerserkRangeBuffer: 0.35,
      mobBerserkUnreachableGrace: 1.2,
      worldBounds: WORLD_BOUNDS,
      gridSize: GRID_SIZE
    },
    random: () => 0.5,
    spawnCubeEffects: () => undefined
  })

  const mobs: Entity[] = []
  for (let i = 0; i < count; i += 1) {
    const laneOffset = i % 20
    const row = Math.floor(i / 20)
    mobs.push(makeMob(-WORLD_BOUNDS + 2 + laneOffset * 0.9, WORLD_BOUNDS - 2 - row * 0.8))
  }

  spatialGrid.clear()
  for (const mob of mobs) {
    spatialGrid.insert(mob)
  }

  const start = performance.now()
  for (const mob of mobs) {
    motion.updateEntityMotion(mob, 1 / 60)
  }
  return performance.now() - start
}

describe('performance baseline', () => {
  it('pathfinding baseline stays within practical budget', () => {
    const start = performance.now()
    const result = computeLanePathAStar({
      start: new THREE.Vector3(60, 0, 60),
      goal: new THREE.Vector3(0, 0, 0),
      colliders: [
        { center: new THREE.Vector3(5, 0, 5), halfSize: new THREE.Vector3(3, 1, 3), type: 'wall' },
        { center: new THREE.Vector3(-8, 0, -4), halfSize: new THREE.Vector3(2, 1, 8), type: 'wall' },
        { center: new THREE.Vector3(12, 0, -10), halfSize: new THREE.Vector3(6, 1, 2), type: 'wall' }
      ],
      worldBounds: WORLD_BOUNDS,
      resolution: GRID_SIZE
    })
    const elapsed = performance.now() - start
    console.info(`[perf] pathfinding_ms=${elapsed.toFixed(2)} state=${result.state} points=${result.points.length}`)
    expect(result.points.length).toBeGreaterThan(1)
    expect(elapsed).toBeLessThan(1200)
  })

  it('flow field rebuild + trace stays within practical budget', () => {
    const colliders: StaticCollider[] = [
      { center: new THREE.Vector3(5, 0, 5), halfSize: new THREE.Vector3(3, 1, 3), type: 'wall' },
      { center: new THREE.Vector3(-8, 0, -4), halfSize: new THREE.Vector3(2, 1, 8), type: 'wall' },
      { center: new THREE.Vector3(12, 0, -10), halfSize: new THREE.Vector3(6, 1, 2), type: 'wall' }
    ]
    const buildStart = performance.now()
    const field = buildCastleFlowField({
      goals: [
        new THREE.Vector3(0, 0, 4),
        new THREE.Vector3(0, 0, -4),
        new THREE.Vector3(4, 0, 0),
        new THREE.Vector3(-4, 0, 0)
      ],
      colliders,
      worldBounds: WORLD_BOUNDS,
      resolution: GRID_SIZE,
      corridorHalfWidthCells: 1
    })
    const route = tracePathFromSpawner(field, { start: new THREE.Vector3(60, 0, 60) })
    const elapsed = performance.now() - buildStart
    console.info(`[perf] flow_field_ms=${elapsed.toFixed(2)} state=${route.state} points=${route.points.length}`)
    expect(route.points.length).toBeGreaterThan(1)
    expect(elapsed).toBeLessThan(1200)
  })

  it('single-frame 500/1000 mob motion baseline stays bounded', () => {
    const ms500 = runMobFrameStep(500)
    const ms1000 = runMobFrameStep(1000)
    console.info(`[perf] mob_frame_500_ms=${ms500.toFixed(2)} mob_frame_1000_ms=${ms1000.toFixed(2)}`)
    expect(ms500).toBeLessThan(1200)
    expect(ms1000).toBeLessThan(2400)
  })
})

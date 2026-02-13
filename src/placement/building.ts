import * as THREE from 'three'
import { CASTLE_RADIUS, GRID_SIZE, TOWER_HEIGHT, TOWER_HP, WALL_HP, WORLD_BOUNDS } from '../game/constants'
import type { DestructibleCollider, StaticCollider, Tower } from '../game/types'
import type { StructureStore } from '../game/structures'
import { aabbOverlap } from '../physics/collision'

export type BuildMode = 'off' | 'wall' | 'tower'

type PlaceContext = {
  staticColliders: StaticCollider[]
  structureStore: StructureStore
  scene: THREE.Scene
  createTowerAt: (snapped: THREE.Vector3, typeId: 'base') => Tower
  applyObstacleDelta: (added: StaticCollider[], removed?: StaticCollider[]) => void
}

export const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE

export const withinBounds = (pos: THREE.Vector3) =>
  pos.x > -WORLD_BOUNDS && pos.x < WORLD_BOUNDS && pos.z > -WORLD_BOUNDS && pos.z < WORLD_BOUNDS

export const canPlace = (
  center: THREE.Vector3,
  halfSize: THREE.Vector3,
  staticColliders: StaticCollider[],
  allowTouchingStructures = false
) => {
  if (!withinBounds(center)) return false
  if (center.length() < CASTLE_RADIUS + 2) return false
  for (const collider of staticColliders) {
    if (collider.type === 'castle') continue
    if (aabbOverlap(center, halfSize, collider.center, collider.halfSize, allowTouchingStructures)) {
      return false
    }
  }
  return true
}

export const placeBuilding = (
  center: THREE.Vector3,
  buildMode: BuildMode,
  towerCharges: number,
  wallCharges: number,
  context: PlaceContext
) => {
  const isTower = buildMode === 'tower'
  const size = isTower ? new THREE.Vector3(1, TOWER_HEIGHT, 1) : new THREE.Vector3(1, 1, 1)
  const half = size.clone().multiplyScalar(0.5)
  const snapped = new THREE.Vector3(snapToGrid(center.x), half.y, snapToGrid(center.z))
  if (!canPlace(snapped, half, context.staticColliders, true)) return { placed: false, wallSpent: 0, towerSpent: 0 }
  if (isTower ? towerCharges < 1 : wallCharges < 1) return { placed: false, wallSpent: 0, towerSpent: 0 }

  let addedCollider: DestructibleCollider
  if (isTower) {
    const tower = context.createTowerAt(snapped, 'base')
    addedCollider = context.structureStore.addTowerCollider(snapped, half, tower.mesh, tower, TOWER_HP)
    context.applyObstacleDelta([addedCollider])
    return { placed: true, wallSpent: 0, towerSpent: 1 }
  }

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
  )
  mesh.position.copy(snapped)
  context.scene.add(mesh)
  addedCollider = context.structureStore.addWallCollider(snapped, half, mesh, WALL_HP)
  context.applyObstacleDelta([addedCollider])
  return { placed: true, wallSpent: 1, towerSpent: 0 }
}

export const getCardinalWallLine = (start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] => {
  const startSnapped = new THREE.Vector3(snapToGrid(start.x), 0, snapToGrid(start.z))
  const endSnapped = new THREE.Vector3(snapToGrid(end.x), 0, snapToGrid(end.z))

  const x0 = Math.round(startSnapped.x / GRID_SIZE)
  const z0 = Math.round(startSnapped.z / GRID_SIZE)
  const x1 = Math.round(endSnapped.x / GRID_SIZE)
  const z1 = Math.round(endSnapped.z / GRID_SIZE)

  const dx = x1 - x0
  const dz = z1 - z0
  const isHorizontal = Math.abs(dx) > Math.abs(dz)
  const isVertical = Math.abs(dz) > Math.abs(dx)

  let dirX = 0
  let dirZ = 0
  if (isHorizontal) {
    dirX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  } else if (isVertical) {
    dirZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  } else {
    dirX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  }

  const steps = isHorizontal ? Math.abs(dx) : Math.abs(dz)
  const positions: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i += 1) {
    positions.push(new THREE.Vector3((x0 + dirX * i) * GRID_SIZE, 0, (z0 + dirZ * i) * GRID_SIZE))
  }
  return positions
}

const WALL_LINE_SIZE = new THREE.Vector3(1, 1, 1)
const WALL_LINE_HALF = WALL_LINE_SIZE.clone().multiplyScalar(0.5)

export const getWallLinePlacement = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  availableWallCharges: number,
  staticColliders: StaticCollider[]
) => {
  const positions = getCardinalWallLine(start, end)
  const validPositions: THREE.Vector3[] = []
  const seenKeys = new Set<string>()
  let blockedPosition: THREE.Vector3 | null = null

  for (const pos of positions) {
    if (validPositions.length >= availableWallCharges) break
    const snapped = new THREE.Vector3(snapToGrid(pos.x), WALL_LINE_HALF.y, snapToGrid(pos.z))
    const key = `${snapped.x},${snapped.z}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    if (canPlace(snapped, WALL_LINE_HALF, staticColliders, true)) {
      validPositions.push(snapped)
    } else {
      blockedPosition = snapped
      break
    }
  }

  return { validPositions, blockedPosition, wallLineSize: WALL_LINE_SIZE, wallLineHalf: WALL_LINE_HALF }
}

export const placeWallLine = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  wallCharges: number,
  context: Pick<PlaceContext, 'scene' | 'structureStore' | 'staticColliders' | 'applyObstacleDelta'>
) => {
  const availableWallCharges = Math.floor(wallCharges)
  if (availableWallCharges <= 0) return 0
  const { validPositions } = getWallLinePlacement(start, end, availableWallCharges, context.staticColliders)

  let placed = 0
  for (const pos of validPositions) {
    if (placed >= availableWallCharges) break
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_LINE_SIZE.x, WALL_LINE_SIZE.y, WALL_LINE_SIZE.z),
      new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
    )
    mesh.position.copy(pos)
    context.scene.add(mesh)
    context.structureStore.addWallCollider(pos, WALL_LINE_HALF, mesh, WALL_HP)
    placed += 1
  }

  if (placed > 0) {
    const added = context.staticColliders.slice(context.staticColliders.length - placed)
    context.applyObstacleDelta(added)
  }
  return placed
}


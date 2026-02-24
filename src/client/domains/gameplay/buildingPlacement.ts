import * as THREE from 'three'
import {
  CASTLE_RADIUS,
  DECAY_GRACE_MS,
  ENERGY_COST_TOWER,
  ENERGY_COST_WALL,
  GRID_SIZE,
  TOWER_HEIGHT,
  TOWER_HP,
  WALL_HP,
  WORLD_BOUNDS
} from './constants'
import type { DestructibleCollider, StaticCollider, Tower } from './types/entities'
import type { StructureStore } from './structureStore'
import type { BuildMode } from './types/buildMode'
import { aabbOverlap } from '../world/collision'

export type { BuildMode } from './types/buildMode'

type PlaceContext = {
  staticColliders: StaticCollider[]
  structureStore: StructureStore
  scene: THREE.Scene
  createTowerAt: (snapped: THREE.Vector3, typeId: 'base') => Tower
  applyObstacleDelta: (added: StaticCollider[], removed?: StaticCollider[]) => void
}

export const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE

const snapForFootprint = (value: number, sizeAxis: number) => {
  const tileCount = Math.max(1, Math.round(sizeAxis / GRID_SIZE))
  if (tileCount % 2 === 0) {
    const halfGrid = GRID_SIZE * 0.5
    return Math.round((value - halfGrid) / GRID_SIZE) * GRID_SIZE + halfGrid
  }
  return snapToGrid(value)
}

export const getBuildSize = (buildMode: Exclude<BuildMode, 'off'>) => (
  buildMode === 'tower' ? new THREE.Vector3(2, TOWER_HEIGHT, 2) : new THREE.Vector3(1, 1, 1)
)

export const snapCenterToBuildGrid = (center: THREE.Vector3, size: THREE.Vector3) =>
  new THREE.Vector3(
    snapForFootprint(center.x, size.x),
    size.y * 0.5,
    snapForFootprint(center.z, size.z)
  )

export const withinBounds = (pos: THREE.Vector3) =>
  pos.x > -WORLD_BOUNDS && pos.x < WORLD_BOUNDS && pos.z > -WORLD_BOUNDS && pos.z < WORLD_BOUNDS

export const canPlace = (
  center: THREE.Vector3,
  halfSize: THREE.Vector3,
  staticColliders: StaticCollider[],
  allowTouchingStructures = false
) => {
  if (
    center.x - halfSize.x <= -WORLD_BOUNDS ||
    center.x + halfSize.x >= WORLD_BOUNDS ||
    center.z - halfSize.z <= -WORLD_BOUNDS ||
    center.z + halfSize.z >= WORLD_BOUNDS
  ) {
    return false
  }
  const minCastleDistance = CASTLE_RADIUS + 1.5 + Math.max(halfSize.x, halfSize.z)
  if (center.length() < minCastleDistance) return false
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
  energy: number,
  context: PlaceContext
) => {
  const isTower = buildMode === 'tower'
  const size = getBuildSize(isTower ? 'tower' : 'wall')
  const half = size.clone().multiplyScalar(0.5)
  const snapped = snapCenterToBuildGrid(center, size)
  const requiredEnergy = isTower ? ENERGY_COST_TOWER : ENERGY_COST_WALL
  if (!canPlace(snapped, half, context.staticColliders, true)) return { placed: false, energySpent: 0 }
  if (energy < requiredEnergy) return { placed: false, energySpent: 0 }

  let addedCollider: DestructibleCollider
  const nowMs = Date.now()
  const lifecycleMetadata = {
    playerBuilt: true,
    createdAtMs: nowMs,
    lastDecayTickMs: nowMs,
    graceUntilMs: nowMs + DECAY_GRACE_MS
  }
  if (isTower) {
    const tower = context.createTowerAt(snapped, 'base')
    addedCollider = context.structureStore.addTowerCollider(snapped, half, tower.mesh, tower, TOWER_HP, {
      ...lifecycleMetadata,
      cumulativeBuildCost: ENERGY_COST_TOWER
    })
    context.applyObstacleDelta([addedCollider])
    return { placed: true, energySpent: ENERGY_COST_TOWER }
  }

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
  )
  mesh.position.copy(snapped)
  context.scene.add(mesh)
  addedCollider = context.structureStore.addWallCollider(snapped, half, mesh, WALL_HP, {
    ...lifecycleMetadata,
    cumulativeBuildCost: ENERGY_COST_WALL
  })
  context.applyObstacleDelta([addedCollider])
  return { placed: true, energySpent: ENERGY_COST_WALL }
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
  energy: number,
  staticColliders: StaticCollider[]
) => {
  const availableWallSegments = Math.floor(energy / ENERGY_COST_WALL)
  const positions = getCardinalWallLine(start, end)
  const validPositions: THREE.Vector3[] = []
  const seenKeys = new Set<string>()
  let blockedPosition: THREE.Vector3 | null = null

  for (const pos of positions) {
    if (validPositions.length >= availableWallSegments) break
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
  energy: number,
  context: Pick<PlaceContext, 'scene' | 'structureStore' | 'staticColliders' | 'applyObstacleDelta'>
) => {
  const availableWallSegments = Math.floor(energy / ENERGY_COST_WALL)
  if (availableWallSegments <= 0) return 0
  const { validPositions } = getWallLinePlacement(start, end, energy, context.staticColliders)

  return placeWallSegments(validPositions, energy, context)
}

export const placeWallSegments = (
  positions: THREE.Vector3[],
  energy: number,
  context: Pick<PlaceContext, 'scene' | 'structureStore' | 'staticColliders' | 'applyObstacleDelta'>
) => {
  const availableWallSegments = Math.floor(energy / ENERGY_COST_WALL)
  if (availableWallSegments <= 0 || positions.length === 0) return 0

  let placed = 0
  for (const pos of positions) {
    if (placed >= availableWallSegments) break
    if (!canPlace(pos, WALL_LINE_HALF, context.staticColliders, true)) continue
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_LINE_SIZE.x, WALL_LINE_SIZE.y, WALL_LINE_SIZE.z),
      new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
    )
    mesh.position.copy(pos)
    context.scene.add(mesh)
    const nowMs = Date.now()
    context.structureStore.addWallCollider(pos, WALL_LINE_HALF, mesh, WALL_HP, {
      playerBuilt: true,
      createdAtMs: nowMs,
      lastDecayTickMs: nowMs,
      graceUntilMs: nowMs + DECAY_GRACE_MS,
      cumulativeBuildCost: ENERGY_COST_WALL
    })
    placed += 1
  }
  if (placed > 0) {
    const added = context.structureStore.getDestructibleColliders().slice(-placed)
    context.applyObstacleDelta(added)
  }
  return placed * ENERGY_COST_WALL
}

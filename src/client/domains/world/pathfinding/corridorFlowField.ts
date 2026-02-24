import * as THREE from 'three'
import type { StaticCollider, SpawnerRouteState } from '../../gameplay/types/entities'
import { simplifyCollinear } from './pathSimplification'

type CorridorFlowFieldOptions = {
  goals: readonly THREE.Vector3[]
  colliders: readonly StaticCollider[]
  worldBounds: number
  resolution: number
  corridorHalfWidthCells?: number
}

type TraceOptions = {
  start: THREE.Vector3
}

export type CorridorFlowField = {
  readonly worldBounds: number
  readonly resolution: number
  readonly width: number
  readonly height: number
  readonly minWX: number
  readonly minWZ: number
  readonly passable: Uint8Array
  readonly distance: Int32Array
  readonly nextToGoal: Int32Array
  readonly goals: THREE.Vector3[]
}

export type CorridorPathResult = {
  points: THREE.Vector3[]
  state: SpawnerRouteState
}

const CARDINALS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]
const DIRECTION_TO_OFFSET = CARDINALS

export const buildCastleFlowField = (opts: CorridorFlowFieldOptions): CorridorFlowField => {
  const res = opts.resolution
  const minWX = -opts.worldBounds
  const maxWX = opts.worldBounds
  const minWZ = -opts.worldBounds
  const maxWZ = opts.worldBounds

  const width = Math.max(2, Math.ceil((maxWX - minWX) / res) + 1)
  const height = Math.max(2, Math.ceil((maxWZ - minWZ) / res) + 1)
  const cellCount = width * height

  const toCellNearest = (x: number, z: number): [number, number] => {
    const cx = Math.max(0, Math.min(width - 1, Math.round((x - minWX) / res)))
    const cz = Math.max(0, Math.min(height - 1, Math.round((z - minWZ) / res)))
    return [cx, cz]
  }
  const toIdx = (x: number, z: number) => z * width + x
  const fromIdx = (idx: number): [number, number] => [idx % width, Math.floor(idx / width)]
  const passable = new Uint8Array(cellCount)
  passable.fill(1)
  const corridorHalfWidth = Math.max(0, opts.corridorHalfWidthCells ?? 1)
  const hasClearanceAt = (x: number, z: number, dx: number, dz: number) => {
    for (let lateral = -corridorHalfWidth; lateral <= corridorHalfWidth; lateral += 1) {
      const cx = dz !== 0 ? x + lateral : x
      const cz = dx !== 0 ? z + lateral : z
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false
      if (passable[toIdx(cx, cz)] === 0) return false
    }
    return true
  }
  for (const collider of opts.colliders) {
    const inflation = collider.type === 'castle'
      ? 2 * res
      : 0
    const minX = collider.center.x - collider.halfSize.x - inflation
    const maxX = collider.center.x + collider.halfSize.x + inflation
    const minZ = collider.center.z - collider.halfSize.z - inflation
    const maxZ = collider.center.z + collider.halfSize.z + inflation
    const eps = 1e-6
    const sx = Math.max(0, Math.min(width - 1, Math.ceil((minX - minWX) / res - eps)))
    const sz = Math.max(0, Math.min(height - 1, Math.ceil((minZ - minWZ) / res - eps)))
    const ex = Math.max(0, Math.min(width - 1, Math.floor((maxX - minWX) / res - eps)))
    const ez = Math.max(0, Math.min(height - 1, Math.floor((maxZ - minWZ) / res - eps)))
    if (sx > ex || sz > ez) continue
    for (let z = sz; z <= ez; z += 1) {
      for (let x = sx; x <= ex; x += 1) {
        passable[toIdx(x, z)] = 0
      }
    }
  }

  const goals = opts.goals.map((g) => g.clone())
  const distance = new Int32Array(cellCount)
  distance.fill(-1)
  const nextToGoal = new Int32Array(cellCount)
  nextToGoal.fill(-1)

  const queue = new Uint32Array(cellCount)
  let head = 0
  let tail = 0

  for (const goal of goals) {
    const [gx, gz] = toCellNearest(goal.x, goal.z)
    const idx = toIdx(gx, gz)
    passable[idx] = 1
    if (distance[idx] >= 0) continue
    distance[idx] = 0
    nextToGoal[idx] = idx
    queue[tail] = idx
    tail += 1
  }

  while (head < tail) {
    const currentIdx = queue[head]!
    head += 1
    const [cx, cz] = fromIdx(currentIdx)
    const currentDist = distance[currentIdx]!
    for (const [dx, dz] of CARDINALS) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
      const neighborIdx = toIdx(nx, nz)
      if (distance[neighborIdx] >= 0) continue
      if (!hasClearanceAt(nx, nz, dx, dz)) continue
      distance[neighborIdx] = currentDist + 1
      nextToGoal[neighborIdx] = currentIdx
      queue[tail] = neighborIdx
      tail += 1
    }
  }

  let maxDistance = 0
  for (let i = 0; i < cellCount; i += 1) {
    const d = distance[i]!
    if (d > maxDistance) maxDistance = d
  }
  const byDistance: number[][] = Array.from({ length: maxDistance + 1 }, () => [])
  for (let i = 0; i < cellCount; i += 1) {
    const d = distance[i]!
    if (d >= 0) byDistance[d]!.push(i)
  }
  const turnCost = new Int32Array(cellCount)
  turnCost.fill(1_000_000)
  const dirToGoal = new Int8Array(cellCount)
  dirToGoal.fill(-1)
  for (const idx of byDistance[0] ?? []) {
    turnCost[idx] = 0
    nextToGoal[idx] = idx
    dirToGoal[idx] = -1
  }
  for (let d = 1; d <= maxDistance; d += 1) {
    const layer = byDistance[d]
    if (!layer) continue
    for (const idx of layer) {
      const [cx, cz] = fromIdx(idx)
      let bestNeighbor = -1
      let bestTurns = 1_000_000
      let bestDir = -1
      for (let dir = 0; dir < DIRECTION_TO_OFFSET.length; dir += 1) {
        const [dx, dz] = DIRECTION_TO_OFFSET[dir]!
        const nx = cx + dx
        const nz = cz + dz
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue
        const nIdx = toIdx(nx, nz)
        if (distance[nIdx] !== d - 1) continue
        if (!hasClearanceAt(nx, nz, dx, dz)) continue
        const successorDir = dirToGoal[nIdx]
        const extraTurn = successorDir >= 0 && successorDir !== dir ? 1 : 0
        const turns = turnCost[nIdx]! + extraTurn
        if (turns < bestTurns || (turns === bestTurns && nIdx === nextToGoal[idx])) {
          bestTurns = turns
          bestNeighbor = nIdx
          bestDir = dir
        }
      }
      if (bestNeighbor >= 0) {
        nextToGoal[idx] = bestNeighbor
        turnCost[idx] = bestTurns
        dirToGoal[idx] = bestDir
      }
    }
  }

  return {
    worldBounds: opts.worldBounds,
    resolution: opts.resolution,
    width,
    height,
    minWX,
    minWZ,
    passable,
    distance,
    nextToGoal,
    goals
  }
}

export const tracePathFromSpawner = (field: CorridorFlowField, opts: TraceOptions): CorridorPathResult => {
  const toCellNearest = (x: number, z: number): [number, number] => {
    const cx = Math.max(0, Math.min(field.width - 1, Math.round((x - field.minWX) / field.resolution)))
    const cz = Math.max(0, Math.min(field.height - 1, Math.round((z - field.minWZ) / field.resolution)))
    return [cx, cz]
  }
  const toIdx = (x: number, z: number) => z * field.width + x
  const fromIdx = (idx: number): [number, number] => [idx % field.width, Math.floor(idx / field.width)]
  const toWorld = (x: number, z: number) => new THREE.Vector3(field.minWX + x * field.resolution, 0, field.minWZ + z * field.resolution)
  const hasStepClearance = (x: number, z: number, dx: number, dz: number) => {
    for (let lateral = -1; lateral <= 1; lateral += 1) {
      const cx = dz !== 0 ? x + lateral : x
      const cz = dx !== 0 ? z + lateral : z
      if (cx < 0 || cz < 0 || cx >= field.width || cz >= field.height) return false
      if (field.passable[toIdx(cx, cz)] === 0) return false
    }
    return true
  }
  const hasCardinalCorridorClearance = (from: THREE.Vector3, to: THREE.Vector3) => {
    const [ax, az] = toCellNearest(from.x, from.z)
    const [bx, bz] = toCellNearest(to.x, to.z)
    const dx = bx - ax
    const dz = bz - az
    if (dx !== 0 && dz !== 0) return false
    if (dx === 0 && dz === 0) return true
    const stepX = Math.sign(dx)
    const stepZ = Math.sign(dz)
    let x = ax
    let z = az
    while (x !== bx || z !== bz) {
      x += stepX
      z += stepZ
      if (!hasStepClearance(x, z, stepX, stepZ)) return false
    }
    return true
  }

  const [startX, startZ] = toCellNearest(opts.start.x, opts.start.z)
  const startIdx = toIdx(startX, startZ)
  if (field.distance[startIdx] < 0) {
    const fallbackGoal = field.goals[0]?.clone() ?? opts.start.clone()
    return {
      points: [opts.start.clone(), fallbackGoal],
      state: 'blocked'
    }
  }

  const raw: THREE.Vector3[] = [opts.start.clone()]
  let idx = startIdx
  let guard = 0
  const maxSteps = field.width * field.height
  let reachedGoal = false
  while (guard < maxSteps) {
    const nextIdx = field.nextToGoal[idx]
    if (nextIdx < 0) break
    if (nextIdx === idx) {
      reachedGoal = true
      break
    }
    const [nx, nz] = fromIdx(nextIdx)
    raw.push(toWorld(nx, nz))
    idx = nextIdx
    guard += 1
  }
  if (!reachedGoal) {
    const fallbackGoal = field.goals[0]?.clone() ?? opts.start.clone()
    return {
      points: [opts.start.clone(), fallbackGoal],
      state: 'blocked'
    }
  }
  if (field.goals.length > 0) {
    const last = raw[raw.length - 1]!
    const bestGoal = field.goals[0]!
    const [lastCellX, lastCellZ] = toCellNearest(last.x, last.z)
    const [goalCellX, goalCellZ] = toCellNearest(bestGoal.x, bestGoal.z)
    const oneCellCenterSnap = Math.abs(goalCellX - lastCellX) + Math.abs(goalCellZ - lastCellZ) <= 1
    if (last.distanceToSquared(bestGoal) > 1e-6 && (hasCardinalCorridorClearance(last, bestGoal) || oneCellCenterSnap)) {
      raw.push(bestGoal.clone())
    }
  }
  if (raw.length === 1) {
    raw.push(opts.start.clone())
  }
  const simplified = simplifyCollinear(raw)
  return {
    points: simplified,
    state: 'reachable'
  }
}

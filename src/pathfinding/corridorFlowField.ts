import * as THREE from 'three'
import type { StaticCollider, SpawnerRouteState } from '../game/types'

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

const simplifyCollinear = (points: THREE.Vector3[], epsilon = 0.01) => {
  if (points.length <= 2) return points.map((p) => p.clone())
  const out: THREE.Vector3[] = [points[0]!.clone()]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const d1x = curr.x - prev.x
    const d1z = curr.z - prev.z
    const d2x = next.x - curr.x
    const d2z = next.z - curr.z
    const len1 = Math.hypot(d1x, d1z)
    const len2 = Math.hypot(d2x, d2z)
    if (len1 <= 1e-6 || len2 <= 1e-6) {
      out.push(curr.clone())
      continue
    }
    const dot = (d1x / len1) * (d2x / len2) + (d1z / len1) * (d2z / len2)
    if (1 - Math.abs(dot) > epsilon) out.push(curr.clone())
  }
  out.push(points[points.length - 1]!.clone())
  return out
}

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
  // Inflate blockers by corridor half-width so paths keep required clearance.
  const clearanceInflation = corridorHalfWidth * res

  for (const collider of opts.colliders) {
    // Keep two extra cells around the castle so routes do not hug its walls.
    // Rocks already have explicit grid-sized colliders, so avoid adding a second ring.
    const inflation = collider.type === 'castle'
      ? 2 * res
      : collider.type === 'rock' || collider.type === 'tree' || collider.type === 'tower'
        ? 0
        : clearanceInflation
    const minX = collider.center.x - collider.halfSize.x - inflation
    const maxX = collider.center.x + collider.halfSize.x + inflation
    const minZ = collider.center.z - collider.halfSize.z - inflation
    const maxZ = collider.center.z + collider.halfSize.z + inflation
    const eps = 1e-6
    // Use half-open bounds [min, max) so collider-to-grid rasterization
    // does not add an extra ring of blocked cells at exact tile boundaries.
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
      if (passable[neighborIdx] === 0 || distance[neighborIdx] >= 0) continue
      distance[neighborIdx] = currentDist + 1
      nextToGoal[neighborIdx] = currentIdx
      queue[tail] = neighborIdx
      tail += 1
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
    let bestGoal = field.goals[0]!
    let bestDistSq = last.distanceToSquared(bestGoal)
    for (let i = 1; i < field.goals.length; i += 1) {
      const candidate = field.goals[i]!
      const distSq = last.distanceToSquared(candidate)
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestGoal = candidate
      }
    }
    if (last.distanceToSquared(bestGoal) > 1e-6) {
      raw.push(bestGoal.clone())
    }
  }
  if (raw.length === 1) {
    raw.push(opts.start.clone())
  }

  return {
    points: simplifyCollinear(raw),
    state: 'reachable'
  }
}

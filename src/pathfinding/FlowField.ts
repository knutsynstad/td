import * as THREE from 'three'
import { computeDistanceField } from './distanceField'
import { extractFlowField } from './flowExtraction'
import { getIndex, gridToWorld, worldToGrid } from './gridMath'
import type { GridBounds } from './gridMath'
import { computeDirtyBounds } from './obstacleDelta'
import type { NavCollider } from '../game/types'
import { computeWallDistanceField } from './wallDistanceField'

const RESCUE_SEARCH_RADIUS_CELLS = 8

type FlowFieldOptions = {
  size: number
  resolution: number
  worldBounds: number
}

export class FlowField {
  private readonly size: number
  private readonly resolution: number
  private readonly worldBounds: number
  private readonly cellRadius: number
  private readonly blocked: Uint8Array
  private readonly dist: Float32Array
  private readonly wallDist: Uint16Array
  private readonly flowX: Float32Array
  private readonly flowZ: Float32Array
  private goalX = 0
  private goalZ = 0

  constructor(options: FlowFieldOptions) {
    this.size = options.size
    this.resolution = options.resolution
    this.worldBounds = options.worldBounds
    this.cellRadius = this.resolution * 0.4
    const count = this.size * this.size
    this.blocked = new Uint8Array(count)
    this.dist = new Float32Array(count)
    this.wallDist = new Uint16Array(count)
    this.flowX = new Float32Array(count)
    this.flowZ = new Float32Array(count)
  }

  rebuildAll(staticColliders: NavCollider[], goal: THREE.Vector3) {
    ;[this.goalX, this.goalZ] = worldToGrid(
      goal.x,
      goal.z,
      this.worldBounds,
      this.resolution,
      this.size
    )
    this.refreshBlockedAll(staticColliders)
    this.rebuildScalarAndFlow()
  }

  applyObstacleDelta(
    allColliders: NavCollider[],
    addedColliders: NavCollider[],
    removedColliders: NavCollider[],
    goal: THREE.Vector3
  ): boolean {
    ;[this.goalX, this.goalZ] = worldToGrid(
      goal.x,
      goal.z,
      this.worldBounds,
      this.resolution,
      this.size
    )

    const dirtyBounds = computeDirtyBounds(
      addedColliders,
      removedColliders,
      this.worldBounds,
      this.resolution,
      this.size,
      this.cellRadius
    )

    if (!dirtyBounds) return false

    const changedCells = this.refreshBlockedBounds(allColliders, dirtyBounds)
    if (changedCells === 0) return false

    // We update obstacle occupancy only in dirty bounds, then rebuild scalar fields from
    // the cached occupancy grid. This avoids a full collider raster on small edits.
    this.rebuildScalarAndFlow()
    return true
  }

  getDirection(pos: THREE.Vector3): THREE.Vector3 {
    const [gx, gz] = worldToGrid(pos.x, pos.z, this.worldBounds, this.resolution, this.size)
    const idx = getIndex(gx, gz, this.size)
    const dx = this.flowX[idx]!
    const dz = this.flowZ[idx]!

    if (Math.abs(dx) + Math.abs(dz) > 0.0001) {
      return new THREE.Vector3(dx, 0, dz)
    }

    const rescue = this.getDirectionTowardReachableCell(pos, gx, gz)
    if (rescue) return rescue

    // Last-resort fallback.
    const fallback = new THREE.Vector3(-pos.x, 0, -pos.z)
    if (fallback.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 0)
    return fallback.normalize()
  }

  isReachable(pos: THREE.Vector3): boolean {
    const [gx, gz] = worldToGrid(pos.x, pos.z, this.worldBounds, this.resolution, this.size)
    const idx = getIndex(gx, gz, this.size)
    return Number.isFinite(this.dist[idx]!)
  }

  getDirectionTowardNearestWall(pos: THREE.Vector3): THREE.Vector3 | null {
    const [gx, gz] = worldToGrid(pos.x, pos.z, this.worldBounds, this.resolution, this.size)
    const idx = getIndex(gx, gz, this.size)
    const currentWallDist = this.wallDist[idx]!

    if (currentWallDist === 0) return null

    let bestX = gx
    let bestZ = gz
    let bestWallDist = currentWallDist

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const nx = gx + dx
        const nz = gz + dz
        if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size) continue
        const nIdx = getIndex(nx, nz, this.size)
        if (this.blocked[nIdx] === 1) continue
        const nWallDist = this.wallDist[nIdx]!
        if (nWallDist < bestWallDist) {
          bestWallDist = nWallDist
          bestX = nx
          bestZ = nz
        }
      }
    }

    if (bestX === gx && bestZ === gz) return null
    const [targetX, targetZ] = gridToWorld(bestX, bestZ, this.worldBounds, this.resolution)
    const dir = new THREE.Vector3(targetX - pos.x, 0, targetZ - pos.z)
    if (dir.lengthSq() < 0.0001) return null
    return dir.normalize()
  }

  computeWaypoints(start: THREE.Vector3, goal: THREE.Vector3, maxWaypoints = 100): THREE.Vector3[] {
    const waypoints: THREE.Vector3[] = [start.clone()]
    let current = start.clone()
    const waypointSpacing = this.resolution * 2
    const maxDistance = start.distanceTo(goal) * 2

    for (let i = 0; i < maxWaypoints; i++) {
      const dir = this.getDirection(current)
      if (dir.lengthSq() < 0.0001) break
      const next = current.clone().addScaledVector(dir, waypointSpacing)
      if (next.distanceTo(goal) < waypointSpacing * 1.5) {
        waypoints.push(goal.clone())
        break
      }
      waypoints.push(next.clone())
      current = next
      if (current.distanceTo(start) > maxDistance) break
    }

    return waypoints
  }

  private rebuildScalarAndFlow() {
    computeDistanceField(this.dist, this.blocked, this.size, this.goalX, this.goalZ)
    computeWallDistanceField(this.wallDist, this.blocked, this.size)
    extractFlowField(this.flowX, this.flowZ, this.dist, this.wallDist, this.blocked, this.size)
  }

  private getDirectionTowardReachableCell(pos: THREE.Vector3, gx: number, gz: number): THREE.Vector3 | null {
    let bestX = -1
    let bestZ = -1
    let bestDist = Number.POSITIVE_INFINITY
    let bestCellDistSq = Number.POSITIVE_INFINITY

    for (let radius = 1; radius <= RESCUE_SEARCH_RADIUS_CELLS; radius++) {
      const minX = Math.max(0, gx - radius)
      const maxX = Math.min(this.size - 1, gx + radius)
      const minZ = Math.max(0, gz - radius)
      const maxZ = Math.min(this.size - 1, gz + radius)

      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (x !== minX && x !== maxX && z !== minZ && z !== maxZ) continue
          const idx = getIndex(x, z, this.size)
          if (this.blocked[idx] === 1) continue
          const candidateDist = this.dist[idx]!
          if (!Number.isFinite(candidateDist)) continue
          const dx = x - gx
          const dz = z - gz
          const cellDistSq = dx * dx + dz * dz
          if (
            candidateDist + 1e-5 < bestDist ||
            (Math.abs(candidateDist - bestDist) <= 1e-5 && cellDistSq < bestCellDistSq)
          ) {
            bestDist = candidateDist
            bestCellDistSq = cellDistSq
            bestX = x
            bestZ = z
          }
        }
      }

      if (bestX !== -1) break
    }

    if (bestX === -1) return null
    const [tx, tz] = gridToWorld(bestX, bestZ, this.worldBounds, this.resolution)
    const dir = new THREE.Vector3(tx - pos.x, 0, tz - pos.z)
    if (dir.lengthSq() < 0.0001) return null
    return dir.normalize()
  }

  private refreshBlockedAll(colliders: NavCollider[]) {
    for (let gz = 0; gz < this.size; gz++) {
      for (let gx = 0; gx < this.size; gx++) {
        const idx = getIndex(gx, gz, this.size)
        this.blocked[idx] = this.isBlockedCell(gx, gz, colliders) ? 1 : 0
      }
    }
  }

  private refreshBlockedBounds(colliders: NavCollider[], bounds: GridBounds): number {
    let changed = 0
    for (let gz = bounds.minZ; gz <= bounds.maxZ; gz++) {
      for (let gx = bounds.minX; gx <= bounds.maxX; gx++) {
        const idx = getIndex(gx, gz, this.size)
        const nextValue = this.isBlockedCell(gx, gz, colliders) ? 1 : 0
        if (nextValue !== this.blocked[idx]) {
          this.blocked[idx] = nextValue
          changed++
        }
      }
    }
    return changed
  }

  private isBlockedCell(gx: number, gz: number, colliders: NavCollider[]): boolean {
    const [wx, wz] = gridToWorld(gx, gz, this.worldBounds, this.resolution)

    for (const collider of colliders) {
      if (collider.type === 'castle') continue
      const minX = collider.center.x - collider.halfSize.x - this.cellRadius
      const maxX = collider.center.x + collider.halfSize.x + this.cellRadius
      const minZ = collider.center.z - collider.halfSize.z - this.cellRadius
      const maxZ = collider.center.z + collider.halfSize.z + this.cellRadius
      if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
        return true
      }
    }

    return false
  }
}

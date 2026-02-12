import { expandBounds, worldToGrid } from './gridMath'
import type { GridBounds } from './gridMath'

export type NavCollider = {
  center: { x: number, z: number }
  halfSize: { x: number, z: number }
  type: 'castle' | 'wall' | 'tower'
}

const toBounds = (
  collider: NavCollider,
  worldBounds: number,
  resolution: number,
  size: number,
  radiusPadding: number
): GridBounds => {
  const minX = collider.center.x - collider.halfSize.x - radiusPadding
  const maxX = collider.center.x + collider.halfSize.x + radiusPadding
  const minZ = collider.center.z - collider.halfSize.z - radiusPadding
  const maxZ = collider.center.z + collider.halfSize.z + radiusPadding

  const [minGx, minGz] = worldToGrid(minX, minZ, worldBounds, resolution, size)
  const [maxGx, maxGz] = worldToGrid(maxX, maxZ, worldBounds, resolution, size)

  return {
    minX: Math.min(minGx, maxGx),
    maxX: Math.max(minGx, maxGx),
    minZ: Math.min(minGz, maxGz),
    maxZ: Math.max(minGz, maxGz)
  }
}

export const computeDirtyBounds = (
  added: NavCollider[],
  removed: NavCollider[],
  worldBounds: number,
  resolution: number,
  size: number,
  radiusPadding: number
): GridBounds | null => {
  const deltas = [...added, ...removed].filter(collider => collider.type !== 'castle')
  if (deltas.length === 0) return null

  let bounds = toBounds(deltas[0]!, worldBounds, resolution, size, radiusPadding)

  for (let i = 1; i < deltas.length; i++) {
    const next = toBounds(deltas[i]!, worldBounds, resolution, size, radiusPadding)
    bounds = {
      minX: Math.min(bounds.minX, next.minX),
      maxX: Math.max(bounds.maxX, next.maxX),
      minZ: Math.min(bounds.minZ, next.minZ),
      maxZ: Math.max(bounds.maxZ, next.maxZ)
    }
  }

  // One extra ring covers neighbor checks used by no-corner-cut logic.
  return expandBounds(bounds, 1, size)
}

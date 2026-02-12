import { getIndex, isInside } from './gridMath'

export type Neighbor = {
  dx: number
  dz: number
  cost: number
}

const SQRT2 = Math.sqrt(2)

export const CARDINAL_NEIGHBORS: Neighbor[] = [
  { dx: 0, dz: -1, cost: 1 },
  { dx: -1, dz: 0, cost: 1 },
  { dx: 1, dz: 0, cost: 1 },
  { dx: 0, dz: 1, cost: 1 }
]

// Stable order for deterministic tie-breaks.
export const EIGHT_NEIGHBORS: Neighbor[] = [
  { dx: 0, dz: -1, cost: 1 },
  { dx: -1, dz: 0, cost: 1 },
  { dx: 1, dz: 0, cost: 1 },
  { dx: 0, dz: 1, cost: 1 },
  { dx: -1, dz: -1, cost: SQRT2 },
  { dx: 1, dz: -1, cost: SQRT2 },
  { dx: -1, dz: 1, cost: SQRT2 },
  { dx: 1, dz: 1, cost: SQRT2 }
]

export const canStep = (
  gx: number,
  gz: number,
  dx: number,
  dz: number,
  blocked: Uint8Array,
  size: number
): boolean => {
  const nx = gx + dx
  const nz = gz + dz
  if (!isInside(nx, nz, size)) return false
  if (blocked[getIndex(nx, nz, size)] === 1) return false

  if (dx !== 0 && dz !== 0) {
    // No corner cutting: both side cardinals must be free.
    const sideA = getIndex(gx + dx, gz, size)
    const sideB = getIndex(gx, gz + dz, size)
    if (blocked[sideA] === 1 || blocked[sideB] === 1) return false
  }
  return true
}

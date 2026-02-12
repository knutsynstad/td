import { getIndex } from './gridMath'
import { EIGHT_NEIGHBORS, canStep } from './neighbors'

const DIST_EPSILON = 0.001

export const extractFlowField = (
  flowX: Float32Array,
  flowZ: Float32Array,
  dist: Float32Array,
  wallDist: Uint16Array,
  blocked: Uint8Array,
  size: number
) => {
  flowX.fill(0)
  flowZ.fill(0)

  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const idx = getIndex(gx, gz, size)
      if (blocked[idx] === 1) continue

      const currentDist = dist[idx]!
      if (!Number.isFinite(currentDist) || currentDist <= DIST_EPSILON) continue

      let bestDx = 0
      let bestDz = 0
      let bestDist = Number.POSITIVE_INFINITY
      let bestWallDist = -1

      for (const n of EIGHT_NEIGHBORS) {
        if (!canStep(gx, gz, n.dx, n.dz, blocked, size)) continue
        const nx = gx + n.dx
        const nz = gz + n.dz
        const nidx = getIndex(nx, nz, size)
        const candidateDist = dist[nidx]!
        if (!Number.isFinite(candidateDist)) continue
        if (candidateDist >= currentDist - DIST_EPSILON) continue

        if (candidateDist + DIST_EPSILON < bestDist) {
          bestDist = candidateDist
          bestWallDist = wallDist[nidx]!
          bestDx = n.dx
          bestDz = n.dz
          continue
        }

        if (Math.abs(candidateDist - bestDist) <= DIST_EPSILON) {
          const candidateWallDist = wallDist[nidx]!
          if (candidateWallDist > bestWallDist) {
            bestWallDist = candidateWallDist
            bestDx = n.dx
            bestDz = n.dz
          }
        }
      }

      if (bestDx !== 0 || bestDz !== 0) {
        const len = Math.sqrt(bestDx * bestDx + bestDz * bestDz)
        flowX[idx] = bestDx / len
        flowZ[idx] = bestDz / len
      }
    }
  }
}

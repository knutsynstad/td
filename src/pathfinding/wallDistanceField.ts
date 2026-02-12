import { getIndex } from './gridMath'
import { CARDINAL_NEIGHBORS } from './neighbors'

export const computeWallDistanceField = (
  wallDist: Uint16Array,
  blocked: Uint8Array,
  size: number
) => {
  const far = 0xffff
  wallDist.fill(far)

  const queueX = new Int16Array(size * size)
  const queueZ = new Int16Array(size * size)
  let head = 0
  let tail = 0

  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const idx = getIndex(gx, gz, size)
      if (blocked[idx] === 1) {
        wallDist[idx] = 0
        queueX[tail] = gx
        queueZ[tail] = gz
        tail++
      }
    }
  }

  while (head < tail) {
    const gx = queueX[head]!
    const gz = queueZ[head]!
    head++
    const idx = getIndex(gx, gz, size)
    const base = wallDist[idx]!
    const next = base + 1

    for (const n of CARDINAL_NEIGHBORS) {
      const nx = gx + n.dx
      const nz = gz + n.dz
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue
      const nidx = getIndex(nx, nz, size)
      if (next < wallDist[nidx]!) {
        wallDist[nidx] = next
        queueX[tail] = nx
        queueZ[tail] = nz
        tail++
      }
    }
  }
}

import { getIndex } from './gridMath'
import { EIGHT_NEIGHBORS, canStep } from './neighbors'

type HeapNode = [number, number, number]

const heapPush = (heap: HeapNode[], item: HeapNode) => {
  heap.push(item)
  let i = heap.length - 1
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2)
    if (heap[parent]![0] <= heap[i]![0]) break
    ;[heap[parent], heap[i]] = [heap[i]!, heap[parent]!]
    i = parent
  }
}

const heapPop = (heap: HeapNode[]): HeapNode => {
  const top = heap[0]!
  const bottom = heap.pop()!
  if (heap.length === 0) return top
  heap[0] = bottom
  let i = 0
  while (true) {
    const left = i * 2 + 1
    const right = i * 2 + 2
    let smallest = i
    if (left < heap.length && heap[left]![0] < heap[smallest]![0]) smallest = left
    if (right < heap.length && heap[right]![0] < heap[smallest]![0]) smallest = right
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!]
    i = smallest
  }
  return top
}

export const computeDistanceField = (
  dist: Float32Array,
  blocked: Uint8Array,
  size: number,
  goalX: number,
  goalZ: number
) => {
  dist.fill(Number.POSITIVE_INFINITY)
  const goalIdx = getIndex(goalX, goalZ, size)
  if (blocked[goalIdx] === 1) return

  const heap: HeapNode[] = []
  dist[goalIdx] = 0
  heapPush(heap, [0, goalX, goalZ])

  while (heap.length > 0) {
    const [cost, gx, gz] = heapPop(heap)
    const idx = getIndex(gx, gz, size)
    if (cost > dist[idx] + 1e-6) continue

    for (const n of EIGHT_NEIGHBORS) {
      if (!canStep(gx, gz, n.dx, n.dz, blocked, size)) continue
      const nx = gx + n.dx
      const nz = gz + n.dz
      const nidx = getIndex(nx, nz, size)
      const nextCost = cost + n.cost
      if (nextCost + 1e-6 < dist[nidx]) {
        dist[nidx] = nextCost
        heapPush(heap, [nextCost, nx, nz])
      }
    }
  }
}

import * as THREE from 'three'
import type { FlowField } from './FlowField'
import type { SpawnerRouteState } from '../game/types'

export type SpawnerPathline = {
  points: THREE.Vector3[]
  state: SpawnerRouteState
}

type BuildPathlineOptions = {
  flowField: FlowField
  start: THREE.Vector3
  goal: THREE.Vector3
  stepDistance: number
  sampleEvery: number
  maxSteps: number
}

const getCellKey = (x: number, z: number, cellSize: number) => {
  const cx = Math.floor(x / cellSize)
  const cz = Math.floor(z / cellSize)
  return `${cx},${cz}`
}

const simplifyCollinear = (points: THREE.Vector3[], epsilon = 0.02): THREE.Vector3[] => {
  if (points.length <= 2) return points
  const out: THREE.Vector3[] = [points[0]!.clone()]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const d1 = new THREE.Vector3(curr.x - prev.x, 0, curr.z - prev.z).normalize()
    const d2 = new THREE.Vector3(next.x - curr.x, 0, next.z - curr.z).normalize()
    const keep = 1 - Math.abs(d1.dot(d2)) > epsilon
    if (keep) out.push(curr.clone())
  }
  out.push(points[points.length - 1]!.clone())
  return out
}

export const buildSpawnerPathline = (opts: BuildPathlineOptions): SpawnerPathline => {
  const points: THREE.Vector3[] = [opts.start.clone()]
  const seenCells = new Set<string>()
  let state: SpawnerRouteState = 'reachable'
  let current = opts.start.clone()
  const sampleEvery = Math.max(1, opts.sampleEvery)

  for (let i = 0; i < opts.maxSteps; i += 1) {
    if (!opts.flowField.isReachable(current)) {
      state = 'blocked'
      break
    }
    const cellKey = getCellKey(current.x, current.z, opts.stepDistance)
    if (seenCells.has(cellKey)) {
      state = 'unstable'
      break
    }
    seenCells.add(cellKey)

    const dir = opts.flowField.getDirection(current)
    if (dir.lengthSq() < 0.0001) {
      state = 'blocked'
      break
    }

    current.addScaledVector(dir, opts.stepDistance)
    if (i % sampleEvery === 0) {
      points.push(current.clone())
    }
    if (current.distanceTo(opts.goal) <= opts.stepDistance * 1.5) {
      points.push(opts.goal.clone())
      state = 'reachable'
      break
    }
  }

  if (points.length === 1) {
    points.push(opts.goal.clone())
  }
  return {
    points: simplifyCollinear(points),
    state
  }
}

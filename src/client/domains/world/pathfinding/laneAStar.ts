import * as THREE from 'three';
import type {
  StaticCollider,
  SpawnerRouteState,
} from '../../gameplay/types/entities';
import { simplifyCollinear } from './pathSimplification';

type LanePathOptions = {
  start: THREE.Vector3;
  goal: THREE.Vector3;
  colliders: StaticCollider[];
  worldBounds: number;
  resolution: number;
  maxVisited?: number;
};

export type LanePathResult = {
  points: THREE.Vector3[];
  state: SpawnerRouteState;
};

type HeapNode = { idx: number; f: number; turns: number; hops: number };

const heapPush = (heap: HeapNode[], node: HeapNode) => {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    const a = heap[parent]!;
    const b = heap[i]!;
    if (
      a.f < b.f ||
      (Math.abs(a.f - b.f) <= 1e-6 &&
        (a.turns < b.turns || (a.turns === b.turns && a.hops <= b.hops)))
    ) {
      break;
    }
    [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
    i = parent;
  }
};

const heapPop = (heap: HeapNode[]): HeapNode => {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  while (true) {
    const left = i * 2 + 1;
    const right = i * 2 + 2;
    let smallest = i;
    const isHigherPriority = (candidate: HeapNode, current: HeapNode) => {
      if (candidate.f + 1e-6 < current.f) return true;
      if (Math.abs(candidate.f - current.f) <= 1e-6) {
        if (candidate.turns < current.turns) return true;
        if (candidate.turns === current.turns && candidate.hops < current.hops)
          return true;
      }
      return false;
    };
    if (left < heap.length && isHigherPriority(heap[left]!, heap[smallest]!))
      smallest = left;
    if (right < heap.length && isHigherPriority(heap[right]!, heap[smallest]!))
      smallest = right;
    if (smallest === i) break;
    [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
    i = smallest;
  }
  return top;
};

const manhattan = (dx: number, dz: number) => Math.abs(dx) + Math.abs(dz);

const OFFSETS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
];

const MIN_CORRIDOR_INFLATION_RADIUS = 1.0;
const REQUIRED_LANE_HALF_WIDTH_CELLS = 1;
export const computeLanePathAStar = (opts: LanePathOptions): LanePathResult => {
  const maxVisited = opts.maxVisited ?? 200_000;
  const res = opts.resolution;

  const minWX = -opts.worldBounds;
  const maxWX = opts.worldBounds;
  const minWZ = -opts.worldBounds;
  const maxWZ = opts.worldBounds;

  const width = Math.max(2, Math.ceil((maxWX - minWX) / res) + 1);
  const height = Math.max(2, Math.ceil((maxWZ - minWZ) / res) + 1);
  const cellCount = width * height;

  const toCellNearest = (x: number, z: number): [number, number] => {
    const cx = Math.max(0, Math.min(width - 1, Math.round((x - minWX) / res)));
    const cz = Math.max(0, Math.min(height - 1, Math.round((z - minWZ) / res)));
    return [cx, cz];
  };
  const toIdx = (x: number, z: number) => z * width + x;
  const fromIdx = (idx: number): [number, number] => [
    idx % width,
    Math.floor(idx / width),
  ];
  const toWorld = (x: number, z: number) =>
    new THREE.Vector3(minWX + x * res, 0, minWZ + z * res);
  const blocked = new Uint8Array(cellCount);
  for (const collider of opts.colliders) {
    const inflate =
      collider.type === 'castle'
        ? 0
        : Math.max(res * 0.4, MIN_CORRIDOR_INFLATION_RADIUS);
    const minX = collider.center.x - collider.halfSize.x - inflate;
    const maxX = collider.center.x + collider.halfSize.x + inflate;
    const minZ = collider.center.z - collider.halfSize.z - inflate;
    const maxZ = collider.center.z + collider.halfSize.z + inflate;
    const sx = Math.max(
      0,
      Math.min(width - 1, Math.floor((minX - minWX) / res))
    );
    const sz = Math.max(
      0,
      Math.min(height - 1, Math.floor((minZ - minWZ) / res))
    );
    const ex = Math.max(
      0,
      Math.min(width - 1, Math.ceil((maxX - minWX) / res))
    );
    const ez = Math.max(
      0,
      Math.min(height - 1, Math.ceil((maxZ - minWZ) / res))
    );
    for (let z = sz; z <= ez; z += 1) {
      for (let x = sx; x <= ex; x += 1) {
        blocked[toIdx(x, z)] = 1;
      }
    }
  }

  const [startX, startZ] = toCellNearest(opts.start.x, opts.start.z);
  const [goalX, goalZ] = toCellNearest(opts.goal.x, opts.goal.z);
  const startIdx = toIdx(startX, startZ);
  const goalIdx = toIdx(goalX, goalZ);
  blocked[startIdx] = 0;
  blocked[goalIdx] = 0;
  const hasRequiredClearanceAt = (
    x: number,
    z: number,
    dx: number,
    dz: number
  ) => {
    for (
      let lateral = -REQUIRED_LANE_HALF_WIDTH_CELLS;
      lateral <= REQUIRED_LANE_HALF_WIDTH_CELLS;
      lateral += 1
    ) {
      const cx = dz !== 0 ? x + lateral : x;
      const cz = dx !== 0 ? z + lateral : z;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false;
      if (blocked[toIdx(cx, cz)] === 1) return false;
    }
    return true;
  };

  const gScore = new Float32Array(cellCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  const turnScore = new Uint16Array(cellCount);
  turnScore.fill(0xffff);
  const hopScore = new Uint16Array(cellCount);
  hopScore.fill(0xffff);
  const dirToNode = new Int8Array(cellCount);
  dirToNode.fill(-1);
  const parent = new Int32Array(cellCount);
  parent.fill(-1);
  const closed = new Uint8Array(cellCount);
  const open = new Uint8Array(cellCount);
  const heap: HeapNode[] = [];

  const reconstructPath = (endIdx: number): THREE.Vector3[] => {
    const raw: THREE.Vector3[] = [opts.goal.clone()];
    let idx = endIdx;
    while (idx >= 0) {
      const [x, z] = fromIdx(idx);
      raw.push(toWorld(x, z));
      if (idx === startIdx) break;
      const p = parent[idx];
      if (p < 0) break;
      idx = p;
    }
    raw.push(opts.start.clone());
    raw.reverse();
    if (raw.length > 0) {
      raw[0] = opts.start.clone();
      raw[raw.length - 1] = opts.goal.clone();
    }
    return simplifyCollinear(raw);
  };

  gScore[startIdx] = 0;
  turnScore[startIdx] = 0;
  hopScore[startIdx] = 0;
  heapPush(heap, {
    idx: startIdx,
    f: manhattan(goalX - startX, goalZ - startZ),
    turns: 0,
    hops: 0,
  });
  open[startIdx] = 1;

  let visited = 0;
  let found = false;
  let bestIdx = startIdx;
  let bestHeuristic = manhattan(goalX - startX, goalZ - startZ);
  while (heap.length > 0) {
    const current = heapPop(heap);
    if (closed[current.idx] === 1) continue;
    closed[current.idx] = 1;
    visited += 1;
    const [cx, cz] = fromIdx(current.idx);
    const h = manhattan(goalX - cx, goalZ - cz);
    if (h < bestHeuristic) {
      bestHeuristic = h;
      bestIdx = current.idx;
    }
    if (visited > maxVisited) {
      return { points: reconstructPath(bestIdx), state: 'unstable' };
    }
    if (current.idx === goalIdx) {
      found = true;
      break;
    }

    const currentG = gScore[current.idx]!;
    const currentTurns = turnScore[current.idx]!;
    const currentHops = hopScore[current.idx]!;
    const currentDir = dirToNode[current.idx]!;
    for (let offsetIdx = 0; offsetIdx < OFFSETS.length; offsetIdx += 1) {
      const [dx, dz, stepCost] = OFFSETS[offsetIdx]!;
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      if (!hasRequiredClearanceAt(nx, nz, dx, dz)) continue;
      const nIdx = toIdx(nx, nz);
      if (blocked[nIdx] === 1 || closed[nIdx] === 1) continue;
      if (dx !== 0 && dz !== 0) {
        const sideA = toIdx(cx + dx, cz);
        const sideB = toIdx(cx, cz + dz);
        if (blocked[sideA] === 1 || blocked[sideB] === 1) continue;
      }
      const tentative = currentG + stepCost;
      const extraTurn = currentDir >= 0 && currentDir !== offsetIdx ? 1 : 0;
      const nextTurns = currentTurns + extraTurn;
      const nextHops = currentHops + 1;
      const equalDistance = Math.abs(tentative - gScore[nIdx]!) <= 1e-4;
      const betterTieBreak =
        nextTurns < turnScore[nIdx]! ||
        (nextTurns === turnScore[nIdx]! && nextHops < hopScore[nIdx]!);
      if (
        tentative + 1e-4 < gScore[nIdx]! ||
        (equalDistance && betterTieBreak)
      ) {
        gScore[nIdx] = tentative;
        parent[nIdx] = current.idx;
        turnScore[nIdx] = nextTurns;
        hopScore[nIdx] = nextHops;
        dirToNode[nIdx] = offsetIdx;
        const f = tentative + manhattan(goalX - nx, goalZ - nz);
        heapPush(heap, { idx: nIdx, f, turns: nextTurns, hops: nextHops });
        open[nIdx] = 1;
      }
    }
  }

  if (!found) {
    return { points: reconstructPath(bestIdx), state: 'blocked' };
  }
  return { points: reconstructPath(goalIdx), state: 'reachable' };
};

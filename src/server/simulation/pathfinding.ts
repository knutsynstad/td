import type { GameWorld, StructureState } from '../../shared/game-state';
import {
  getStructureFootprint,
  STRUCTURE_DEFS,
} from '../../shared/content/structures';
import {
  WORLD_BOUNDS,
  GRID_SIZE,
  CASTLE_HALF_EXTENT,
} from '../../shared/content/world';
import {
  WAVE_MIN_SPAWNERS,
  WAVE_MAX_SPAWNERS,
} from '../../shared/content/waves';
import { clamp, distance2d, shuffle } from '../../shared/utils';
import { MAX_STRUCTURE_DELTA_REMOVES } from '../config';

const SPAWNER_ENTRY_INSET_CELLS = 3;
const STAGING_ISLAND_DISTANCE = 14;
const CASTLE_ROUTE_HALF_WIDTH_CELLS = 1;

export type SideId = 'north' | 'east' | 'south' | 'west';

export type SideDef = {
  id: SideId;
  door: { x: number; z: number };
  outward: { x: number; z: number };
  tangent: { x: number; z: number };
};

export type FlowField = {
  width: number;
  height: number;
  minWX: number;
  minWZ: number;
  resolution: number;
  passable: Uint8Array;
  distance: Int32Array;
  nextToGoal: Int32Array;
  goals: Array<{ x: number; z: number }>;
};

export const SIDE_DEFS: SideDef[] = [
  {
    id: 'north',
    door: { x: 0, z: -WORLD_BOUNDS },
    outward: { x: 0, z: -1 },
    tangent: { x: 1, z: 0 },
  },
  {
    id: 'east',
    door: { x: WORLD_BOUNDS, z: 0 },
    outward: { x: 1, z: 0 },
    tangent: { x: 0, z: 1 },
  },
  {
    id: 'south',
    door: { x: 0, z: WORLD_BOUNDS },
    outward: { x: 0, z: 1 },
    tangent: { x: 1, z: 0 },
  },
  {
    id: 'west',
    door: { x: -WORLD_BOUNDS, z: 0 },
    outward: { x: -1, z: 0 },
    tangent: { x: 0, z: 1 },
  },
];

const CARDINALS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const toSideDef = (spawnerId: string): SideDef => {
  for (const side of SIDE_DEFS) {
    if (spawnerId.endsWith(`-${side.id}`)) return side;
  }
  return SIDE_DEFS[0]!;
};

export const getSpawnerEntryPoint = (
  side: SideDef
): { x: number; z: number } => {
  const inset = GRID_SIZE * SPAWNER_ENTRY_INSET_CELLS;
  const x = Math.round(side.door.x - side.outward.x * inset);
  const z = Math.round(side.door.z - side.outward.z * inset);
  return {
    x: clamp(x, -WORLD_BOUNDS + inset, WORLD_BOUNDS - inset),
    z: clamp(z, -WORLD_BOUNDS + inset, WORLD_BOUNDS - inset),
  };
};

export const getSpawnerSpawnPoint = (
  side: SideDef
): { x: number; z: number } => {
  const lateralJitter = (Math.random() - 0.5) * 2.8;
  const alongBridgeJitter = Math.random() * 1.8;
  const towardMapX = -side.outward.x;
  const towardMapZ = -side.outward.z;
  const baseX = side.door.x + side.outward.x * STAGING_ISLAND_DISTANCE;
  const baseZ = side.door.z + side.outward.z * STAGING_ISLAND_DISTANCE;
  return {
    x: baseX + side.tangent.x * lateralJitter + towardMapX * alongBridgeJitter,
    z: baseZ + side.tangent.z * lateralJitter + towardMapZ * alongBridgeJitter,
  };
};

export const getCastleEntryGoals = (): Array<{ x: number; z: number }> => {
  const approachOffset = GRID_SIZE * 3;
  return [
    { x: 0, z: CASTLE_HALF_EXTENT + approachOffset },
    { x: 0, z: -CASTLE_HALF_EXTENT - approachOffset },
    { x: CASTLE_HALF_EXTENT + approachOffset, z: 0 },
    { x: -CASTLE_HALF_EXTENT - approachOffset, z: 0 },
  ];
};

export const pickSpawnerSidesForWave = (wave: number): SideDef[] => {
  const waveCap = Math.min(
    WAVE_MAX_SPAWNERS,
    WAVE_MIN_SPAWNERS + Math.floor(wave / 3)
  );
  const count = clamp(
    WAVE_MIN_SPAWNERS +
      Math.floor(Math.random() * (waveCap - WAVE_MIN_SPAWNERS + 1)),
    WAVE_MIN_SPAWNERS,
    WAVE_MAX_SPAWNERS
  );
  return shuffle(SIDE_DEFS).slice(0, count);
};

export const buildFlowField = (
  structures: ReadonlyMap<string, StructureState>,
  goals: Array<{ x: number; z: number }>
): FlowField => {
  const minWX = -WORLD_BOUNDS;
  const maxWX = WORLD_BOUNDS;
  const minWZ = -WORLD_BOUNDS;
  const maxWZ = WORLD_BOUNDS;
  const width = Math.max(2, Math.ceil((maxWX - minWX) / GRID_SIZE) + 1);
  const height = Math.max(2, Math.ceil((maxWZ - minWZ) / GRID_SIZE) + 1);
  const cellCount = width * height;
  const passable = new Uint8Array(cellCount);
  passable.fill(1);
  const distance = new Int32Array(cellCount);
  distance.fill(-1);
  const nextToGoal = new Int32Array(cellCount);
  nextToGoal.fill(-1);

  const toCellNearest = (x: number, z: number): [number, number] => {
    const cx = Math.max(
      0,
      Math.min(width - 1, Math.round((x - minWX) / GRID_SIZE))
    );
    const cz = Math.max(
      0,
      Math.min(height - 1, Math.round((z - minWZ) / GRID_SIZE))
    );
    return [cx, cz];
  };
  const toIdx = (x: number, z: number) => z * width + x;
  const fromIdx = (idx: number): [number, number] => [
    idx % width,
    Math.floor(idx / width),
  ];

  const markBlockedAabb = (
    centerX: number,
    centerZ: number,
    halfX: number,
    halfZ: number
  ) => {
    const minX = centerX - halfX;
    const maxX = centerX + halfX;
    const minZ = centerZ - halfZ;
    const maxZ = centerZ + halfZ;
    const sx = Math.max(
      0,
      Math.min(width - 1, Math.floor((minX - minWX) / GRID_SIZE))
    );
    const sz = Math.max(
      0,
      Math.min(height - 1, Math.floor((minZ - minWZ) / GRID_SIZE))
    );
    const ex = Math.max(
      0,
      Math.min(width - 1, Math.ceil((maxX - minWX) / GRID_SIZE))
    );
    const ez = Math.max(
      0,
      Math.min(height - 1, Math.ceil((maxZ - minWZ) / GRID_SIZE))
    );
    for (let z = sz; z <= ez; z += 1) {
      for (let x = sx; x <= ex; x += 1) {
        passable[toIdx(x, z)] = 0;
      }
    }
  };

  // Keep castle walls blocked so routes terminate at entrances.
  markBlockedAabb(0, 0, CASTLE_HALF_EXTENT, CASTLE_HALF_EXTENT);

  for (const structure of structures.values()) {
    const def = STRUCTURE_DEFS[structure.type];
    const foot = getStructureFootprint(structure);
    markBlockedAabb(
      structure.center.x,
      structure.center.z,
      foot.halfX + def.pathInflate,
      foot.halfZ + def.pathInflate
    );
  }

  const hasClearanceAt = (x: number, z: number, dx: number, dz: number) => {
    for (
      let lateral = -CASTLE_ROUTE_HALF_WIDTH_CELLS;
      lateral <= CASTLE_ROUTE_HALF_WIDTH_CELLS;
      lateral += 1
    ) {
      const cx = dz !== 0 ? x + lateral : x;
      const cz = dx !== 0 ? z + lateral : z;
      if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false;
      if (passable[toIdx(cx, cz)] === 0) return false;
    }
    return true;
  };

  const queue = new Uint32Array(cellCount);
  let head = 0;
  let tail = 0;
  for (const goal of goals) {
    const [gx, gz] = toCellNearest(goal.x, goal.z);
    const idx = toIdx(gx, gz);
    passable[idx] = 1;
    if (distance[idx] >= 0) continue;
    distance[idx] = 0;
    nextToGoal[idx] = idx;
    queue[tail] = idx;
    tail += 1;
  }

  while (head < tail) {
    const currentIdx = queue[head]!;
    head += 1;
    const [cx, cz] = fromIdx(currentIdx);
    const baseDist = distance[currentIdx]!;
    for (const [dx, dz] of CARDINALS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      const nIdx = toIdx(nx, nz);
      if (distance[nIdx] >= 0) continue;
      if (!hasClearanceAt(nx, nz, dx, dz)) continue;
      distance[nIdx] = baseDist + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }

  let maxDistance = 0;
  for (let i = 0; i < cellCount; i += 1) {
    const d = distance[i]!;
    if (d > maxDistance) maxDistance = d;
  }
  const byDistance: number[][] = Array.from(
    { length: maxDistance + 1 },
    () => []
  );
  for (let i = 0; i < cellCount; i += 1) {
    const d = distance[i]!;
    if (d >= 0) byDistance[d]!.push(i);
  }
  const turnCost = new Int32Array(cellCount);
  turnCost.fill(1_000_000);
  const dirToGoal = new Int8Array(cellCount);
  dirToGoal.fill(-1);
  for (const idx of byDistance[0] ?? []) {
    turnCost[idx] = 0;
    nextToGoal[idx] = idx;
    dirToGoal[idx] = -1;
  }
  for (let d = 1; d <= maxDistance; d += 1) {
    const layer = byDistance[d];
    if (!layer) continue;
    for (const idx of layer) {
      const [cx, cz] = fromIdx(idx);
      let bestNeighbor = -1;
      let bestTurns = 1_000_000;
      let bestDir = -1;
      for (let dir = 0; dir < CARDINALS.length; dir += 1) {
        const [dx, dz] = CARDINALS[dir]!;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const nIdx = toIdx(nx, nz);
        if (distance[nIdx] !== d - 1) continue;
        if (!hasClearanceAt(nx, nz, dx, dz)) continue;
        const successorDir = dirToGoal[nIdx];
        const extraTurn = successorDir >= 0 && successorDir !== dir ? 1 : 0;
        const turns = turnCost[nIdx]! + extraTurn;
        if (turns < bestTurns) {
          bestTurns = turns;
          bestNeighbor = nIdx;
          bestDir = dir;
        }
      }
      if (bestNeighbor >= 0) {
        nextToGoal[idx] = bestNeighbor;
        turnCost[idx] = bestTurns;
        dirToGoal[idx] = bestDir;
      }
    }
  }

  return {
    width,
    height,
    minWX,
    minWZ,
    resolution: GRID_SIZE,
    passable,
    distance,
    nextToGoal,
    goals,
  };
};

export const getNearestGoalDistance = (
  goals: Array<{ x: number; z: number }>,
  x: number,
  z: number
) => {
  let best = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const d = distance2d(goal.x, goal.z, x, z);
    if (d < best) best = d;
  }
  return best;
};

export const buildSpawnerRoute = (
  field: FlowField,
  start: { x: number; z: number }
): {
  route: Array<{ x: number; z: number }>;
  routeState: 'reachable' | 'blocked';
} => {
  const toCellNearest = (wx: number, wz: number): [number, number] => {
    const cx = Math.max(
      0,
      Math.min(
        field.width - 1,
        Math.round((wx - field.minWX) / field.resolution)
      )
    );
    const cz = Math.max(
      0,
      Math.min(
        field.height - 1,
        Math.round((wz - field.minWZ) / field.resolution)
      )
    );
    return [cx, cz];
  };
  const toIdx = (cx: number, cz: number) => cz * field.width + cx;
  const fromIdx = (idx: number): [number, number] => [
    idx % field.width,
    Math.floor(idx / field.width),
  ];
  const toWorld = (cx: number, cz: number) => ({
    x: field.minWX + cx * field.resolution,
    z: field.minWZ + cz * field.resolution,
  });

  const route: Array<{ x: number; z: number }> = [start];
  const [startCellX, startCellZ] = toCellNearest(start.x, start.z);
  const startIdx = toIdx(startCellX, startCellZ);
  if (field.distance[startIdx] < 0) {
    if (field.goals[0]) route.push(field.goals[0]);
    return { route, routeState: 'blocked' };
  }
  let idx = startIdx;
  const maxSteps = field.width * field.height;
  for (let step = 0; step < maxSteps; step += 1) {
    if (field.distance[idx] === 0) {
      return { route, routeState: 'reachable' };
    }
    const nextIdx = field.nextToGoal[idx];
    if (nextIdx < 0 || nextIdx === idx) break;
    const [nx, nz] = fromIdx(nextIdx);
    const nextPoint = toWorld(nx, nz);
    const last = route[route.length - 1]!;
    if (distance2d(last.x, last.z, nextPoint.x, nextPoint.z) > 0.25) {
      route.push(nextPoint);
    }
    idx = nextIdx;
  }
  if (field.goals[0]) route.push(field.goals[0]);
  return { route, routeState: 'blocked' };
};

export const getNearestRouteIndex = (
  route: Array<{ x: number; z: number }>,
  position: { x: number; z: number }
): number => {
  if (route.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length; i += 1) {
    const point = route[i]!;
    const d = distance2d(point.x, point.z, position.x, position.z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
};

export const recomputeSpawnerRoutes = (world: GameWorld): void => {
  const goals = getCastleEntryGoals();
  const field = buildFlowField(world.structures, goals);
  const routesBySpawner = new Map<string, Array<{ x: number; z: number }>>();
  for (const spawner of world.wave.spawners) {
    const side = toSideDef(spawner.spawnerId);
    const entry = getSpawnerEntryPoint(side);
    const route = buildSpawnerRoute(field, entry);
    spawner.route = route.route;
    spawner.routeState = route.routeState;
    routesBySpawner.set(spawner.spawnerId, route.route);
  }

  for (const mob of world.mobs.values()) {
    const route = routesBySpawner.get(mob.spawnerId) ?? [];
    const nearest = getNearestRouteIndex(route, mob.position);
    mob.routeIndex = Math.max(
      0,
      Math.min(nearest, Math.max(0, route.length - 1))
    );
  }
};

export const hasAtLeastOneReachableSpawner = (world: GameWorld): boolean => {
  if (world.wave.spawners.length === 0) return true;
  return world.wave.spawners.some(
    (spawner) => spawner.routeState === 'reachable'
  );
};

const collectAutoUnblockCandidates = (
  structures: Map<string, StructureState>
): StructureState[] =>
  [...structures.values()]
    .filter((structure) => STRUCTURE_DEFS[structure.type].blocksPath)
    .sort((a, b) => {
      const ownerPriorityA = a.ownerId === 'Map' ? 1 : 0;
      const ownerPriorityB = b.ownerId === 'Map' ? 1 : 0;
      if (ownerPriorityA !== ownerPriorityB)
        return ownerPriorityA - ownerPriorityB;
      return b.createdAtMs - a.createdAtMs;
    });

export const autoUnblockFullyBlockedPaths = (world: GameWorld): string[] => {
  if (world.wave.spawners.length === 0) return [];
  if (hasAtLeastOneReachableSpawner(world)) return [];

  const removedIds: string[] = [];
  const candidates = collectAutoUnblockCandidates(world.structures);
  for (const candidate of candidates) {
    if (removedIds.length >= MAX_STRUCTURE_DELTA_REMOVES) break;
    if (!world.structures.has(candidate.structureId)) continue;
    world.structures.delete(candidate.structureId);
    removedIds.push(candidate.structureId);
    recomputeSpawnerRoutes(world);
    if (hasAtLeastOneReachableSpawner(world)) break;
  }
  return removedIds;
};

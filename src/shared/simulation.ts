import type {
  CommandEnvelope,
  EntityDelta,
  GameDelta,
  MobPool,
  MobSlices,
  StructureDelta,
  WaveDelta,
} from './game-protocol';
import type {
  MobState,
  StructureState,
  WorldMeta,
  WorldState,
} from './game-state';
import { getStructureFootprint, STRUCTURE_DEFS } from './content/structures';
import { getTowerDef, getTowerDps } from './content/towers';
import { MOB_DEFS, DEFAULT_MOB_TYPE } from './content/mobs';
import {
  getWaveMobCount,
  getWaveSpawnRate,
  WAVE_MIN_SPAWNERS,
  WAVE_MAX_SPAWNERS,
} from './content/waves';
import { WORLD_BOUNDS, GRID_SIZE, CASTLE_HALF_EXTENT } from './content/world';
import {
  clamp,
  distance2d,
  hashString01,
  normalize2d,
  shuffle,
  weightedSplit,
} from './utils';

// Simulation constants
export const SIM_TICK_MS = 100;
export const MAX_MOBS = 10_000;
export const MAX_DELTA_PLAYERS = 200;
export const MAX_DELTA_MOBS = 200;
export const MAX_STRUCTURE_DELTA_UPSERTS = 100;
export const MAX_STRUCTURE_DELTA_REMOVES = 100;
export const ENABLE_FULL_MOB_DELTAS = true;
export const FULL_MOB_DELTA_INTERVAL_MS = 5_000;
export const FULL_MOB_DELTA_ON_STRUCTURE_CHANGE_WINDOW_MS = 1_000;
export const FULL_MOB_SNAPSHOT_CHUNK_SIZE = 600;
export const DELTA_NEAR_MOBS_BUDGET = 220;
export const DELTA_CASTLE_THREAT_MOBS_BUDGET = 160;
export const DELTA_RECENTLY_DAMAGED_MOBS_BUDGET = 120;
export const ENABLE_INTEREST_MANAGED_MOB_DELTAS = true;
export const ENABLE_SERVER_TOWER_SPATIAL_DAMAGE = true;
export const AUTO_WAVE_INITIAL_DELAY_MS = 5_000;
export const AUTO_WAVE_INTERMISSION_MS = 10_000;

const SPAWNER_ENTRY_INSET_CELLS = 3;
const STAGING_ISLAND_DISTANCE = 14;
const CASTLE_CAPTURE_RADIUS = 2;
const CASTLE_ROUTE_HALF_WIDTH_CELLS = 1;
const MOB_ROUTE_REACH_RADIUS = 0.65;
const MOB_ROUTE_LATERAL_SPREAD = 0.9;
const MOB_STUCK_TIMEOUT_MS = 15_000;
const MOB_STUCK_PROGRESS_EPSILON = 0.1;

const baseTower = getTowerDef('base');
const TOWER_RANGE = baseTower.range;
const TOWER_DPS = getTowerDps(baseTower);
const TOWER_SPATIAL_CELL_SIZE = TOWER_RANGE;

const baseMob = MOB_DEFS[DEFAULT_MOB_TYPE];
const MOB_SPEED_UNITS_PER_SECOND = baseMob.speed;
const FULL_MOB_DELTA_INTERVAL_TICKS = Math.max(
  1,
  Math.round(FULL_MOB_DELTA_INTERVAL_MS / SIM_TICK_MS)
);
const FULL_MOB_AFTER_STRUCTURE_CHANGE_TICKS = Math.max(
  1,
  Math.round(FULL_MOB_DELTA_ON_STRUCTURE_CHANGE_WINDOW_MS / SIM_TICK_MS)
);

export type SimulationPerfStats = {
  mobsSimulated: number;
  towersSimulated: number;
  towerMobChecks: number;
  waveSpawnedMobs: number;
  elapsedMs: number;
};

type SpatialIndex<T> = {
  readonly cellSize: number;
  readonly rows: Map<number, Map<number, T[]>>;
};

const createSpatialIndex = <T>(cellSize: number): SpatialIndex<T> => ({
  cellSize,
  rows: new Map(),
});

const spatialCell = (value: number, cellSize: number): number =>
  Math.floor(value / cellSize);

const spatialInsert = <T>(
  index: SpatialIndex<T>,
  x: number,
  z: number,
  item: T
): void => {
  const gx = spatialCell(x, index.cellSize);
  const gz = spatialCell(z, index.cellSize);
  let row = index.rows.get(gx);
  if (!row) {
    row = new Map();
    index.rows.set(gx, row);
  }
  const cell = row.get(gz);
  if (cell) {
    cell.push(item);
    return;
  }
  row.set(gz, [item]);
};

const spatialQueryInto = <T>(
  index: SpatialIndex<T>,
  x: number,
  z: number,
  radius: number,
  out: T[]
): T[] => {
  out.length = 0;
  const minGx = spatialCell(x - radius, index.cellSize);
  const maxGx = spatialCell(x + radius, index.cellSize);
  const minGz = spatialCell(z - radius, index.cellSize);
  const maxGz = spatialCell(z + radius, index.cellSize);
  for (let gx = minGx; gx <= maxGx; gx += 1) {
    const row = index.rows.get(gx);
    if (!row) continue;
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      const cell = row.get(gz);
      if (!cell) continue;
      for (const item of cell) out.push(item);
    }
  }
  return out;
};

type SideId = 'north' | 'east' | 'south' | 'west';
type SideDef = {
  id: SideId;
  door: { x: number; z: number };
  outward: { x: number; z: number };
  tangent: { x: number; z: number };
};

type FlowField = {
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

const SIDE_DEFS: SideDef[] = [
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

const toSideDef = (spawnerId: string): SideDef => {
  for (const side of SIDE_DEFS) {
    if (spawnerId.endsWith(`-${side.id}`)) return side;
  }
  return SIDE_DEFS[0]!;
};

const getSpawnerEntryPoint = (side: SideDef): { x: number; z: number } => {
  const inset = GRID_SIZE * SPAWNER_ENTRY_INSET_CELLS;
  const x = Math.round(side.door.x - side.outward.x * inset);
  const z = Math.round(side.door.z - side.outward.z * inset);
  return {
    x: clamp(x, -WORLD_BOUNDS + inset, WORLD_BOUNDS - inset),
    z: clamp(z, -WORLD_BOUNDS + inset, WORLD_BOUNDS - inset),
  };
};

const getSpawnerSpawnPoint = (side: SideDef): { x: number; z: number } => {
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

const getCastleEntryGoals = (): Array<{ x: number; z: number }> => {
  const approachOffset = GRID_SIZE * 3;
  return [
    { x: 0, z: CASTLE_HALF_EXTENT + approachOffset },
    { x: 0, z: -CASTLE_HALF_EXTENT - approachOffset },
    { x: CASTLE_HALF_EXTENT + approachOffset, z: 0 },
    { x: -CASTLE_HALF_EXTENT - approachOffset, z: 0 },
  ];
};

const pickSpawnerSidesForWave = (wave: number): SideDef[] => {
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

const buildFlowField = (
  structures: Record<string, StructureState>,
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

  for (const structure of Object.values(structures)) {
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

const getNearestGoalDistance = (
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

const buildSpawnerRoute = (
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

const getNearestRouteIndex = (
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

const makeMob = (meta: WorldMeta, spawnerId: string): MobState => {
  const side = toSideDef(spawnerId);
  const spawn = getSpawnerSpawnPoint(side);
  const seq = meta.nextMobSeq;
  meta.nextMobSeq = seq + 1;
  return {
    mobId: String(seq),
    position: spawn,
    velocity: { x: 0, z: 0 },
    hp: baseMob.hp,
    maxHp: baseMob.maxHp,
    spawnerId,
    routeIndex: 0,
    stuckMs: 0,
    lastProgressDistanceToGoal: Number.POSITIVE_INFINITY,
  };
};

const recomputeSpawnerRoutes = (world: WorldState): void => {
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

  for (const mob of Object.values(world.mobs)) {
    const route = routesBySpawner.get(mob.spawnerId) ?? [];
    const nearest = getNearestRouteIndex(route, mob.position);
    mob.routeIndex = Math.max(
      0,
      Math.min(nearest, Math.max(0, route.length - 1))
    );
  }
};

const hasAtLeastOneReachableSpawner = (world: WorldState): boolean => {
  if (world.wave.spawners.length === 0) return true;
  return world.wave.spawners.some(
    (spawner) => spawner.routeState === 'reachable'
  );
};

const collectAutoUnblockCandidates = (
  structures: Record<string, StructureState>
): StructureState[] =>
  Object.values(structures)
    .filter((structure) => STRUCTURE_DEFS[structure.type].blocksPath)
    .sort((a, b) => {
      const ownerPriorityA = a.ownerId === 'Map' ? 1 : 0;
      const ownerPriorityB = b.ownerId === 'Map' ? 1 : 0;
      if (ownerPriorityA !== ownerPriorityB)
        return ownerPriorityA - ownerPriorityB;
      return b.createdAtMs - a.createdAtMs;
    });

const autoUnblockFullyBlockedPaths = (world: WorldState): string[] => {
  if (world.wave.spawners.length === 0) return [];
  if (hasAtLeastOneReachableSpawner(world)) return [];

  const removedIds: string[] = [];
  const candidates = collectAutoUnblockCandidates(world.structures);
  for (const candidate of candidates) {
    if (removedIds.length >= MAX_STRUCTURE_DELTA_REMOVES) break;
    if (!world.structures[candidate.structureId]) continue;
    delete world.structures[candidate.structureId];
    removedIds.push(candidate.structureId);
    recomputeSpawnerRoutes(world);
    if (hasAtLeastOneReachableSpawner(world)) break;
  }
  return removedIds;
};

const prepareNextWaveSpawners = (
  world: WorldState
): WorldState['wave']['spawners'] => {
  const nextWave = world.wave.wave + 1;
  const totalMobCount = getWaveMobCount(nextWave);
  const sides = pickSpawnerSidesForWave(nextWave);
  const split = weightedSplit(totalMobCount, sides.length, Math.random);
  return split.map((count, index) => {
    const side = sides[index]!;
    return {
      spawnerId: `wave-${nextWave}-${side.id}`,
      totalCount: count,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond:
        getWaveSpawnRate(nextWave) * (0.9 + Math.random() * 0.4),
      spawnAccumulator: 0,
      gateOpen: false,
      routeState: 'blocked',
      route: [],
    };
  });
};

const prepareUpcomingWave = (world: WorldState): void => {
  world.wave.spawners = prepareNextWaveSpawners(world);
  recomputeSpawnerRoutes(world);
};

const activateWave = (world: WorldState): boolean => {
  if (world.wave.active) return false;
  if (world.wave.spawners.length === 0) {
    prepareUpcomingWave(world);
  }
  world.wave.wave += 1;
  world.wave.active = true;
  for (const spawner of world.wave.spawners) {
    spawner.spawnedCount = 0;
    spawner.aliveCount = 0;
    spawner.spawnAccumulator = 0;
    spawner.gateOpen = false;
  }
  world.wave.nextWaveAtMs = 0;
  return true;
};

const ensureInitialWaveSchedule = (world: WorldState): boolean => {
  if (world.wave.wave > 0 || world.wave.active || world.wave.nextWaveAtMs > 0) {
    return false;
  }
  if (world.wave.spawners.length === 0) {
    prepareUpcomingWave(world);
  }
  world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INITIAL_DELAY_MS;
  return true;
};

const maybeActivateScheduledWave = (world: WorldState): boolean => {
  if (world.wave.active || world.wave.nextWaveAtMs <= 0) return false;
  if (world.meta.lastTickMs < world.wave.nextWaveAtMs) return false;
  return activateWave(world);
};

const updateMobs = (
  world: WorldState,
  deltaSeconds: number,
  perf: SimulationPerfStats
): { upserts: MobState[]; despawnedIds: string[] } => {
  const upserts: MobState[] = [];
  const despawnedIds: string[] = [];

  const towerList = Object.values(world.structures).filter(
    (structure) => structure.type === 'tower'
  );
  perf.towersSimulated += towerList.length;
  const towerSpatialIndex = createSpatialIndex<StructureState>(
    TOWER_SPATIAL_CELL_SIZE
  );
  if (ENABLE_SERVER_TOWER_SPATIAL_DAMAGE) {
    for (const tower of towerList) {
      spatialInsert(towerSpatialIndex, tower.center.x, tower.center.z, tower);
    }
  }
  const towerCandidateScratch: StructureState[] = [];
  const spawnerById = new Map(
    world.wave.spawners.map((spawner) => [spawner.spawnerId, spawner])
  );
  const goals = getCastleEntryGoals();
  const mobValues = Object.values(world.mobs);
  perf.mobsSimulated += mobValues.length;
  for (const mob of mobValues) {
    const side = toSideDef(mob.spawnerId);
    const entry = getSpawnerEntryPoint(side);
    const spawner = spawnerById.get(mob.spawnerId);
    const route = spawner?.route ?? [];
    const canUseRoute = spawner?.routeState === 'reachable' && route.length > 0;
    const isInMap =
      Math.abs(mob.position.x) <= WORLD_BOUNDS &&
      Math.abs(mob.position.z) <= WORLD_BOUNDS;
    let target = entry;
    const laneOffset =
      (hashString01(`${mob.mobId}:lane`) * 2 - 1) * MOB_ROUTE_LATERAL_SPREAD;
    if (isInMap && canUseRoute) {
      const maxRouteIndex = Math.max(0, route.length - 1);
      mob.routeIndex = Math.max(0, Math.min(mob.routeIndex, maxRouteIndex));
      const currentTarget = route[mob.routeIndex] ?? route[maxRouteIndex]!;
      if (
        distance2d(
          mob.position.x,
          mob.position.z,
          currentTarget.x,
          currentTarget.z
        ) <=
        MOB_ROUTE_REACH_RADIUS + Math.abs(laneOffset) * 0.9
      ) {
        mob.routeIndex = Math.min(maxRouteIndex, mob.routeIndex + 1);
      }
      const routedTarget = route[mob.routeIndex] ?? route[maxRouteIndex]!;
      const nextRouteIdx = Math.min(maxRouteIndex, mob.routeIndex + 1);
      const prevRouteIdx = Math.max(0, mob.routeIndex - 1);
      const nextPoint = route[nextRouteIdx] ?? routedTarget;
      const prevPoint = route[prevRouteIdx] ?? routedTarget;
      const hasForwardSegment =
        nextPoint.x !== routedTarget.x || nextPoint.z !== routedTarget.z;
      const forward = normalize2d(
        hasForwardSegment
          ? nextPoint.x - routedTarget.x
          : routedTarget.x - prevPoint.x,
        hasForwardSegment
          ? nextPoint.z - routedTarget.z
          : routedTarget.z - prevPoint.z
      );
      const lateralScale = mob.routeIndex >= maxRouteIndex - 2 ? 0.45 : 1;
      target = {
        x: routedTarget.x - forward.z * laneOffset * lateralScale,
        z: routedTarget.z + forward.x * laneOffset * lateralScale,
      };
    } else if (isInMap && !canUseRoute) {
      // Keep blocked-route mobs staged near their side entry.
      target = entry;
    }

    const moveDir = normalize2d(
      target.x - mob.position.x,
      target.z - mob.position.z
    );
    const speedScale = 0.92 + hashString01(`${mob.mobId}:speed`) * 0.16;
    mob.velocity.x = moveDir.x * MOB_SPEED_UNITS_PER_SECOND * speedScale;
    mob.velocity.z = moveDir.z * MOB_SPEED_UNITS_PER_SECOND * speedScale;
    mob.position.x += mob.velocity.x * deltaSeconds;
    mob.position.z += mob.velocity.z * deltaSeconds;

    if (ENABLE_SERVER_TOWER_SPATIAL_DAMAGE) {
      const nearbyTowers = spatialQueryInto(
        towerSpatialIndex,
        mob.position.x,
        mob.position.z,
        TOWER_RANGE,
        towerCandidateScratch
      );
      for (const tower of nearbyTowers) {
        perf.towerMobChecks += 1;
        if (
          distance2d(
            tower.center.x,
            tower.center.z,
            mob.position.x,
            mob.position.z
          ) <= TOWER_RANGE
        ) {
          mob.hp -= TOWER_DPS * deltaSeconds;
        }
      }
    } else {
      for (const tower of towerList) {
        perf.towerMobChecks += 1;
        if (
          distance2d(
            tower.center.x,
            tower.center.z,
            mob.position.x,
            mob.position.z
          ) <= TOWER_RANGE
        ) {
          mob.hp -= TOWER_DPS * deltaSeconds;
        }
      }
    }

    const nearestGoalDistance = getNearestGoalDistance(
      goals,
      mob.position.x,
      mob.position.z
    );
    const previousDistance =
      mob.lastProgressDistanceToGoal ?? Number.POSITIVE_INFINITY;
    const madeProgress =
      nearestGoalDistance + MOB_STUCK_PROGRESS_EPSILON < previousDistance;
    if (madeProgress) {
      mob.stuckMs = 0;
      mob.lastProgressDistanceToGoal = nearestGoalDistance;
    } else {
      mob.stuckMs = Math.max(0, (mob.stuckMs ?? 0) + deltaSeconds * 1000);
      mob.lastProgressDistanceToGoal = Math.min(
        previousDistance,
        nearestGoalDistance
      );
    }
    const stuckTimedOut = (mob.stuckMs ?? 0) >= MOB_STUCK_TIMEOUT_MS;
    if (
      mob.hp <= 0 ||
      nearestGoalDistance <= CASTLE_CAPTURE_RADIUS ||
      stuckTimedOut
    ) {
      despawnedIds.push(mob.mobId);
      delete world.mobs[mob.mobId];
      if (spawner) {
        spawner.aliveCount = Math.max(0, spawner.aliveCount - 1);
      }
      continue;
    }
    upserts.push({ ...mob });
  }
  return { upserts, despawnedIds };
};

const updateWave = (
  world: WorldState,
  deltaSeconds: number
): { changed: boolean; spawned: number } => {
  let changed = false;
  let spawned = 0;
  if (maybeActivateScheduledWave(world)) {
    changed = true;
  }
  if (!world.wave.active) return { changed: false, spawned: 0 };
  let currentMobCount = Object.keys(world.mobs).length;
  for (const spawner of world.wave.spawners) {
    if (!spawner.gateOpen) spawner.gateOpen = true;
    spawner.spawnAccumulator += spawner.spawnRatePerSecond * deltaSeconds;
    const toSpawn = Math.floor(spawner.spawnAccumulator);
    if (toSpawn <= 0) continue;
    const roomLeft = Math.max(0, MAX_MOBS - currentMobCount);
    const spawnCount = Math.min(
      roomLeft,
      toSpawn,
      spawner.totalCount - spawner.spawnedCount
    );
    for (let i = 0; i < spawnCount; i += 1) {
      const mob = makeMob(world.meta, spawner.spawnerId);
      world.mobs[mob.mobId] = mob;
      spawner.spawnedCount += 1;
      spawner.aliveCount += 1;
      spawner.spawnAccumulator -= 1;
      spawned += 1;
      currentMobCount += 1;
      changed = true;
    }
  }

  const allSpawned = world.wave.spawners.every(
    (spawner) => spawner.spawnedCount >= spawner.totalCount
  );
  const aliveMobs = currentMobCount;
  if (allSpawned && aliveMobs === 0) {
    world.wave.active = false;
    prepareUpcomingWave(world);
    world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INTERMISSION_MS;
    changed = true;
  }
  return { changed, spawned };
};

type CommandApplyResult = {
  structureUpserts: StructureState[];
  structureRemoves: string[];
  waveChanged: boolean;
  movedPlayers: EntityDelta['players'];
};

const applyCommands = (
  world: WorldState,
  commands: CommandEnvelope[],
  nowMs: number
): CommandApplyResult => {
  const structureUpserts: StructureState[] = [];
  const structureRemoves: string[] = [];
  const movedPlayers: EntityDelta['players'] = [];
  let waveChanged = false;

  for (const envelope of commands) {
    const { command } = envelope;
    if (command.type === 'moveIntent') {
      world.intents[command.playerId] = command.intent;
      const player = world.players[command.playerId];
      if (!player) continue;
      const from = { x: player.position.x, z: player.position.z };
      const nextPosition = command.clientPosition
        ? {
            x: clamp(command.clientPosition.x, -120, 120),
            z: clamp(command.clientPosition.z, -120, 120),
          }
        : command.intent.target
          ? {
              x: clamp(command.intent.target.x, -120, 120),
              z: clamp(command.intent.target.z, -120, 120),
            }
          : from;
      player.position = nextPosition;
      player.lastSeenMs = nowMs;
      movedPlayers.push({
        playerId: player.playerId,
        username: player.username,
        interpolation: {
          from,
          to: nextPosition,
          t0: nowMs - SIM_TICK_MS,
          t1: nowMs,
        },
      });
      continue;
    }
    if (command.type === 'buildStructure') {
      const def = STRUCTURE_DEFS[command.structure.type];
      const structure: StructureState = {
        structureId: command.structure.structureId,
        ownerId: command.playerId,
        type: command.structure.type,
        center: command.structure.center,
        hp: def.hp,
        maxHp: def.maxHp,
        createdAtMs: world.meta.lastTickMs,
      };
      world.structures[structure.structureId] = structure;
      structureUpserts.push(structure);
      continue;
    }
    if (command.type === 'buildStructures') {
      for (const requested of command.structures) {
        const def = STRUCTURE_DEFS[requested.type];
        const structure: StructureState = {
          structureId: requested.structureId,
          ownerId: command.playerId,
          type: requested.type,
          center: requested.center,
          hp: def.hp,
          maxHp: def.maxHp,
          createdAtMs: world.meta.lastTickMs,
        };
        world.structures[structure.structureId] = structure;
        structureUpserts.push(structure);
      }
      continue;
    }
    if (command.type === 'removeStructure') {
      delete world.structures[command.structureId];
      structureRemoves.push(command.structureId);
      continue;
    }
    if (command.type === 'startWave') {
      waveChanged = activateWave(world) || waveChanged;
      continue;
    }
  }

  return { structureUpserts, structureRemoves, waveChanged, movedPlayers };
};

const Q = 100;
const quantize = (v: number): number => Math.round(v * Q);

const nearestPlayerDistanceSq = (mob: MobState, world: WorldState): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const player of Object.values(world.players)) {
    const dx = mob.position.x - player.position.x;
    const dz = mob.position.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
};

type MobPoolBuilder = {
  poolMap: Map<string, number>;
  ids: number[];
  px: number[];
  pz: number[];
  vx: number[];
  vz: number[];
  hp: number[];
  maxHp: number[];
};

const createMobPoolBuilder = (): MobPoolBuilder => ({
  poolMap: new Map(),
  ids: [],
  px: [],
  pz: [],
  vx: [],
  vz: [],
  hp: [],
  maxHp: [],
});

const addMobToPool = (builder: MobPoolBuilder, mob: MobState): number => {
  const existing = builder.poolMap.get(mob.mobId);
  if (existing !== undefined) return existing;
  const idx = builder.ids.length;
  builder.poolMap.set(mob.mobId, idx);
  builder.ids.push(Number(mob.mobId));
  builder.px.push(quantize(mob.position.x));
  builder.pz.push(quantize(mob.position.z));
  builder.vx.push(quantize(mob.velocity.x));
  builder.vz.push(quantize(mob.velocity.z));
  builder.hp.push(mob.hp);
  builder.maxHp.push(mob.maxHp);
  return idx;
};

const buildMobPoolFromList = (
  mobs: MobState[],
  includeMaxHp: boolean
): MobPool => {
  const ids: number[] = [];
  const px: number[] = [];
  const pz: number[] = [];
  const vx: number[] = [];
  const vz: number[] = [];
  const hp: number[] = [];
  const maxHp: number[] | undefined = includeMaxHp ? [] : undefined;
  for (const mob of mobs) {
    ids.push(Number(mob.mobId));
    px.push(quantize(mob.position.x));
    pz.push(quantize(mob.position.z));
    vx.push(quantize(mob.velocity.x));
    vz.push(quantize(mob.velocity.z));
    hp.push(mob.hp);
    maxHp?.push(mob.maxHp);
  }
  return { ids, px, pz, vx, vz, hp, maxHp };
};

const buildUnifiedMobDelta = (
  allMobs: MobState[],
  world: WorldState
): { pool: MobPool; slices: MobSlices } => {
  const builder = createMobPoolBuilder();

  const pageCount = Math.max(1, Math.ceil(allMobs.length / MAX_DELTA_MOBS));
  const pageIndex = world.meta.tickSeq % pageCount;
  const pageStart = pageIndex * MAX_DELTA_MOBS;
  const baseMobs = allMobs.slice(pageStart, pageStart + MAX_DELTA_MOBS);
  const baseIndices = baseMobs.map((m) => addMobToPool(builder, m));

  let nearPlayerIndices: number[] = [];
  let castleThreatIndices: number[] = [];
  let recentlyDamagedIndices: number[] = [];

  if (ENABLE_INTEREST_MANAGED_MOB_DELTAS) {
    const nearPlayers = allMobs
      .slice()
      .sort(
        (a, b) =>
          nearestPlayerDistanceSq(a, world) - nearestPlayerDistanceSq(b, world)
      )
      .slice(0, DELTA_NEAR_MOBS_BUDGET);
    const castleThreats = allMobs
      .slice()
      .sort(
        (a, b) =>
          distance2d(a.position.x, a.position.z, 0, 0) -
          distance2d(b.position.x, b.position.z, 0, 0)
      )
      .slice(0, DELTA_CASTLE_THREAT_MOBS_BUDGET);
    const recentlyDamaged = allMobs
      .filter((mob) => mob.hp < mob.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, DELTA_RECENTLY_DAMAGED_MOBS_BUDGET);

    nearPlayerIndices = nearPlayers.map((m) => addMobToPool(builder, m));
    castleThreatIndices = castleThreats.map((m) => addMobToPool(builder, m));
    recentlyDamagedIndices = recentlyDamaged.map((m) =>
      addMobToPool(builder, m)
    );
  }

  const pool: MobPool = {
    ids: builder.ids,
    px: builder.px,
    pz: builder.pz,
    vx: builder.vx,
    vz: builder.vz,
    hp: builder.hp,
  };

  return {
    pool,
    slices: {
      base: baseIndices,
      nearPlayers: nearPlayerIndices,
      castleThreats: castleThreatIndices,
      recentlyDamaged: recentlyDamagedIndices,
    },
  };
};

export type SimulationResult = {
  world: WorldState;
  deltas: GameDelta[];
  perf: SimulationPerfStats;
};

export const runSimulation = (
  world: WorldState,
  nowMs: number,
  commands: CommandEnvelope[],
  maxSteps: number
): SimulationResult => {
  const startedAtMs = Date.now();
  const perf: SimulationPerfStats = {
    mobsSimulated: 0,
    towersSimulated: 0,
    towerMobChecks: 0,
    waveSpawnedMobs: 0,
    elapsedMs: 0,
  };
  const deltas: GameDelta[] = [];
  let waveChanged = ensureInitialWaveSchedule(world);
  let routesChanged = waveChanged;
  const commandChanges = applyCommands(world, commands, nowMs);
  const structureUpserts = commandChanges.structureUpserts.slice();
  const structureRemoves = commandChanges.structureRemoves.slice();
  waveChanged = waveChanged || commandChanges.waveChanged;
  if (world.wave.spawners.some((spawner) => spawner.route.length === 0)) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
    routesChanged = true;
  }
  const autoRemovedStructureIds = autoUnblockFullyBlockedPaths(world);
  if (autoRemovedStructureIds.length > 0) {
    for (const removedId of autoRemovedStructureIds) {
      if (!structureRemoves.includes(removedId))
        structureRemoves.push(removedId);
    }
    waveChanged = true;
    routesChanged = true;
  }
  if (structureUpserts.length > 0 || structureRemoves.length > 0) {
    world.meta.lastStructureChangeTickSeq = world.meta.tickSeq;
  }
  if (commandChanges.movedPlayers.length > 0) {
    deltas.push({
      type: 'entityDelta',
      serverTimeMs: nowMs,
      tickMs: SIM_TICK_MS,
      players: commandChanges.movedPlayers.slice(0, MAX_DELTA_PLAYERS),
      despawnedMobIds: [],
    });
  }
  if (structureUpserts.length > 0 || structureRemoves.length > 0) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
    routesChanged = true;
    world.meta.worldVersion += 1;
    const structureDelta: StructureDelta = {
      type: 'structureDelta',
      upserts: structureUpserts.slice(0, MAX_STRUCTURE_DELTA_UPSERTS),
      removes: structureRemoves.slice(0, MAX_STRUCTURE_DELTA_REMOVES),
      requiresPathRefresh: true,
    };
    deltas.push(structureDelta);
  }

  let steps = 0;
  let latestMobUpserts: MobState[] = [];
  const despawnedDuringRun = new Set<string>();
  let latestWaveDelta: WaveDelta | null = null;
  while (world.meta.lastTickMs + SIM_TICK_MS <= nowMs && steps < maxSteps) {
    world.meta.lastTickMs += SIM_TICK_MS;
    world.meta.tickSeq += 1;
    steps += 1;
    const deltaSeconds = SIM_TICK_MS / 1000;

    const waveResult = updateWave(world, deltaSeconds);
    perf.waveSpawnedMobs += waveResult.spawned;
    const mobResult = updateMobs(world, deltaSeconds, perf);
    latestMobUpserts = mobResult.upserts;
    for (const mobId of mobResult.despawnedIds) {
      despawnedDuringRun.add(mobId);
    }

    if (waveResult.changed) {
      latestWaveDelta = {
        type: 'waveDelta',
        wave: world.wave,
        routesIncluded: routesChanged,
      };
    }
  }

  if (waveChanged && !latestWaveDelta) {
    latestWaveDelta = {
      type: 'waveDelta',
      wave: world.wave,
      routesIncluded: routesChanged,
    };
  }

  if (steps > 0) {
    const simulatedWindowMs = Math.max(SIM_TICK_MS, steps * SIM_TICK_MS);
    const lastStructureChangeTickSeq =
      world.meta.lastStructureChangeTickSeq ?? 0;
    const ticksSinceStructureChange = Math.max(
      0,
      world.meta.tickSeq - lastStructureChangeTickSeq
    );
    const structureChangeBurstActive =
      lastStructureChangeTickSeq > 0 &&
      ticksSinceStructureChange <= FULL_MOB_AFTER_STRUCTURE_CHANGE_TICKS;
    const includeFullMobList =
      ENABLE_FULL_MOB_DELTAS &&
      (world.meta.tickSeq % FULL_MOB_DELTA_INTERVAL_TICKS === 0 ||
        structureChangeBurstActive);
    const despawnedIds = Array.from(despawnedDuringRun).map(Number);
    if (includeFullMobList) {
      const chunkSize = Math.max(1, FULL_MOB_SNAPSHOT_CHUNK_SIZE);
      const chunkCount = Math.max(
        1,
        Math.ceil(latestMobUpserts.length / chunkSize)
      );
      const snapshotId = world.meta.tickSeq;
      console.info('Mob snapshot payload', {
        tickSeq: world.meta.tickSeq,
        totalMobs: latestMobUpserts.length,
        chunkCount,
        chunkSize,
      });
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(latestMobUpserts.length, start + chunkSize);
        const isFinalChunk = chunkIndex === chunkCount - 1;
        const chunkMobs = latestMobUpserts.slice(start, end);
        const chunkDelta: EntityDelta = {
          type: 'entityDelta',
          serverTimeMs: world.meta.lastTickMs,
          tickMs: simulatedWindowMs,
          players: [],
          mobPool: buildMobPoolFromList(chunkMobs, true),
          fullMobList: true,
          fullMobSnapshotId: snapshotId,
          fullMobSnapshotChunkIndex: chunkIndex,
          fullMobSnapshotChunkCount: chunkCount,
          despawnedMobIds: isFinalChunk ? despawnedIds : [],
        };
        deltas.push(chunkDelta);
      }
    } else {
      const { pool, slices } = buildUnifiedMobDelta(latestMobUpserts, world);
      const entityDelta: EntityDelta = {
        type: 'entityDelta',
        serverTimeMs: world.meta.lastTickMs,
        tickMs: simulatedWindowMs,
        players: [],
        mobPool: pool,
        mobSlices: slices,
        fullMobList: false,
        despawnedMobIds: despawnedIds,
      };
      deltas.push(entityDelta);
    }
  }
  if (latestWaveDelta) {
    if (!latestWaveDelta.routesIncluded) {
      latestWaveDelta = {
        ...latestWaveDelta,
        wave: {
          ...latestWaveDelta.wave,
          spawners: latestWaveDelta.wave.spawners.map((s) => ({
            ...s,
            route: [],
          })),
        },
      };
    }
    deltas.push(latestWaveDelta);
  }

  perf.elapsedMs = Date.now() - startedAtMs;
  return { world, deltas, perf };
};

export const buildPresenceLeaveDelta = (playerId: string): GameDelta => ({
  type: 'presenceDelta',
  left: {
    playerId,
    reason: 'timeout',
  },
});

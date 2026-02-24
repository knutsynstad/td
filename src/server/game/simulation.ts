import type {
  CommandEnvelope,
  EntityDelta,
  GameDelta,
  StructureDelta,
  WaveDelta,
} from '../../shared/game-protocol';
import type {
  MobState,
  StructureState,
  WorldState,
} from '../../shared/game-state';
import {
  AUTO_WAVE_INITIAL_DELAY_MS,
  AUTO_WAVE_INTERMISSION_MS,
  MAX_DELTA_MOBS,
  MAX_DELTA_PLAYERS,
  MAX_MOBS,
  MAX_STRUCTURE_DELTA_REMOVES,
  MAX_STRUCTURE_DELTA_UPSERTS,
  MOB_SPEED_UNITS_PER_SECOND,
  SIM_TICK_MS,
  WAVE_SPAWN_BASE,
} from './config';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const distance = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(bx - ax, bz - az);

const normalize = (x: number, z: number): { x: number; z: number } => {
  const len = Math.hypot(x, z);
  if (len <= 0.0001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
};

const hashString01 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 4294967296;
};

const WORLD_BOUNDS = 64;
const GRID_SIZE = 1;
const SPAWNER_ENTRY_INSET_CELLS = 3;
const STAGING_ISLAND_DISTANCE = 14;
const CASTLE_CAPTURE_RADIUS = 2;
const CASTLE_ROUTE_HALF_WIDTH_CELLS = 1;
const CASTLE_HALF_EXTENT = 4;
const MOB_ROUTE_REACH_RADIUS = 0.65;
const MOB_ROUTE_LATERAL_SPREAD = 0.9;
const SERVER_TOWER_RANGE = 8;
const SERVER_TOWER_DPS = 16;

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
    x:
      baseX +
      side.tangent.x * lateralJitter +
      towardMapX * alongBridgeJitter,
    z:
      baseZ +
      side.tangent.z * lateralJitter +
      towardMapZ * alongBridgeJitter,
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

const shuffle = <T>(values: T[]): T[] => {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
};

const splitByWeights = (total: number, count: number): number[] => {
  if (count <= 0) return [];
  const weights = Array.from({ length: count }, () => 0.75 + Math.random());
  const sum = weights.reduce((acc, value) => acc + value, 0);
  const raw = weights.map((value) => (value / sum) * total);
  const base = raw.map((value) => Math.floor(value));
  let remainder = total - base.reduce((acc, value) => acc + value, 0);
  while (remainder > 0) {
    let bestIndex = 0;
    let bestFraction = -1;
    for (let i = 0; i < raw.length; i += 1) {
      const fraction = raw[i]! - base[i]!;
      if (fraction > bestFraction) {
        bestFraction = fraction;
        bestIndex = i;
      }
    }
    base[bestIndex] = (base[bestIndex] ?? 0) + 1;
    remainder -= 1;
  }
  return base;
};

const pickSpawnerSidesForWave = (wave: number): SideDef[] => {
  const minSpawners = 1;
  const maxSpawners = 3;
  const waveCap = Math.min(maxSpawners, minSpawners + Math.floor(wave / 3));
  const count = clamp(
    minSpawners + Math.floor(Math.random() * (waveCap - minSpawners + 1)),
    minSpawners,
    maxSpawners
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
    const cx = Math.max(0, Math.min(width - 1, Math.round((x - minWX) / GRID_SIZE)));
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
    const sx = Math.max(0, Math.min(width - 1, Math.floor((minX - minWX) / GRID_SIZE)));
    const sz = Math.max(
      0,
      Math.min(height - 1, Math.floor((minZ - minWZ) / GRID_SIZE))
    );
    const ex = Math.max(0, Math.min(width - 1, Math.ceil((maxX - minWX) / GRID_SIZE)));
    const ez = Math.max(0, Math.min(height - 1, Math.ceil((maxZ - minWZ) / GRID_SIZE)));
    for (let z = sz; z <= ez; z += 1) {
      for (let x = sx; x <= ex; x += 1) {
        passable[toIdx(x, z)] = 0;
      }
    }
  };

  // Keep castle walls blocked so routes terminate at entrances.
  markBlockedAabb(0, 0, CASTLE_HALF_EXTENT, CASTLE_HALF_EXTENT);

  for (const structure of Object.values(structures)) {
    const treeFootprint = structure.metadata?.treeFootprint ?? 2;
    const rockHalfX = (structure.metadata?.rock?.footprintX ?? 2) * 0.5;
    const rockHalfZ = (structure.metadata?.rock?.footprintZ ?? 2) * 0.5;
    const halfX =
      structure.type === 'wall'
        ? 0.6
        : structure.type === 'tower'
          ? 1
          : structure.type === 'bank'
            ? 1.4
            : structure.type === 'tree'
              ? treeFootprint * 0.5
              : structure.type === 'rock'
                ? rockHalfX
                : 1.1;
    const halfZ =
      structure.type === 'wall'
        ? 0.6
        : structure.type === 'tower'
          ? 1
          : structure.type === 'bank'
            ? 1.4
            : structure.type === 'tree'
              ? treeFootprint * 0.5
              : structure.type === 'rock'
                ? rockHalfZ
                : 1.1;
    const inflate = structure.type === 'wall' ? 0.25 : 0.4;
    markBlockedAabb(
      structure.center.x,
      structure.center.z,
      halfX + inflate,
      halfZ + inflate
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

const getNearestGoalDistance = (goals: Array<{ x: number; z: number }>, x: number, z: number) => {
  let best = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const d = distance(goal.x, goal.z, x, z);
    if (d < best) best = d;
  }
  return best;
};

const buildSpawnerRoute = (
  field: FlowField,
  start: { x: number; z: number }
): { route: Array<{ x: number; z: number }>; routeState: 'reachable' | 'blocked' } => {
  const toCellNearest = (wx: number, wz: number): [number, number] => {
    const cx = Math.max(
      0,
      Math.min(field.width - 1, Math.round((wx - field.minWX) / field.resolution))
    );
    const cz = Math.max(
      0,
      Math.min(field.height - 1, Math.round((wz - field.minWZ) / field.resolution))
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
    if (distance(last.x, last.z, nextPoint.x, nextPoint.z) > 0.25) {
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
    const d = distance(point.x, point.z, position.x, position.z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
};

const makeMob = (tickSeq: number, spawnerId: string): MobState => {
  const side = toSideDef(spawnerId);
  const spawn = getSpawnerSpawnPoint(side);
  return {
    mobId: `${spawnerId}-mob-${tickSeq}-${Math.floor(Math.random() * 10_000)}`,
    position: spawn,
    velocity: { x: 0, z: 0 },
    hp: 100,
    maxHp: 100,
    spawnerId,
    routeIndex: 0,
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
    mob.routeIndex = Math.max(0, Math.min(nearest, Math.max(0, route.length - 1)));
  }
};

const prepareNextWaveSpawners = (
  world: WorldState
): WorldState['wave']['spawners'] => {
  const nextWave = world.wave.wave + 1;
  const totalMobCount = (5 + nextWave * 2) * 8;
  const sides = pickSpawnerSidesForWave(nextWave);
  const split = splitByWeights(totalMobCount, sides.length);
  return split.map((count, index) => {
    const side = sides[index]!;
    return {
      spawnerId: `wave-${nextWave}-${side.id}`,
      totalCount: count,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond:
        (WAVE_SPAWN_BASE + nextWave * 0.2) * (0.9 + Math.random() * 0.4),
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
  deltaSeconds: number
): { upserts: MobState[]; despawnedIds: string[] } => {
  const upserts: MobState[] = [];
  const despawnedIds: string[] = [];

  const towerList = Object.values(world.structures).filter(
    (structure) => structure.type === 'tower'
  );
  const spawnerById = new Map(
    world.wave.spawners.map((spawner) => [spawner.spawnerId, spawner])
  );
  const goals = getCastleEntryGoals();
  for (const mob of Object.values(world.mobs)) {
    const side = toSideDef(mob.spawnerId);
    const entry = getSpawnerEntryPoint(side);
    const spawner = spawnerById.get(mob.spawnerId);
    const route = spawner?.route ?? [];
    const canUseRoute = route.length > 0;
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
        distance(
          mob.position.x,
          mob.position.z,
          currentTarget.x,
          currentTarget.z
        ) <= MOB_ROUTE_REACH_RADIUS + Math.abs(laneOffset) * 0.9
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
      const forward = normalize(
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
      // Fallback for invalid/blocked routes.
      const fallbackGoal = goals[0] ?? { x: 0, z: 0 };
      target = fallbackGoal;
    }

    const moveDir = normalize(
      target.x - mob.position.x,
      target.z - mob.position.z
    );
    const speedScale = 0.92 + hashString01(`${mob.mobId}:speed`) * 0.16;
    mob.velocity.x = moveDir.x * MOB_SPEED_UNITS_PER_SECOND * speedScale;
    mob.velocity.z = moveDir.z * MOB_SPEED_UNITS_PER_SECOND * speedScale;
    mob.position.x += mob.velocity.x * deltaSeconds;
    mob.position.z += mob.velocity.z * deltaSeconds;

    for (const tower of towerList) {
      if (
        distance(
          tower.center.x,
          tower.center.z,
          mob.position.x,
          mob.position.z
        ) <= SERVER_TOWER_RANGE
      ) {
        mob.hp -= SERVER_TOWER_DPS * deltaSeconds;
      }
    }

    const nearestGoalDistance = getNearestGoalDistance(
      goals,
      mob.position.x,
      mob.position.z
    );
    if (mob.hp <= 0 || nearestGoalDistance < CASTLE_CAPTURE_RADIUS) {
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

const updateWave = (world: WorldState, deltaSeconds: number): boolean => {
  let changed = false;
  if (maybeActivateScheduledWave(world)) {
    changed = true;
  }
  if (!world.wave.active) return false;
  for (const spawner of world.wave.spawners) {
    if (!spawner.gateOpen) spawner.gateOpen = true;
    spawner.spawnAccumulator += spawner.spawnRatePerSecond * deltaSeconds;
    const toSpawn = Math.floor(spawner.spawnAccumulator);
    if (toSpawn <= 0) continue;
    const roomLeft = Math.max(0, MAX_MOBS - Object.keys(world.mobs).length);
    const spawnCount = Math.min(
      roomLeft,
      toSpawn,
      spawner.totalCount - spawner.spawnedCount
    );
    for (let i = 0; i < spawnCount; i += 1) {
      const mob = makeMob(world.meta.tickSeq, spawner.spawnerId);
      world.mobs[mob.mobId] = mob;
      spawner.spawnedCount += 1;
      spawner.aliveCount += 1;
      spawner.spawnAccumulator -= 1;
      changed = true;
    }
  }

  const allSpawned = world.wave.spawners.every(
    (spawner) => spawner.spawnedCount >= spawner.totalCount
  );
  const aliveMobs = Object.keys(world.mobs).length;
  if (allSpawned && aliveMobs === 0) {
    world.wave.active = false;
    prepareUpcomingWave(world);
    world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INTERMISSION_MS;
    changed = true;
  }
  return changed;
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
      const structure: StructureState = {
        structureId: command.structure.structureId,
        ownerId: command.playerId,
        type: command.structure.type,
        center: command.structure.center,
        hp: 100,
        maxHp: 100,
        createdAtMs: world.meta.lastTickMs,
      };
      world.structures[structure.structureId] = structure;
      structureUpserts.push(structure);
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

export type SimulationResult = {
  world: WorldState;
  deltas: GameDelta[];
};

export const runSimulation = (
  world: WorldState,
  nowMs: number,
  commands: CommandEnvelope[],
  maxSteps: number
): SimulationResult => {
  const deltas: GameDelta[] = [];
  let waveChanged = ensureInitialWaveSchedule(world);
  const commandChanges = applyCommands(world, commands, nowMs);
  waveChanged = waveChanged || commandChanges.waveChanged;
  if (world.wave.spawners.some((spawner) => spawner.route.length === 0)) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
  }
  if (commandChanges.movedPlayers.length > 0) {
    deltas.push({
      type: 'entityDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      serverTimeMs: world.meta.lastTickMs,
      tickMs: SIM_TICK_MS,
      players: commandChanges.movedPlayers.slice(0, MAX_DELTA_PLAYERS),
      mobs: [],
      despawnedMobIds: [],
    });
  }
  if (
    commandChanges.structureUpserts.length > 0 ||
    commandChanges.structureRemoves.length > 0
  ) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
    const structureDelta: StructureDelta = {
      type: 'structureDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion + 1,
      upserts: commandChanges.structureUpserts.slice(
        0,
        MAX_STRUCTURE_DELTA_UPSERTS
      ),
      removes: commandChanges.structureRemoves.slice(
        0,
        MAX_STRUCTURE_DELTA_REMOVES
      ),
      requiresPathRefresh: true,
    };
    world.meta.worldVersion += 1;
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

    const waveChanged = updateWave(world, deltaSeconds);
    const mobResult = updateMobs(world, deltaSeconds);
    latestMobUpserts = mobResult.upserts;
    for (const mobId of mobResult.despawnedIds) {
      despawnedDuringRun.add(mobId);
    }

    if (waveChanged) {
      latestWaveDelta = {
        type: 'waveDelta',
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        wave: world.wave,
      };
    }
  }

  if (waveChanged && !latestWaveDelta) {
    latestWaveDelta = {
      type: 'waveDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      wave: world.wave,
    };
  }

  if (steps > 0) {
    const simulatedWindowMs = Math.max(SIM_TICK_MS, steps * SIM_TICK_MS);
    const entityDelta: EntityDelta = {
      type: 'entityDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      serverTimeMs: world.meta.lastTickMs,
      tickMs: simulatedWindowMs,
      players: [],
      mobs: latestMobUpserts.slice(0, MAX_DELTA_MOBS).map((mob) => ({
        mobId: mob.mobId,
        position: { x: mob.position.x, z: mob.position.z },
        velocity: { x: mob.velocity.x, z: mob.velocity.z },
        hp: mob.hp,
        maxHp: mob.maxHp,
      })),
      despawnedMobIds: Array.from(despawnedDuringRun),
    };
    deltas.push(entityDelta);
  }
  if (latestWaveDelta) {
    deltas.push(latestWaveDelta);
  }

  return { world, deltas };
};

export const buildPresenceLeaveDelta = (
  tickSeq: number,
  worldVersion: number,
  playerId: string
): GameDelta => ({
  type: 'presenceDelta',
  tickSeq,
  worldVersion,
  left: {
    playerId,
    reason: 'timeout',
  },
});

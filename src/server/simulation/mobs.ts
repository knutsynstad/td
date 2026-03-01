import type {
  GameWorld,
  MobState,
  StructureState,
} from '../../shared/game-state';
import { getTowerDef, getTowerDps } from '../../shared/content/towers';
import { WORLD_BOUNDS } from '../../shared/content/world';
import { distance2d, hashString01, normalize2d } from '../../shared/utils';
import { MOB_DEFS, DEFAULT_MOB_TYPE } from '../../shared/content/mobs';
import { createSpatialIndex, spatialInsert, spatialQueryInto } from './spatial';
import {
  toSideDef,
  getSpawnerEntryPoint,
  getCastleEntryGoals,
  getNearestGoalDistance,
} from './pathfinding';
import type { SimulationPerfStats } from './runSimulation';

export const ENABLE_SERVER_TOWER_SPATIAL_DAMAGE = true;

const CASTLE_CAPTURE_RADIUS = 2;
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

export const updateMobs = (
  world: GameWorld,
  deltaSeconds: number,
  perf: SimulationPerfStats
): { upserts: MobState[]; despawnedIds: string[]; castleCaptures: number } => {
  const upserts: MobState[] = [];
  const despawnedIds: string[] = [];
  let castleCaptures = 0;

  const towerList = [...world.structures.values()].filter(
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
  const mobValues = [...world.mobs.values()];
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
    const reachedCastle = nearestGoalDistance <= CASTLE_CAPTURE_RADIUS;
    if (mob.hp <= 0 || reachedCastle || stuckTimedOut) {
      if (reachedCastle) {
        castleCaptures += 1;
      }
      despawnedIds.push(mob.mobId);
      world.mobs.delete(mob.mobId);
      if (spawner) {
        spawner.aliveCount = Math.max(0, spawner.aliveCount - 1);
      }
      continue;
    }
    upserts.push({ ...mob });
  }
  return { upserts, despawnedIds, castleCaptures };
};

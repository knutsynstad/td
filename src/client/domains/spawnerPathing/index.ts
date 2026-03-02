import * as THREE from 'three';
import { snapToGrid } from '../../../shared/utils';
import { getAllBorderDoors } from '../gameplay/borderDoors';
import {
  buildCastleFlowField,
  tracePathFromSpawner,
} from '../world/pathfinding/corridorFlowField';
import { toCastleDisplayRoute } from '../world/pathfinding/castleRouteDisplay';
import type { LanePathResult } from '../world/pathfinding/laneAStar';
import type { CorridorFlowField } from '../world/pathfinding/corridorFlowField';
import type {
  StaticCollider,
  WaveSpawner,
  MobEntity,
} from '../gameplay/types/entities';
import { buildPathTilesFromPoints } from '../pathTiles';
import type { SpawnerHelpers } from '../../rendering/spawnerHelpers';
import type { SpawnContainerOverlay } from '../../rendering/overlays/spawnContainer';
import type { StagingIslandsOverlay } from '../../rendering/overlays/stagingIslands';
import { SpawnerPathOverlay } from '../../rendering/effects/spawnerPathOverlay';
import type { FlowFieldDebugOverlay } from '../../rendering/overlays/flowFieldDebug';
import { clamp } from '../world/collision';

export type SpawnerPathingContext = {
  scene: THREE.Scene;
  gridSize: number;
  worldBounds: number;
  staticColliders: StaticCollider[];
  castleCollider: StaticCollider;
  castleFrontDirection: THREE.Vector2;
  castleEntryGoalStripHalfWidthCells: number;
  castleRouteHalfWidthCells: number;
  stagingIslandSize: number;
  pathlineRefreshBudgetPerFrame: number;
  spawnerHelpers: SpawnerHelpers;
  stagingIslandsOverlay: StagingIslandsOverlay;
  spawnContainerOverlay: SpawnContainerOverlay;
  flowFieldDebugOverlay: FlowFieldDebugOverlay;
  showFlowFieldDebug: boolean | (() => boolean);
  pathTilePositions: Map<string, THREE.Vector3[]>;
  rebuildPathTileLayer: () => void;
  isServerAuthoritative: () => boolean;
};

export type SpawnerPathingResult = {
  borderDoors: THREE.Vector3[];
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  spawnerPathlineCache: Map<string, LanePathResult>;
  spawnerRouteOverlay: SpawnerPathOverlay;
  getCastleEntryGoals: () => THREE.Vector3[];
  getCastleFlowField: () => CorridorFlowField;
  invalidateCastleFlowField: () => void;
  refreshSpawnerPathline: (spawner: WaveSpawner) => void;
  enqueueSpawnerPathRefresh: (spawnerId: string) => void;
  processSpawnerPathlineQueue: (budget?: number) => void;
  refreshAllSpawnerPathlines: () => void;
  applyObstacleDelta: (
    added: StaticCollider[],
    removed?: StaticCollider[]
  ) => void;
  renderAllCardinalStagingIslands: () => void;
  clampStagedMobToSpawnerIsland: (mob: MobEntity) => void;
  toCastleDisplayPoints: (points: THREE.Vector3[]) => THREE.Vector3[];
  clearWaveOverlays: () => void;
};

export const createSpawnerPathingSystem = (
  ctx: SpawnerPathingContext,
  mobs: MobEntity[]
): SpawnerPathingResult => {
  const borderDoors = getAllBorderDoors(ctx.worldBounds);
  const activeWaveSpawners: WaveSpawner[] = [];
  const spawnerById = new Map<string, WaveSpawner>();
  const spawnerPathlineCache = new Map<string, LanePathResult>();
  let castleFlowField: CorridorFlowField | null = null;
  let isCastleFlowFieldDirty = true;
  const pendingSpawnerPathRefresh = new Set<string>();
  const pendingSpawnerPathOrder: string[] = [];

  const spawnerRouteOverlay = new SpawnerPathOverlay(ctx.scene);

  const getCastleEntryGoals = () => {
    const x = snapToGrid(ctx.castleCollider.center.x, ctx.gridSize);
    const z = snapToGrid(ctx.castleCollider.center.z, ctx.gridSize);
    const hx = ctx.castleCollider.halfSize.x;
    const hz = ctx.castleCollider.halfSize.z;
    const approachOffset = ctx.gridSize * 3;
    const useX =
      Math.abs(ctx.castleFrontDirection.x) >=
      Math.abs(ctx.castleFrontDirection.y);
    const dirX = useX ? Math.sign(ctx.castleFrontDirection.x || 1) : 0;
    const dirZ = useX ? 0 : Math.sign(ctx.castleFrontDirection.y || 1);
    const tangentX = -dirZ;
    const tangentZ = dirX;
    const goalX = x + dirX * (hx + approachOffset);
    const goalZ = z + dirZ * (hz + approachOffset);
    const goals: THREE.Vector3[] = [];
    const lateralOrder: number[] = [0];
    for (
      let lateral = 1;
      lateral <= ctx.castleEntryGoalStripHalfWidthCells;
      lateral += 1
    ) {
      lateralOrder.push(-lateral, lateral);
    }
    for (const lateral of lateralOrder) {
      const rawX = goalX + tangentX * lateral * ctx.gridSize;
      const rawZ = goalZ + tangentZ * lateral * ctx.gridSize;
      const snappedX = snapToGrid(rawX, ctx.gridSize);
      const snappedZ = snapToGrid(rawZ, ctx.gridSize);
      goals.push(new THREE.Vector3(snappedX, 0, snappedZ));
    }
    return goals;
  };

  const invalidateCastleFlowField = () => {
    isCastleFlowFieldDirty = true;
  };

  const getCastleFlowField = () => {
    if (!castleFlowField || isCastleFlowFieldDirty) {
      castleFlowField = buildCastleFlowField({
        goals: getCastleEntryGoals(),
        colliders: ctx.staticColliders,
        worldBounds: ctx.worldBounds,
        resolution: ctx.gridSize,
        corridorHalfWidthCells: ctx.castleRouteHalfWidthCells,
      });
      const show =
        typeof ctx.showFlowFieldDebug === 'function'
          ? ctx.showFlowFieldDebug()
          : ctx.showFlowFieldDebug;
      if (show) {
        ctx.flowFieldDebugOverlay.upsert(castleFlowField);
      }
      isCastleFlowFieldDirty = false;
    }
    return castleFlowField;
  };

  const toCastleDisplayPoints = (points: THREE.Vector3[]) =>
    toCastleDisplayRoute(points, {
      castleCenter: ctx.castleCollider.center,
      castleHalfSize: {
        x: ctx.castleCollider.halfSize.x,
        z: ctx.castleCollider.halfSize.z,
      },
      gridSize: ctx.gridSize,
      castleFrontDirection: ctx.castleFrontDirection,
    });

  const refreshSpawnerPathline = (spawner: WaveSpawner) => {
    const entry = ctx.spawnerHelpers.getSpawnerEntryPoint(spawner.position);
    const flow = getCastleFlowField();
    const route = tracePathFromSpawner(flow, { start: entry });
    const displayPoints = toCastleDisplayPoints(route.points);
    const stagingPreviewPoints = [
      ctx.spawnerHelpers.getStagingIslandCenter(spawner.position),
      ctx.spawnerHelpers.getSpawnerGatePoint(spawner.position),
      ctx.spawnerHelpers.getSpawnerBridgeExitPoint(spawner.position),
    ];
    const fullDisplayPoints = [...stagingPreviewPoints, ...displayPoints];
    const corridor = buildPathTilesFromPoints(
      displayPoints,
      ctx.staticColliders,
      ctx.worldBounds,
      ctx.castleRouteHalfWidthCells
    );
    const connector = buildPathTilesFromPoints(
      [
        ctx.spawnerHelpers.getSpawnerBridgeExitPoint(spawner.position),
        ctx.spawnerHelpers.getSpawnerEntryPoint(spawner.position),
      ],
      ctx.staticColliders,
      ctx.worldBounds,
      ctx.castleRouteHalfWidthCells
    );
    const routeState: LanePathResult['state'] = route.state;
    spawner.routeState = routeState;
    spawnerPathlineCache.set(spawner.id, {
      points: displayPoints,
      state: routeState,
    });
    if (routeState === 'reachable') {
      const merged = new Map<string, THREE.Vector3>();
      for (const tile of connector.tiles) {
        merged.set(`${tile.x},${tile.z}`, tile);
      }
      for (const tile of corridor.tiles) {
        merged.set(`${tile.x},${tile.z}`, tile);
      }
      ctx.pathTilePositions.set(spawner.id, Array.from(merged.values()));
    } else {
      ctx.pathTilePositions.set(spawner.id, []);
    }
    ctx.stagingIslandsOverlay.upsert(
      ctx.spawnerHelpers.getSpawnerAnchorId(spawner.position),
      ctx.spawnerHelpers.getStagingIslandCenter(spawner.position),
      ctx.spawnerHelpers.getSpawnerOutwardNormal(spawner.position),
      spawner.gateOpen,
      spawner.totalCount > 0
    );
    ctx.rebuildPathTileLayer();
    spawnerRouteOverlay.upsert(spawner.id, fullDisplayPoints, routeState);
    ctx.spawnContainerOverlay.upsert(
      spawner.id,
      ctx.spawnerHelpers.getSpawnContainerCorners(spawner.position)
    );
    for (const mob of mobs) {
      if (mob.spawnerId !== spawner.id) continue;
      mob.laneBlocked = routeState !== 'reachable';
      if (mob.staged) {
        mob.waypoints = undefined;
        mob.waypointIndex = undefined;
        mob.laneBlocked = true;
        continue;
      }
      const laneWaypoints =
        routeState === 'reachable'
          ? ctx.spawnerHelpers.buildLaneWaypointsForSpawner(
              spawner,
              displayPoints
            )
          : undefined;
      mob.waypoints = laneWaypoints;
      const startsInMap =
        Math.abs(mob.mesh.position.x) <= ctx.worldBounds &&
        Math.abs(mob.mesh.position.z) <= ctx.worldBounds;
      mob.waypointIndex = laneWaypoints
        ? ctx.spawnerHelpers.getForwardWaypointIndex(
            mob.mesh.position,
            laneWaypoints,
            startsInMap ? 2 : 0
          )
        : undefined;
    }
  };

  const enqueueSpawnerPathRefresh = (spawnerId: string) => {
    if (pendingSpawnerPathRefresh.has(spawnerId)) return;
    pendingSpawnerPathRefresh.add(spawnerId);
    pendingSpawnerPathOrder.push(spawnerId);
  };

  const processSpawnerPathlineQueue = (
    budget = ctx.pathlineRefreshBudgetPerFrame
  ) => {
    let processed = 0;
    while (processed < budget && pendingSpawnerPathOrder.length > 0) {
      const spawnerId = pendingSpawnerPathOrder.shift()!;
      pendingSpawnerPathRefresh.delete(spawnerId);
      const spawner = spawnerById.get(spawnerId);
      if (!spawner) continue;
      refreshSpawnerPathline(spawner);
      processed += 1;
    }
  };

  const refreshAllSpawnerPathlines = () => {
    if (ctx.isServerAuthoritative()) return;
    for (const spawner of activeWaveSpawners) {
      refreshSpawnerPathline(spawner);
    }
  };

  const applyObstacleDelta = (
    added: StaticCollider[],
    removed: StaticCollider[] = []
  ) => {
    if (ctx.isServerAuthoritative()) return;
    if (added.length === 0 && removed.length === 0) return;
    if (activeWaveSpawners.length === 0) return;
    const deltas = [...added, ...removed].filter(
      (collider) => collider.type !== 'castle'
    );
    if (deltas.length === 0) return;
    invalidateCastleFlowField();
    for (const spawner of activeWaveSpawners) {
      enqueueSpawnerPathRefresh(spawner.id);
    }
    processSpawnerPathlineQueue(Number.MAX_SAFE_INTEGER);
  };

  const renderAllCardinalStagingIslands = () => {
    for (const door of borderDoors) {
      ctx.stagingIslandsOverlay.upsert(
        ctx.spawnerHelpers.getSpawnerAnchorId(door),
        ctx.spawnerHelpers.getStagingIslandCenter(door),
        ctx.spawnerHelpers.getSpawnerOutwardNormal(door),
        false,
        false
      );
    }
  };

  const clearWaveOverlays = () => {
    spawnerRouteOverlay.clear();
    spawnerPathlineCache.clear();
    ctx.pathTilePositions.clear();
    ctx.rebuildPathTileLayer();
    ctx.spawnContainerOverlay.clear();
    ctx.stagingIslandsOverlay.clear();
    renderAllCardinalStagingIslands();
    pendingSpawnerPathRefresh.clear();
    pendingSpawnerPathOrder.length = 0;
  };

  const clampStagedMobToSpawnerIsland = (mob: MobEntity) => {
    if (!mob.staged || !mob.spawnerId) return;
    const spawner = spawnerById.get(mob.spawnerId);
    if (!spawner) return;
    const center = ctx.spawnerHelpers.getStagingIslandCenter(spawner.position);
    const half = ctx.stagingIslandSize * 0.5 - mob.radius - 0.25;
    mob.mesh.position.x = clamp(
      mob.mesh.position.x,
      center.x - half,
      center.x + half
    );
    mob.mesh.position.z = clamp(
      mob.mesh.position.z,
      center.z - half,
      center.z + half
    );
  };

  return {
    borderDoors,
    activeWaveSpawners,
    spawnerById,
    spawnerPathlineCache,
    spawnerRouteOverlay,
    getCastleEntryGoals,
    getCastleFlowField,
    invalidateCastleFlowField,
    refreshSpawnerPathline,
    enqueueSpawnerPathRefresh,
    processSpawnerPathlineQueue,
    refreshAllSpawnerPathlines,
    applyObstacleDelta,
    renderAllCardinalStagingIslands,
    clampStagedMobToSpawnerIsland,
    toCastleDisplayPoints,
    clearWaveOverlays,
  };
};

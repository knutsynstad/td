import * as THREE from 'three';
import { buildPathTilesFromPoints } from '../world/pathfinding/pathTiles';
import type { WaveState } from '../../../shared/game-state';
import type {
  SpawnerRouteState,
  StaticCollider,
  WaveSpawner,
} from './types/entities';
import type { LanePathResult } from '../world/pathfinding/laneAStar';

type SyncAuthoritativeWaveSpawnersOptions = {
  wave: WaveState;
  worldBounds: number;
  castleRouteHalfWidthCells: number;
  staticColliders: StaticCollider[];
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  spawnerPathlineCache: Map<string, LanePathResult>;
  pathTilePositions: Map<string, THREE.Vector3[]>;
  clearWaveOverlays: () => void;
  rebuildPathTileLayer: () => void;
  toCastleDisplayPoints: (points: THREE.Vector3[]) => THREE.Vector3[];
  getStagingIslandCenter: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerGatePoint: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerBridgeExitPoint: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerEntryPoint: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnContainerCorners: (spawnerPos: THREE.Vector3) => THREE.Vector3[];
  getSpawnerAnchorId: (spawnerPos: THREE.Vector3) => string;
  getSpawnerOutwardNormal: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  upsertSpawnerRouteOverlay: (
    spawnerId: string,
    points: THREE.Vector3[],
    routeState: SpawnerRouteState
  ) => void;
  upsertSpawnContainerOverlay: (
    spawnerId: string,
    corners: THREE.Vector3[]
  ) => void;
  upsertStagingIslandsOverlay: (
    anchorId: string,
    center: THREE.Vector3,
    outwardNormal: THREE.Vector3,
    gateOpen: boolean,
    hasMobs: boolean
  ) => void;
  beginStagingBatch: () => void;
  endStagingBatch: () => void;
};

const getDoorPositionForSpawnerId = (
  spawnerId: string,
  worldBounds: number
): THREE.Vector3 | null => {
  if (spawnerId.endsWith('-north'))
    return new THREE.Vector3(0, 0, -worldBounds);
  if (spawnerId.endsWith('-east')) return new THREE.Vector3(worldBounds, 0, 0);
  if (spawnerId.endsWith('-south')) return new THREE.Vector3(0, 0, worldBounds);
  if (spawnerId.endsWith('-west')) return new THREE.Vector3(-worldBounds, 0, 0);
  return null;
};

export const syncAuthoritativeWaveSpawners = (
  options: SyncAuthoritativeWaveSpawnersOptions
) => {
  const {
    wave,
    worldBounds,
    castleRouteHalfWidthCells,
    staticColliders,
    activeWaveSpawners,
    spawnerById,
    spawnerPathlineCache,
    pathTilePositions,
    clearWaveOverlays,
    rebuildPathTileLayer,
    toCastleDisplayPoints,
    getStagingIslandCenter,
    getSpawnerGatePoint,
    getSpawnerBridgeExitPoint,
    getSpawnerEntryPoint,
    getSpawnContainerCorners,
    getSpawnerAnchorId,
    getSpawnerOutwardNormal,
    upsertSpawnerRouteOverlay,
    upsertSpawnContainerOverlay,
    upsertStagingIslandsOverlay,
    beginStagingBatch,
    endStagingBatch,
  } = options;

  const nextSpawnerIds = new Set(wave.spawners.map((entry) => entry.spawnerId));
  let topologyChanged = nextSpawnerIds.size !== spawnerById.size;
  if (!topologyChanged) {
    for (const spawnerId of nextSpawnerIds) {
      if (!spawnerById.has(spawnerId)) {
        topologyChanged = true;
        break;
      }
    }
  }

  if (topologyChanged) {
    clearWaveOverlays();
    activeWaveSpawners.length = 0;
    spawnerById.clear();
  }

  beginStagingBatch();
  for (const entry of wave.spawners) {
    let spawner = spawnerById.get(entry.spawnerId);
    if (!spawner) {
      const position = getDoorPositionForSpawnerId(
        entry.spawnerId,
        worldBounds
      );
      if (!position) continue;
      spawner = {
        id: entry.spawnerId,
        position,
        gateOpen: entry.gateOpen,
        totalCount: entry.totalCount,
        spawnedCount: entry.spawnedCount,
        aliveCount: entry.aliveCount,
        spawnRatePerSecond: entry.spawnRatePerSecond,
        spawnAccumulator: entry.spawnAccumulator,
        routeState: 'reachable',
      };
      activeWaveSpawners.push(spawner);
      spawnerById.set(spawner.id, spawner);
    }

    spawner.gateOpen = entry.gateOpen;
    spawner.totalCount = entry.totalCount;
    spawner.spawnedCount = entry.spawnedCount;
    spawner.aliveCount = entry.aliveCount;
    spawner.spawnRatePerSecond = entry.spawnRatePerSecond;
    spawner.spawnAccumulator = entry.spawnAccumulator;

    const hasRouteData = entry.route.length > 0;
    if (hasRouteData || topologyChanged) {
      const routePoints = entry.route.map(
        (point) => new THREE.Vector3(point.x, 0, point.z)
      );
      const displayPoints = toCastleDisplayPoints(routePoints);
      const stagingPreviewPoints = [
        getStagingIslandCenter(spawner.position),
        getSpawnerGatePoint(spawner.position),
        getSpawnerBridgeExitPoint(spawner.position),
      ];
      const fullDisplayPoints = [...stagingPreviewPoints, ...displayPoints];
      const connector = buildPathTilesFromPoints(
        [
          getSpawnerBridgeExitPoint(spawner.position),
          getSpawnerEntryPoint(spawner.position),
        ],
        staticColliders,
        worldBounds,
        castleRouteHalfWidthCells
      );
      const corridor = buildPathTilesFromPoints(
        displayPoints,
        staticColliders,
        worldBounds,
        castleRouteHalfWidthCells
      );
      spawner.routeState = entry.routeState;
      spawnerPathlineCache.set(spawner.id, {
        points: displayPoints,
        state: entry.routeState,
      });
      if (entry.routeState === 'reachable') {
        const merged = new Map<string, THREE.Vector3>();
        for (const tile of connector.tiles) {
          merged.set(
            `${tile.x},${tile.z}`,
            new THREE.Vector3(tile.x, 0, tile.z)
          );
        }
        for (const tile of corridor.tiles) {
          merged.set(
            `${tile.x},${tile.z}`,
            new THREE.Vector3(tile.x, 0, tile.z)
          );
        }
        pathTilePositions.set(spawner.id, Array.from(merged.values()));
      } else {
        pathTilePositions.set(spawner.id, []);
      }
      upsertSpawnerRouteOverlay(
        spawner.id,
        fullDisplayPoints,
        entry.routeState
      );
      upsertSpawnContainerOverlay(
        spawner.id,
        getSpawnContainerCorners(spawner.position)
      );
    }
    upsertStagingIslandsOverlay(
      getSpawnerAnchorId(spawner.position),
      getStagingIslandCenter(spawner.position),
      getSpawnerOutwardNormal(spawner.position),
      spawner.gateOpen,
      spawner.totalCount > 0
    );
  }
  endStagingBatch();
  rebuildPathTileLayer();
};

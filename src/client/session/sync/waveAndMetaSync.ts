import { deltaProfiler } from '../../utils/deltaProfiler';
import type {
  WaveState as SharedWaveState,
  WorldState as SharedWorldState,
} from '../../../shared/game-state';
import { syncWaveSpawners } from '../../domains/gameplay/syncWaveSpawners';
import type { WaveSpawner } from '../../domains/gameplay/types/entities';
import type { LanePathResult } from '../../domains/world/pathfinding/laneAStar';
import type { SpawnerHelpers } from '../../rendering/spawnerHelpers';
import type { SpawnerPathOverlay } from '../../rendering/effects/spawnerPathOverlay';
import type { SpawnContainerOverlay } from '../../rendering/overlays/spawnContainer';
import type { StagingIslandsOverlay } from '../../rendering/overlays/stagingIslands';
import type { StaticCollider } from '../../domains/gameplay/types/entities';
import type { Vector3 } from 'three';

type GameState = {
  wave: number;
  lives: number;
  coins: number;
  nextWaveAtMs: number;
};

type WaveAndMetaSyncContext = {
  gameState: GameState;
  serverWaveActiveRef: { current: boolean };
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  staticColliders: StaticCollider[];
  spawnerPathlineCache: Map<string, LanePathResult>;
  pathTilePositions: Map<string, Vector3[]>;
  spawnerHelpers: SpawnerHelpers;
  spawnerRouteOverlay: SpawnerPathOverlay;
  spawnContainerOverlay: SpawnContainerOverlay;
  stagingIslandsOverlay: StagingIslandsOverlay;
  WORLD_BOUNDS: number;
  CASTLE_ROUTE_HALF_WIDTH_CELLS: number;
  COINS_CAP: number;
  clearWaveOverlays: () => void;
  rebuildPathTileLayer: () => void;
  toCastleDisplayPoints: (points: Vector3[]) => Vector3[];
};

export const createWaveAndMetaSync = (ctx: WaveAndMetaSyncContext) => {
  let lastWaveSyncFingerprint: string | null = null;
  let countdownServerTimeMs = 0;
  let countdownClientDateAtReceive = 0;

  const syncServerWaveSpawners = (wave: SharedWaveState): void => {
    deltaProfiler.mark('wave-sync-start');
    const fingerprint = JSON.stringify(
      [...wave.spawners].sort((a, b) => a.spawnerId.localeCompare(b.spawnerId))
    );
    if (fingerprint === lastWaveSyncFingerprint) {
      deltaProfiler.mark('wave-sync-end');
      deltaProfiler.measure('wave-sync', 'wave-sync-start', 'wave-sync-end');
      return;
    }
    lastWaveSyncFingerprint = fingerprint;

    const { spawnerHelpers } = ctx;
    syncWaveSpawners({
      wave,
      worldBounds: ctx.WORLD_BOUNDS,
      castleRouteHalfWidthCells: ctx.CASTLE_ROUTE_HALF_WIDTH_CELLS,
      staticColliders: ctx.staticColliders,
      activeWaveSpawners: ctx.activeWaveSpawners,
      spawnerById: ctx.spawnerById,
      spawnerPathlineCache: ctx.spawnerPathlineCache,
      pathTilePositions: ctx.pathTilePositions,
      clearWaveOverlays: () => {
        lastWaveSyncFingerprint = null;
        ctx.clearWaveOverlays();
      },
      rebuildPathTileLayer: ctx.rebuildPathTileLayer,
      toCastleDisplayPoints: ctx.toCastleDisplayPoints,
      getStagingIslandCenter: spawnerHelpers.getStagingIslandCenter,
      getSpawnerGatePoint: spawnerHelpers.getSpawnerGatePoint,
      getSpawnerBridgeExitPoint: spawnerHelpers.getSpawnerBridgeExitPoint,
      getSpawnerEntryPoint: spawnerHelpers.getSpawnerEntryPoint,
      getSpawnContainerCorners: spawnerHelpers.getSpawnContainerCorners,
      getSpawnerAnchorId: spawnerHelpers.getSpawnerAnchorId,
      getSpawnerOutwardNormal: spawnerHelpers.getSpawnerOutwardNormal,
      upsertSpawnerRouteOverlay: (spawnerId, points, routeState) => {
        ctx.spawnerRouteOverlay.upsert(spawnerId, points, routeState);
      },
      upsertSpawnContainerOverlay: (spawnerId, corners) => {
        ctx.spawnContainerOverlay.upsert(spawnerId, corners);
      },
      upsertStagingIslandsOverlay: (
        anchorId,
        center,
        outwardNormal,
        gateOpen,
        hasMobs
      ) => {
        ctx.stagingIslandsOverlay.upsert(
          anchorId,
          center,
          outwardNormal,
          gateOpen,
          hasMobs
        );
      },
      beginStagingBatch: () => ctx.stagingIslandsOverlay.beginBatch(),
      endStagingBatch: () => ctx.stagingIslandsOverlay.endBatch(),
    });
    deltaProfiler.mark('wave-sync-end');
    deltaProfiler.measure('wave-sync', 'wave-sync-start', 'wave-sync-end');
  };

  const syncServerMeta = (
    wave: SharedWaveState,
    world: SharedWorldState['meta']
  ): void => {
    ctx.gameState.wave = wave.wave;
    ctx.gameState.lives = world.lives;
    ctx.gameState.coins = Math.max(0, Math.min(ctx.COINS_CAP, world.coins));
    ctx.serverWaveActiveRef.current = wave.active;
    ctx.gameState.nextWaveAtMs = wave.nextWaveAtMs > 0 ? wave.nextWaveAtMs : 0;
    countdownServerTimeMs = world.lastTickMs;
    countdownClientDateAtReceive = Date.now();
    syncServerWaveSpawners(wave);
  };

  const updateCountdownFromDelta = (
    serverTimeMs: number,
    nextWaveAtMs: number
  ): void => {
    const newRemaining = nextWaveAtMs - serverTimeMs;
    const shouldUpdate =
      countdownClientDateAtReceive === 0 ||
      newRemaining <=
        nextWaveAtMs -
          (countdownServerTimeMs +
            (Date.now() - countdownClientDateAtReceive));
    if (shouldUpdate) {
      countdownServerTimeMs = serverTimeMs;
      countdownClientDateAtReceive = Date.now();
    }
  };

  const getCountdownMsRemaining = (
    nextWaveAtMs: number,
    toPerfTime: (serverEpochMs: number) => number
  ): number => {
    if (nextWaveAtMs <= 0) return 0;
    if (countdownClientDateAtReceive > 0) {
      const serverNowEstimate =
        countdownServerTimeMs + (Date.now() - countdownClientDateAtReceive);
      return Math.max(0, nextWaveAtMs - serverNowEstimate);
    }
    const nextWaveAtPerf = toPerfTime(nextWaveAtMs);
    return Math.max(0, nextWaveAtPerf - performance.now());
  };

  return {
    syncServerWaveSpawners,
    syncServerMeta,
    updateCountdownFromDelta,
    getCountdownMsRemaining,
  };
};

import type {
  EntityDelta,
  StructureDelta,
  WaveDelta,
} from '../../../shared/game-protocol';
import type {
  MobState as SharedMobState,
  StructureState as SharedStructureState,
  WaveState as SharedWaveState,
  WorldState as SharedWorldState,
} from '../../../shared/game-state';
import * as THREE from 'three';
import type {
  DestructibleCollider,
  MobEntity,
  NpcEntity,
  StaticCollider,
  WaveSpawner,
} from '../../domains/gameplay/types/entities';
import type { StructureStore } from '../../domains/gameplay/structureStore';
import type { LanePathResult } from '../../domains/world/pathfinding/laneAStar';
import type { SpawnerHelpers } from '../../rendering/spawnerHelpers';
import type { SpawnerPathOverlay } from '../../rendering/effects/spawnerPathOverlay';
import type { SpawnContainerOverlay } from '../../rendering/overlays/spawnContainer';
import type { StagingIslandsOverlay } from '../../rendering/overlays/stagingIslands';
import type { Tower } from '../../domains/gameplay/types/entities';
import type { TowerTypeId } from '../../domains/gameplay/towers/towerTypes';
import type { Vector3 } from 'three';
import { createClockSkew } from './clockSkew';
import { createRemotePlayers } from './remotePlayers';
import { createWaveAndMetaSync } from './waveAndMetaSync';
import { createStructureSync } from './structureSync';
import { createMobSync } from './mobSync';

type GameState = {
  wave: number;
  lives: number;
  coins: number;
  nextWaveAtMs: number;
};

type TreeFootprint = 1 | 2 | 3 | 4;

export type WorldStateSyncContext = {
  mobs: MobEntity[];
  npcs: NpcEntity[];
  selectedStructures: Set<StaticCollider>;
  gameState: GameState;
  serverStructureById: Map<string, DestructibleCollider>;
  serverMobsById: Map<string, MobEntity>;
  serverMobInterpolationById: Map<
    string,
    {
      from: THREE.Vector3;
      to: THREE.Vector3;
      velocity: THREE.Vector3;
      t0: number;
      t1: number;
    }
  >;
  serverMobSampleById: Map<
    string,
    {
      serverTimeMs: number;
      position: THREE.Vector3;
      velocity: THREE.Vector3;
      receivedAtPerfMs: number;
    }
  >;
  serverMobMaxHpCache: Map<string, number>;
  remotePlayersById: Map<string, NpcEntity>;
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  serverWaveActiveRef: { current: boolean };

  structureStore: StructureStore;
  scene: THREE.Scene;
  staticColliders: StaticCollider[];
  selfPlayerIdRef: { current: string | null };

  mobLogicGeometry: THREE.BufferGeometry;
  mobLogicMaterial: THREE.Material;
  MOB_HEIGHT: number;
  MOB_WIDTH: number;
  MOB_SPEED: number;

  createTowerAt: (
    center: Vector3,
    typeId: TowerTypeId,
    ownerId: string
  ) => Tower;
  applyWallVisualToMesh: (mesh: THREE.Mesh) => void;
  applyTreeVisualToMesh: (mesh: THREE.Mesh) => void;
  applyRockVisualToMesh: (mesh: THREE.Mesh) => void;
  getBuildSizeForMode: (mode: 'wall' | 'tower') => Vector3;
  snapCenterToBuildGrid: (center: Vector3, size: Vector3) => Vector3;
  getTreeBuildSizeForFootprint: (fp: TreeFootprint) => Vector3;
  clampTreeFootprint: (value: number) => TreeFootprint;
  HITBOX_LAYER: number;
  ROCK_BASE_HEIGHT: number;

  clearWaveOverlays: () => void;
  rebuildPathTileLayer: () => void;
  refreshAllSpawnerPathlines: () => void;
  toCastleDisplayPoints: (points: Vector3[]) => Vector3[];
  spawnerHelpers: SpawnerHelpers;

  spawnerRouteOverlay: SpawnerPathOverlay;
  spawnContainerOverlay: SpawnContainerOverlay;
  stagingIslandsOverlay: StagingIslandsOverlay;
  pathTilePositions: Map<string, Vector3[]>;
  spawnerPathlineCache: Map<string, LanePathResult>;

  makeNpc: (pos: Vector3, color: number, username: string) => NpcEntity;
  spawnMobDeathVisual: (mob: MobEntity) => void;
  isServerAuthoritative: () => boolean;

  getWallModelTemplate: () => THREE.Object3D | null;
  getTreeModelTemplate: () => THREE.Object3D | null;

  WORLD_BOUNDS: number;
  CASTLE_ROUTE_HALF_WIDTH_CELLS: number;
  COINS_CAP: number;
  SERVER_MOB_INTERPOLATION_BACKTIME_MS: number;
  SERVER_MOB_EXTRAPOLATION_MAX_MS: number;
  SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS: number;
  SERVER_MOB_DEAD_STALE_REMOVE_MS: number;
  SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_POST_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_HARD_STALE_REMOVE_MS: number;
};

export type WorldStateSync = {
  syncServerClockSkew: (serverEpochMs: number) => void;
  toPerfTime: (serverEpochMs: number) => number;
  upsertRemoteNpc: (
    playerId: string,
    username: string,
    position: { x: number; z: number }
  ) => void;
  removeRemoteNpc: (playerId: string) => void;
  syncServerWaveSpawners: (wave: SharedWaveState) => void;
  syncServerMeta: (
    wave: SharedWaveState,
    world: SharedWorldState['meta']
  ) => void;
  removeServerStructure: (structureId: string) => void;
  upsertServerStructure: (entry: SharedStructureState) => void;
  applyServerStructureDelta: (
    delta: StructureDelta,
    batchTickSeq?: number
  ) => void;
  applyServerStructureSync: (
    structures: Record<string, SharedStructureState>
  ) => void;
  removeServerMobById: (mobId: string) => void;
  upsertServerMobFromSnapshot: (mobState: SharedMobState) => void;
  applyServerMobDelta: (delta: EntityDelta, batchTickSeq?: number) => void;
  applyServerWaveDelta: (
    delta: WaveDelta,
    batchTickSeq?: number,
    serverTimeMs?: number
  ) => void;
  applyServerWaveTiming: (
    wave: number,
    active: boolean,
    nextWaveAtMs: number,
    serverTimeMs?: number
  ) => void;
  getCountdownMsRemaining: (nextWaveAtMs: number) => number;
  applyServerSnapshot: (
    snapshot: SharedWorldState,
    options?: { skipMobReplacement?: boolean }
  ) => void;
  updateServerMobInterpolation: (now: number) => void;
  serverWaveActiveRef: { current: boolean };
};

export const createWorldStateSync = (
  ctx: WorldStateSyncContext
): WorldStateSync => {
  let lastSnapshotTickSeq = 0;
  const clockSkew = createClockSkew();
  const remotePlayers = createRemotePlayers({
    scene: ctx.scene,
    npcs: ctx.npcs,
    remotePlayersById: ctx.remotePlayersById,
    makeNpc: ctx.makeNpc,
    selfPlayerIdRef: ctx.selfPlayerIdRef,
  });
  const waveAndMeta = createWaveAndMetaSync({
    gameState: ctx.gameState,
    serverWaveActiveRef: ctx.serverWaveActiveRef,
    activeWaveSpawners: ctx.activeWaveSpawners,
    spawnerById: ctx.spawnerById,
    staticColliders: ctx.staticColliders,
    spawnerPathlineCache: ctx.spawnerPathlineCache,
    pathTilePositions: ctx.pathTilePositions,
    spawnerHelpers: ctx.spawnerHelpers,
    spawnerRouteOverlay: ctx.spawnerRouteOverlay,
    spawnContainerOverlay: ctx.spawnContainerOverlay,
    stagingIslandsOverlay: ctx.stagingIslandsOverlay,
    WORLD_BOUNDS: ctx.WORLD_BOUNDS,
    CASTLE_ROUTE_HALF_WIDTH_CELLS: ctx.CASTLE_ROUTE_HALF_WIDTH_CELLS,
    COINS_CAP: ctx.COINS_CAP,
    clearWaveOverlays: ctx.clearWaveOverlays,
    rebuildPathTileLayer: ctx.rebuildPathTileLayer,
    toCastleDisplayPoints: ctx.toCastleDisplayPoints,
  });
  const structureSync = createStructureSync({
    selectedStructures: ctx.selectedStructures,
    serverStructureById: ctx.serverStructureById,
    structureStore: ctx.structureStore,
    scene: ctx.scene,
    createTowerAt: ctx.createTowerAt,
    applyWallVisualToMesh: ctx.applyWallVisualToMesh,
    applyTreeVisualToMesh: ctx.applyTreeVisualToMesh,
    applyRockVisualToMesh: ctx.applyRockVisualToMesh,
    getBuildSizeForMode: ctx.getBuildSizeForMode,
    snapCenterToBuildGrid: ctx.snapCenterToBuildGrid,
    getTreeBuildSizeForFootprint: ctx.getTreeBuildSizeForFootprint,
    clampTreeFootprint: ctx.clampTreeFootprint,
    HITBOX_LAYER: ctx.HITBOX_LAYER,
    ROCK_BASE_HEIGHT: ctx.ROCK_BASE_HEIGHT,
    getWallModelTemplate: ctx.getWallModelTemplate,
    getTreeModelTemplate: ctx.getTreeModelTemplate,
    refreshAllSpawnerPathlines: ctx.refreshAllSpawnerPathlines,
  });
  const mobSync = createMobSync(
    {
      mobs: ctx.mobs,
      serverMobsById: ctx.serverMobsById,
      serverMobInterpolationById: ctx.serverMobInterpolationById,
      serverMobSampleById: ctx.serverMobSampleById,
      serverMobMaxHpCache: ctx.serverMobMaxHpCache,
      serverWaveActiveRef: ctx.serverWaveActiveRef,
      mobLogicGeometry: ctx.mobLogicGeometry,
      mobLogicMaterial: ctx.mobLogicMaterial,
      MOB_HEIGHT: ctx.MOB_HEIGHT,
      MOB_WIDTH: ctx.MOB_WIDTH,
      MOB_SPEED: ctx.MOB_SPEED,
      spawnMobDeathVisual: ctx.spawnMobDeathVisual,
      SERVER_MOB_INTERPOLATION_BACKTIME_MS:
        ctx.SERVER_MOB_INTERPOLATION_BACKTIME_MS,
      SERVER_MOB_EXTRAPOLATION_MAX_MS: ctx.SERVER_MOB_EXTRAPOLATION_MAX_MS,
      SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS:
        ctx.SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS,
      SERVER_MOB_DEAD_STALE_REMOVE_MS: ctx.SERVER_MOB_DEAD_STALE_REMOVE_MS,
      SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS:
        ctx.SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS,
      SERVER_MOB_POST_WAVE_STALE_REMOVE_MS:
        ctx.SERVER_MOB_POST_WAVE_STALE_REMOVE_MS,
      SERVER_MOB_HARD_STALE_REMOVE_MS: ctx.SERVER_MOB_HARD_STALE_REMOVE_MS,
    },
    clockSkew
  );

  return {
    syncServerClockSkew: clockSkew.sync,
    toPerfTime: clockSkew.toPerfTime,
    upsertRemoteNpc: remotePlayers.upsertRemoteNpc,
    removeRemoteNpc: remotePlayers.removeRemoteNpc,
    syncServerWaveSpawners: waveAndMeta.syncServerWaveSpawners,
    syncServerMeta: waveAndMeta.syncServerMeta,
    removeServerStructure: structureSync.removeServerStructure,
    upsertServerStructure: structureSync.upsertServerStructure,
    applyServerStructureDelta: structureSync.applyServerStructureDelta,
    applyServerStructureSync: structureSync.applyServerStructureSync,
    removeServerMobById: mobSync.removeServerMobById,
    upsertServerMobFromSnapshot: mobSync.upsertServerMobFromSnapshot,
    applyServerMobDelta: mobSync.applyServerMobDelta,
    applyServerWaveDelta: (
      delta: WaveDelta,
      batchTickSeq?: number,
      serverTimeMs?: number
    ) => {
      if (
        batchTickSeq !== undefined &&
        lastSnapshotTickSeq > 0 &&
        batchTickSeq <= lastSnapshotTickSeq
      ) {
        return;
      }
      ctx.gameState.wave = delta.wave.wave;
      ctx.serverWaveActiveRef.current = delta.wave.active;
      ctx.gameState.nextWaveAtMs =
        delta.wave.nextWaveAtMs > 0 ? delta.wave.nextWaveAtMs : 0;
      if (delta.lives !== undefined) {
        ctx.gameState.lives = delta.lives;
      }
      if (typeof serverTimeMs === 'number' && delta.wave.nextWaveAtMs > 0) {
        waveAndMeta.updateCountdownFromDelta(
          serverTimeMs,
          delta.wave.nextWaveAtMs
        );
      }
      waveAndMeta.syncServerWaveSpawners(delta.wave);
    },
    applyServerWaveTiming: (
      wave: number,
      active: boolean,
      nextWaveAtMs: number,
      serverTimeMs?: number
    ) => {
      ctx.gameState.wave = wave;
      ctx.serverWaveActiveRef.current = active;
      ctx.gameState.nextWaveAtMs = nextWaveAtMs > 0 ? nextWaveAtMs : 0;
      if (typeof serverTimeMs === 'number') {
        waveAndMeta.updateCountdownFromDelta(serverTimeMs, nextWaveAtMs);
      }
    },
    getCountdownMsRemaining: (nextWaveAtMs: number) =>
      waveAndMeta.getCountdownMsRemaining(nextWaveAtMs, clockSkew.toPerfTime),
    applyServerSnapshot: (
      snapshot: SharedWorldState,
      options?: { skipMobReplacement?: boolean }
    ) => {
      lastSnapshotTickSeq = snapshot.meta.tickSeq;
      mobSync.setLastSnapshotTickSeq(snapshot.meta.tickSeq);
      waveAndMeta.syncServerMeta(snapshot.wave, snapshot.meta);

      const snapshotStructureIds = new Set(Object.keys(snapshot.structures));
      for (const structureId of Array.from(ctx.serverStructureById.keys())) {
        if (!snapshotStructureIds.has(structureId)) {
          structureSync.removeServerStructure(structureId);
        }
      }
      for (const structure of Object.values(snapshot.structures)) {
        structureSync.upsertServerStructure(structure);
      }

      if (options?.skipMobReplacement) return;

      const snapshotMobIds = new Set(Object.keys(snapshot.mobs));
      for (let i = ctx.mobs.length - 1; i >= 0; i -= 1) {
        const mob = ctx.mobs[i]!;
        const mobId = mob.mobId;
        if (mobId && snapshotMobIds.has(mobId)) continue;
        ctx.mobs.splice(i, 1);
        mobSync.returnMobToPool(mob);
        ctx.serverMobsById.delete(mobId ?? '');
      }
      mobSync.clearForSnapshot();

      for (const mob of Object.values(snapshot.mobs)) {
        mobSync.upsertServerMobFromSnapshot(mob);
        mobSync.addSnapshotMobSample(
          mob.mobId,
          snapshot.meta.lastTickMs,
          mob.position,
          mob.velocity
        );
      }
    },
    updateServerMobInterpolation: mobSync.updateServerMobInterpolation,
    serverWaveActiveRef: ctx.serverWaveActiveRef,
  };
};

import * as THREE from 'three';
import type { EntityDelta, StructureDelta, WaveDelta } from '../../shared/game-protocol';
import type {
  MobState as SharedMobState,
  StructureState as SharedStructureState,
  WaveState as SharedWaveState,
  WorldState as SharedWorldState,
} from '../../shared/game-state';
import type { DestructibleCollider, MobEntity, NpcEntity, StaticCollider, WaveSpawner } from '../domains/gameplay/types/entities';
import type { StructureStore } from '../domains/gameplay/structureStore';
import type { LanePathResult } from '../domains/world/pathfinding/laneAStar';
import type { SpawnerHelpers } from '../rendering/spawnerHelpers';
import type { SpawnerPathOverlay } from '../rendering/effects/spawnerPathOverlay';
import type { SpawnContainerOverlay } from '../rendering/overlays/spawnContainer';
import type { StagingIslandsOverlay } from '../rendering/overlays/stagingIslands';
import { syncAuthoritativeWaveSpawners } from '../domains/gameplay/authoritativeWaveSync';
import type { Tower } from '../domains/gameplay/types/entities';
import type { TowerTypeId } from '../domains/gameplay/towers/towerTypes';
import type { Vector3 } from 'three';

type RockPlacement = {
  x: number;
  z: number;
  footprintX: number;
  footprintZ: number;
  yawQuarterTurns: 0 | 1 | 2 | 3;
  modelIndex: 0 | 1;
  mirrorX: boolean;
  mirrorZ: boolean;
  verticalScale: number;
};

type TreeFootprint = 1 | 2 | 3 | 4;

type MobInterpolationEntry = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  velocity: THREE.Vector3;
  t0: number;
  t1: number;
};

type MobSampleEntry = {
  serverTimeMs: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  receivedAtPerfMs: number;
};

type GameState = {
  wave: number;
  lives: number;
  energy: number;
  nextWaveAt: number;
};

export type AuthoritativeSyncContext = {
  mobs: MobEntity[];
  npcs: NpcEntity[];
  selectedStructures: Set<StaticCollider>;
  gameState: GameState;
  serverStructureById: Map<string, DestructibleCollider>;
  serverMobsById: Map<string, MobEntity>;
  serverMobInterpolationById: Map<string, MobInterpolationEntry>;
  serverMobSampleById: Map<string, MobSampleEntry>;
  serverMobMaxHpCache: Map<string, number>;
  remotePlayersById: Map<string, NpcEntity>;
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  serverWaveActiveRef: { current: boolean };

  structureStore: StructureStore;
  scene: THREE.Scene;
  staticColliders: StaticCollider[];
  authoritativeSelfPlayerIdRef: { current: string | null };

  mobLogicGeometry: THREE.BufferGeometry;
  mobLogicMaterial: THREE.Material;
  MOB_HEIGHT: number;
  MOB_WIDTH: number;
  MOB_SPEED: number;

  createTowerAt: (center: Vector3, typeId: TowerTypeId, ownerId: string) => Tower;
  applyWallVisualToMesh: (mesh: THREE.Mesh) => void;
  applyTreeVisualToMesh: (mesh: THREE.Mesh) => void;
  applyRockVisualToMesh: (mesh: THREE.Mesh) => void;
  getBuildSizeForMode: (mode: 'wall' | 'tower') => THREE.Vector3;
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
  ENERGY_CAP: number;
  SERVER_MOB_INTERPOLATION_BACKTIME_MS: number;
  SERVER_MOB_EXTRAPOLATION_MAX_MS: number;
  SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS: number;
  SERVER_MOB_DEAD_STALE_REMOVE_MS: number;
  SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_POST_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_HARD_STALE_REMOVE_MS: number;
};

export type AuthoritativeSync = {
  syncServerClockSkew: (serverEpochMs: number) => void;
  toPerfTime: (serverEpochMs: number) => number;
  upsertRemoteNpc: (
    playerId: string,
    username: string,
    position: { x: number; z: number }
  ) => void;
  removeRemoteNpc: (playerId: string) => void;
  syncServerWaveSpawners: (
    wave: SharedWaveState,
    routesIncluded?: boolean
  ) => void;
  syncServerMeta: (
    wave: SharedWaveState,
    world: SharedWorldState['meta']
  ) => void;
  removeServerStructure: (structureId: string) => void;
  upsertServerStructure: (entry: SharedStructureState) => void;
  applyServerStructureDelta: (delta: StructureDelta) => void;
  removeServerMobById: (mobId: string) => void;
  upsertServerMobFromSnapshot: (mobState: SharedMobState) => void;
  applyServerMobDelta: (delta: EntityDelta) => void;
  applyServerWaveDelta: (delta: WaveDelta) => void;
  applyServerWaveTiming: (wave: number, active: boolean, nextWaveAtMs: number) => void;
  applyServerSnapshot: (snapshot: SharedWorldState) => void;
  updateServerMobInterpolation: (now: number) => void;
  serverWaveActiveRef: { current: boolean };
};

const DQ = 1 / 100;
const dequantize = (v: number): number => v * DQ;
const DEFAULT_MOB_MAX_HP = 100;

export const createAuthoritativeSync = (
  ctx: AuthoritativeSyncContext
): AuthoritativeSync => {
  let serverClockSkewMs = 0;
  let serverClockSkewInitialized = false;
  const serverMobSeenIdsScratch = new Set<string>();
  const serverMobRemovalScratch: string[] = [];
  const serverMobDeltaPosScratch = new THREE.Vector3();
  const serverMobDeltaVelScratch = new THREE.Vector3();
  let pendingFullMobSnapshotId: number | null = null;
  let pendingFullMobSnapshotStartMs = 0;
  const PENDING_SNAPSHOT_TIMEOUT_MS = 2_000;
  const pendingFullMobSnapshotSeenIds = new Set<string>();

  let lastMobDeltaReceivedAtMs = 0;
  const CONNECTION_ALIVE_THRESHOLD_MS = 3_000;

  const syncServerClockSkew = (serverEpochMs: number) => {
    const sample = serverEpochMs - Date.now();
    if (!serverClockSkewInitialized) {
      serverClockSkewMs = sample;
      serverClockSkewInitialized = true;
      return;
    }
    serverClockSkewMs = serverClockSkewMs * 0.9 + sample * 0.1;
  };

  const toPerfTime = (serverEpochMs: number) =>
    performance.now() + (serverEpochMs - (Date.now() + serverClockSkewMs));

  const upsertRemoteNpc = (
    playerId: string,
    username: string,
    position: { x: number; z: number }
  ) => {
    if (playerId === ctx.authoritativeSelfPlayerIdRef.current) return;
    const existing = ctx.remotePlayersById.get(playerId);
    if (existing) {
      existing.username = username;
      existing.target.set(position.x, 0, position.z);
      return;
    }
    const npc = ctx.makeNpc(
      new THREE.Vector3(position.x, 0, position.z),
      0xffc857,
      username
    );
    ctx.remotePlayersById.set(playerId, npc);
  };

  const removeRemoteNpc = (playerId: string) => {
    const npc = ctx.remotePlayersById.get(playerId);
    if (!npc) return;
    ctx.scene.remove(npc.mesh);
    const index = ctx.npcs.indexOf(npc);
    if (index >= 0) {
      ctx.npcs.splice(index, 1);
    }
    ctx.remotePlayersById.delete(playerId);
  };

  const syncServerWaveSpawners = (
    wave: SharedWaveState,
    routesIncluded = true
  ) => {
    const { spawnerHelpers } = ctx;
    syncAuthoritativeWaveSpawners({
      wave,
      routesIncluded,
      worldBounds: ctx.WORLD_BOUNDS,
      castleRouteHalfWidthCells: ctx.CASTLE_ROUTE_HALF_WIDTH_CELLS,
      staticColliders: ctx.staticColliders,
      activeWaveSpawners: ctx.activeWaveSpawners,
      spawnerById: ctx.spawnerById,
      spawnerPathlineCache: ctx.spawnerPathlineCache,
      pathTilePositions: ctx.pathTilePositions,
      clearWaveOverlays: ctx.clearWaveOverlays,
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
    });
  };

  const syncServerMeta = (
    wave: SharedWaveState,
    world: SharedWorldState['meta']
  ) => {
    ctx.gameState.wave = wave.wave;
    ctx.gameState.lives = world.lives;
    ctx.gameState.energy = Math.max(0, Math.min(ctx.ENERGY_CAP, world.energy));
    ctx.serverWaveActiveRef.current = wave.active;
    ctx.gameState.nextWaveAt =
      wave.nextWaveAtMs > 0 ? toPerfTime(wave.nextWaveAtMs) : 0;
    syncServerWaveSpawners(wave);
  };

  const removeServerStructure = (structureId: string) => {
    const collider = ctx.serverStructureById.get(structureId);
    if (!collider) return;
    ctx.selectedStructures.delete(collider);
    ctx.structureStore.removeStructureCollider(collider);
    ctx.serverStructureById.delete(structureId);
  };

  const upsertServerStructure = (entry: SharedStructureState) => {
    const existingCollider = ctx.serverStructureById.get(entry.structureId);
    const targetCenter = new THREE.Vector3(entry.center.x, 0, entry.center.z);
    if (existingCollider) {
      const state = ctx.structureStore.structureStates.get(existingCollider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
        state.mesh.position.set(
          targetCenter.x,
          state.mesh.position.y,
          targetCenter.z
        );
        existingCollider.center.set(
          targetCenter.x,
          existingCollider.center.y,
          targetCenter.z
        );
      }
      return;
    }

    const wallModelTemplate = ctx.getWallModelTemplate();
    const treeModelTemplate = ctx.getTreeModelTemplate();

    if (entry.type === 'wall') {
      const size = ctx.getBuildSizeForMode('wall');
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x8b8b8b })
      );
      mesh.position.copy(center);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
      if (wallModelTemplate) {
        ctx.applyWallVisualToMesh(mesh);
      }
      const collider = ctx.structureStore.addWallCollider(
        center,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: true,
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'tower') {
      const size = ctx.getBuildSizeForMode('tower');
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const tower = ctx.createTowerAt(center, 'base', entry.ownerId || 'Server');
      const collider = ctx.structureStore.addTowerCollider(
        center,
        half,
        tower.mesh,
        tower,
        entry.maxHp,
        {
          playerBuilt: true,
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'tree') {
      const treeFootprint = ctx.clampTreeFootprint(
        entry.metadata?.treeFootprint ?? 2
      ) as TreeFootprint;
      const size = ctx.getTreeBuildSizeForFootprint(treeFootprint);
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const hitboxMaterial = new THREE.MeshStandardMaterial({
        color: 0x4f8f46,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      (hitboxMaterial as { colorWrite?: boolean }).colorWrite = false;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        hitboxMaterial
      );
      mesh.position.copy(center);
      mesh.userData.treeFootprint = treeFootprint;
      mesh.layers.set(ctx.HITBOX_LAYER);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (treeModelTemplate) {
        ctx.applyTreeVisualToMesh(mesh);
      }
      ctx.scene.add(mesh);
      const collider = ctx.structureStore.addTreeCollider(
        center,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: entry.ownerId !== 'Map',
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'rock') {
      const rockMeta = entry.metadata?.rock;
      const placement: RockPlacement = {
        x: targetCenter.x,
        z: targetCenter.z,
        footprintX: Math.max(1, rockMeta?.footprintX ?? 1),
        footprintZ: Math.max(1, rockMeta?.footprintZ ?? 1),
        yawQuarterTurns: (rockMeta?.yawQuarterTurns ?? 0) as 0 | 1 | 2 | 3,
        modelIndex: (rockMeta?.modelIndex ?? 0) as 0 | 1,
        mirrorX: rockMeta?.mirrorX ?? false,
        mirrorZ: rockMeta?.mirrorZ ?? false,
        verticalScale: rockMeta?.verticalScale ?? 1,
      };
      const size = new THREE.Vector3(
        Math.max(1, placement.footprintX),
        ctx.ROCK_BASE_HEIGHT,
        Math.max(1, placement.footprintZ)
      );
      const half = size.clone().multiplyScalar(0.5);
      const snapped = ctx.snapCenterToBuildGrid(targetCenter, size);
      const colliderCenter = snapped.clone().setY(half.y);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x646d79 })
      );
      mesh.position.copy(colliderCenter);
      mesh.userData.rockModelIndex = placement.modelIndex;
      mesh.userData.rockYawQuarterTurns = placement.yawQuarterTurns;
      mesh.userData.rockFootprintX = placement.footprintX;
      mesh.userData.rockFootprintZ = placement.footprintZ;
      mesh.userData.rockMirrorX = placement.mirrorX;
      mesh.userData.rockMirrorZ = placement.mirrorZ;
      mesh.userData.rockVerticalScale = placement.verticalScale;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.applyRockVisualToMesh(mesh);
      ctx.scene.add(mesh);
      const collider = ctx.structureStore.addRockCollider(
        colliderCenter,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: entry.ownerId !== 'Map',
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }
  };

  const applyServerStructureDelta = (delta: StructureDelta) => {
    for (const structureId of delta.removes) {
      removeServerStructure(structureId);
    }
    for (const structure of delta.upserts) {
      upsertServerStructure(structure);
    }
    if (delta.requiresPathRefresh) {
      ctx.refreshAllSpawnerPathlines();
    }
  };

  const removeServerMobById = (mobId: string) => {
    const mob = ctx.serverMobsById.get(mobId);
    const index = mob
      ? ctx.mobs.indexOf(mob)
      : ctx.mobs.findIndex((entry) => entry.mobId === mobId);
    if (index >= 0) {
      ctx.mobs.splice(index, 1);
    }
    ctx.serverMobsById.delete(mobId);
    ctx.serverMobInterpolationById.delete(mobId);
    ctx.serverMobSampleById.delete(mobId);
    ctx.serverMobMaxHpCache.delete(mobId);
  };

  const upsertServerMobFromSnapshot = (mobState: SharedMobState) => {
    const existing = ctx.serverMobsById.get(mobState.mobId);
    if (existing) {
      existing.mesh.position.set(
        mobState.position.x,
        existing.baseY,
        mobState.position.z
      );
      existing.target.set(mobState.position.x, 0, mobState.position.z);
      existing.velocity.set(mobState.velocity.x, 0, mobState.velocity.z);
      existing.hp = mobState.hp;
      existing.maxHp = mobState.maxHp;
      return;
    }
    const mesh = new THREE.Mesh(ctx.mobLogicGeometry, ctx.mobLogicMaterial);
    mesh.position.set(
      mobState.position.x,
      ctx.MOB_HEIGHT * 0.5,
      mobState.position.z
    );
    const mob: MobEntity = {
      mesh,
      radius: ctx.MOB_WIDTH * 0.5,
      speed: ctx.MOB_SPEED,
      velocity: new THREE.Vector3(mobState.velocity.x, 0, mobState.velocity.z),
      target: new THREE.Vector3(mobState.position.x, 0, mobState.position.z),
      kind: 'mob',
      mobId: mobState.mobId,
      hp: mobState.hp,
      maxHp: mobState.maxHp,
      baseY: ctx.MOB_HEIGHT * 0.5,
      staged: false,
      siegeAttackCooldown: 0,
      unreachableTime: 0,
      berserkMode: false,
      berserkTarget: null,
      laneBlocked: false,
    };
    ctx.mobs.push(mob);
    ctx.serverMobsById.set(mobState.mobId, mob);
  };

  const applyServerMobUpdateValues = (
    mobId: string,
    posX: number,
    posZ: number,
    velX: number,
    velZ: number,
    hp: number,
    maxHp: number | undefined,
    delta: EntityDelta
  ) => {
    const resolvedMaxHp =
      maxHp ??
      ctx.serverMobMaxHpCache.get(mobId) ??
      DEFAULT_MOB_MAX_HP;
    if (maxHp !== undefined) {
      ctx.serverMobMaxHpCache.set(mobId, maxHp);
    }

    const existing = ctx.serverMobsById.get(mobId);
    if (!existing) {
      upsertServerMobFromSnapshot({
        mobId,
        position: { x: posX, z: posZ },
        velocity: { x: velX, z: velZ },
        hp,
        maxHp: resolvedMaxHp,
        spawnerId: '',
        routeIndex: 0,
      });
      ctx.serverMobSampleById.set(mobId, {
        serverTimeMs: delta.serverTimeMs,
        position: new THREE.Vector3(posX, ctx.MOB_HEIGHT * 0.5, posZ),
        velocity: new THREE.Vector3(velX, 0, velZ),
        receivedAtPerfMs: performance.now(),
      });
      return;
    }

    existing.hp = hp;
    existing.maxHp = resolvedMaxHp;
    const prev = ctx.serverMobSampleById.get(mobId);
    const currentPos = serverMobDeltaPosScratch.set(posX, existing.baseY, posZ);
    const currentVel = serverMobDeltaVelScratch.set(velX, 0, velZ);
    const hasPrev =
      !!prev &&
      Number.isFinite(prev.serverTimeMs) &&
      delta.serverTimeMs > prev.serverTimeMs;
    const fromServerMs = hasPrev
      ? prev.serverTimeMs
      : delta.serverTimeMs - Math.max(1, delta.tickMs);
    const toServerMs = delta.serverTimeMs;

    const interpolation = ctx.serverMobInterpolationById.get(mobId);
    if (interpolation) {
      if (hasPrev && prev) {
        interpolation.from.copy(prev.position);
      } else {
        interpolation.from
          .copy(currentPos)
          .addScaledVector(currentVel, -delta.tickMs / 1000);
      }
      interpolation.to.copy(currentPos);
      interpolation.velocity.copy(currentVel);
      interpolation.t0 = toPerfTime(fromServerMs);
      interpolation.t1 = toPerfTime(toServerMs);
    } else {
      ctx.serverMobInterpolationById.set(mobId, {
        from:
          hasPrev && prev
            ? prev.position.clone()
            : currentPos
                .clone()
                .addScaledVector(currentVel, -delta.tickMs / 1000),
        to: currentPos.clone(),
        velocity: currentVel.clone(),
        t0: toPerfTime(fromServerMs),
        t1: toPerfTime(toServerMs),
      });
    }

    const sample = ctx.serverMobSampleById.get(mobId);
    if (sample) {
      sample.serverTimeMs = delta.serverTimeMs;
      sample.position.copy(currentPos);
      sample.velocity.copy(currentVel);
      sample.receivedAtPerfMs = performance.now();
    } else {
      ctx.serverMobSampleById.set(mobId, {
        serverTimeMs: delta.serverTimeMs,
        position: currentPos.clone(),
        velocity: currentVel.clone(),
        receivedAtPerfMs: performance.now(),
      });
    }
  };

  const applyMobPoolEntries = (
    pool: NonNullable<EntityDelta['mobPool']>,
    indices: number[] | undefined,
    delta: EntityDelta,
    hasMaxHp: boolean
  ) => {
    const poolLen = Math.min(
      pool.ids.length,
      pool.px.length,
      pool.pz.length,
      pool.vx.length,
      pool.vz.length,
      pool.hp.length
    );
    const iter = indices ?? Array.from({ length: poolLen }, (_, i) => i);
    for (const idx of iter) {
      if (idx < 0 || idx >= poolLen) continue;
      const mobId = String(pool.ids[idx]!);
      if (serverMobSeenIdsScratch.has(mobId)) continue;
      serverMobSeenIdsScratch.add(mobId);
      applyServerMobUpdateValues(
        mobId,
        dequantize(pool.px[idx]!),
        dequantize(pool.pz[idx]!),
        dequantize(pool.vx[idx]!),
        dequantize(pool.vz[idx]!),
        pool.hp[idx]!,
        hasMaxHp && pool.maxHp ? pool.maxHp[idx] : undefined,
        delta
      );
    }
  };

  const applyServerMobDelta = (delta: EntityDelta) => {
    syncServerClockSkew(delta.serverTimeMs);
    lastMobDeltaReceivedAtMs = performance.now();
    serverMobSeenIdsScratch.clear();

    const pool = delta.mobPool;
    if (pool) {
      const isFullSnapshot = !!delta.fullMobList;
      if (isFullSnapshot) {
        applyMobPoolEntries(pool, undefined, delta, true);
      } else {
        const slices = delta.mobSlices;
        if (slices) {
          applyMobPoolEntries(pool, slices.base, delta, false);
          applyMobPoolEntries(pool, slices.nearPlayers, delta, false);
          applyMobPoolEntries(pool, slices.castleThreats, delta, false);
          applyMobPoolEntries(pool, slices.recentlyDamaged, delta, false);
        } else {
          applyMobPoolEntries(pool, undefined, delta, false);
        }
      }
    }

    if (
      pendingFullMobSnapshotId !== null &&
      performance.now() - pendingFullMobSnapshotStartMs >
        PENDING_SNAPSHOT_TIMEOUT_MS
    ) {
      pendingFullMobSnapshotId = null;
      pendingFullMobSnapshotSeenIds.clear();
    }

    if (delta.fullMobList) {
      const chunkCount = Math.max(1, delta.fullMobSnapshotChunkCount ?? 1);
      const chunkIndex = Math.max(0, delta.fullMobSnapshotChunkIndex ?? 0);
      const snapshotId = delta.fullMobSnapshotId ?? 0;
      if (chunkCount > 1) {
        const startsNewSnapshot =
          pendingFullMobSnapshotId !== snapshotId || chunkIndex === 0;
        if (startsNewSnapshot) {
          pendingFullMobSnapshotId = snapshotId;
          pendingFullMobSnapshotStartMs = performance.now();
          pendingFullMobSnapshotSeenIds.clear();
        }
        for (const mobId of serverMobSeenIdsScratch) {
          pendingFullMobSnapshotSeenIds.add(mobId);
        }
        const isFinalChunk = chunkIndex >= chunkCount - 1;
        if (isFinalChunk) {
          serverMobRemovalScratch.length = 0;
          for (const mobId of ctx.serverMobsById.keys()) {
            if (pendingFullMobSnapshotSeenIds.has(mobId)) continue;
            serverMobRemovalScratch.push(mobId);
          }
          for (const mobId of serverMobRemovalScratch) {
            removeServerMobById(mobId);
          }
          pendingFullMobSnapshotId = null;
          pendingFullMobSnapshotSeenIds.clear();
        }
      } else {
        serverMobRemovalScratch.length = 0;
        for (const mobId of ctx.serverMobsById.keys()) {
          if (serverMobSeenIdsScratch.has(mobId)) continue;
          serverMobRemovalScratch.push(mobId);
        }
        for (const mobId of serverMobRemovalScratch) {
          removeServerMobById(mobId);
        }
        pendingFullMobSnapshotId = null;
        pendingFullMobSnapshotSeenIds.clear();
      }
    } else if (pendingFullMobSnapshotId !== null) {
      for (const mobId of serverMobSeenIdsScratch) {
        pendingFullMobSnapshotSeenIds.add(mobId);
      }
    } else {
      pendingFullMobSnapshotSeenIds.clear();
    }
    for (const numId of delta.despawnedMobIds) {
      const mobId = String(numId);
      const mob = ctx.serverMobsById.get(mobId);
      if (mob) {
        ctx.spawnMobDeathVisual(mob);
      }
      removeServerMobById(mobId);
      ctx.serverMobMaxHpCache.delete(mobId);
    }
  };

  const applyServerWaveDelta = (delta: WaveDelta) => {
    ctx.gameState.wave = delta.wave.wave;
    ctx.serverWaveActiveRef.current = delta.wave.active;
    ctx.gameState.nextWaveAt =
      delta.wave.nextWaveAtMs > 0 ? toPerfTime(delta.wave.nextWaveAtMs) : 0;
    if (delta.lives !== undefined) {
      ctx.gameState.lives = delta.lives;
    }
    syncServerWaveSpawners(delta.wave, delta.routesIncluded ?? true);
  };

  const applyServerWaveTiming = (
    wave: number,
    active: boolean,
    nextWaveAtMs: number
  ) => {
    ctx.gameState.wave = wave;
    ctx.serverWaveActiveRef.current = active;
    ctx.gameState.nextWaveAt =
      nextWaveAtMs > 0 ? toPerfTime(nextWaveAtMs) : 0;
  };

  const applyServerSnapshot = (snapshot: SharedWorldState) => {
    syncServerMeta(snapshot.wave, snapshot.meta);

    const snapshotStructureIds = new Set(Object.keys(snapshot.structures));
    for (const structureId of Array.from(ctx.serverStructureById.keys())) {
      if (!snapshotStructureIds.has(structureId)) {
        removeServerStructure(structureId);
      }
    }
    for (const structure of Object.values(snapshot.structures)) {
      upsertServerStructure(structure);
    }

    const snapshotMobIds = new Set(Object.keys(snapshot.mobs));
    for (let i = ctx.mobs.length - 1; i >= 0; i -= 1) {
      const mob = ctx.mobs[i]!;
      const mobId = mob.mobId;
      if (mobId && snapshotMobIds.has(mobId)) continue;
      ctx.mobs.splice(i, 1);
    }
    ctx.serverMobsById.clear();
    ctx.serverMobInterpolationById.clear();
    ctx.serverMobSampleById.clear();
    for (const mob of Object.values(snapshot.mobs)) {
      upsertServerMobFromSnapshot(mob);
      ctx.serverMobSampleById.set(mob.mobId, {
        serverTimeMs: snapshot.meta.lastTickMs,
        position: new THREE.Vector3(
          mob.position.x,
          ctx.MOB_HEIGHT * 0.5,
          mob.position.z
        ),
        velocity: new THREE.Vector3(mob.velocity.x, 0, mob.velocity.z),
        receivedAtPerfMs: performance.now(),
      });
    }
  };

  const updateServerMobInterpolation = (now: number) => {
    const connectionAlive =
      lastMobDeltaReceivedAtMs > 0 &&
      now - lastMobDeltaReceivedAtMs < CONNECTION_ALIVE_THRESHOLD_MS;

    const staleMobIds: string[] = [];
    for (const [mobId, sample] of ctx.serverMobSampleById.entries()) {
      const mob = ctx.serverMobsById.get(mobId);
      if (!mob) {
        staleMobIds.push(mobId);
        continue;
      }
      if (!connectionAlive) continue;
      const staleMs = now - sample.receivedAtPerfMs;
      const sampleIsFinite =
        Number.isFinite(sample.position.x) &&
        Number.isFinite(sample.position.z) &&
        Number.isFinite(sample.velocity.x) &&
        Number.isFinite(sample.velocity.z);
      if (!sampleIsFinite) {
        staleMobIds.push(mobId);
        continue;
      }
      if (staleMs > ctx.SERVER_MOB_HARD_STALE_REMOVE_MS) {
        staleMobIds.push(mobId);
        continue;
      }
      if (
        (mob.hp ?? 1) <= 0 &&
        staleMs > ctx.SERVER_MOB_DEAD_STALE_REMOVE_MS
      ) {
        staleMobIds.push(mobId);
        continue;
      }
      if (
        ctx.serverWaveActiveRef.current &&
        staleMs > ctx.SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS
      ) {
        staleMobIds.push(mobId);
        continue;
      }
      if (
        !ctx.serverWaveActiveRef.current &&
        staleMs > ctx.SERVER_MOB_POST_WAVE_STALE_REMOVE_MS
      ) {
        staleMobIds.push(mobId);
      }
    }
    for (const mobId of staleMobIds) {
      removeServerMobById(mobId);
    }

    const renderNow = now - ctx.SERVER_MOB_INTERPOLATION_BACKTIME_MS;
    for (const [mobId, entry] of ctx.serverMobInterpolationById.entries()) {
      const mob = ctx.serverMobsById.get(mobId);
      if (!mob) continue;
      const duration = Math.max(1, entry.t1 - entry.t0);
      const t = THREE.MathUtils.clamp(
        (renderNow - entry.t0) / duration,
        0,
        1
      );
      mob.mesh.position.lerpVectors(entry.from, entry.to, t);
      if (renderNow > entry.t1) {
        const maxExtrapolation = connectionAlive
          ? ctx.SERVER_MOB_EXTRAPOLATION_MAX_MS
          : ctx.SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS;
        const extrapolationMs = Math.min(maxExtrapolation, renderNow - entry.t1);
        if (extrapolationMs > 0) {
          mob.mesh.position.x += entry.velocity.x * (extrapolationMs / 1000);
          mob.mesh.position.z += entry.velocity.z * (extrapolationMs / 1000);
        }
      }
      mob.target.set(entry.to.x, 0, entry.to.z);
      const vx = (entry.to.x - entry.from.x) / (duration / 1000);
      const vz = (entry.to.z - entry.from.z) / (duration / 1000);
      mob.velocity.set(
        Number.isFinite(vx) ? vx : 0,
        0,
        Number.isFinite(vz) ? vz : 0
      );
    }
  };

  return {
    syncServerClockSkew,
    toPerfTime,
    upsertRemoteNpc,
    removeRemoteNpc,
    syncServerWaveSpawners,
    syncServerMeta,
    removeServerStructure,
    upsertServerStructure,
    applyServerStructureDelta,
    removeServerMobById,
    upsertServerMobFromSnapshot,
    applyServerMobDelta,
    applyServerWaveDelta,
    applyServerWaveTiming,
    applyServerSnapshot,
    updateServerMobInterpolation,
    serverWaveActiveRef: ctx.serverWaveActiveRef,
  };
};

import * as THREE from 'three';
import { deltaProfiler } from '../../utils/deltaProfiler';
import type { EntityDelta } from '../../../shared/game-protocol';
import type { MobState as SharedMobState } from '../../../shared/game-state';
import type { MobEntity } from '../../domains/gameplay/types/entities';

const DQ = 1 / 100;
const dequantize = (v: number): number => v * DQ;
const DEFAULT_MOB_MAX_HP = 100;
const PENDING_SNAPSHOT_TIMEOUT_MS = 2_000;
const CONNECTION_ALIVE_THRESHOLD_MS = 3_000;

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

type MobSyncContext = {
  mobs: MobEntity[];
  serverMobsById: Map<string, MobEntity>;
  serverMobInterpolationById: Map<string, MobInterpolationEntry>;
  serverMobSampleById: Map<string, MobSampleEntry>;
  serverMobMaxHpCache: Map<string, number>;
  serverWaveActiveRef: { current: boolean };
  mobLogicGeometry: THREE.BufferGeometry;
  mobLogicMaterial: THREE.Material;
  MOB_HEIGHT: number;
  MOB_WIDTH: number;
  MOB_SPEED: number;
  spawnMobDeathVisual: (mob: MobEntity) => void;
  SERVER_MOB_INTERPOLATION_BACKTIME_MS: number;
  SERVER_MOB_EXTRAPOLATION_MAX_MS: number;
  SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS: number;
  SERVER_MOB_DEAD_STALE_REMOVE_MS: number;
  SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_POST_WAVE_STALE_REMOVE_MS: number;
  SERVER_MOB_HARD_STALE_REMOVE_MS: number;
};

export const createMobSync = (
  ctx: MobSyncContext,
  clockSkew: {
    sync: (serverEpochMs: number) => void;
    toPerfTime: (serverEpochMs: number) => number;
  }
) => {
  const { toPerfTime } = clockSkew;
  const serverMobSeenIdsScratch = new Set<string>();
  const serverMobRemovalScratch: string[] = [];
  const serverMobDeltaPosScratch = new THREE.Vector3();
  const serverMobDeltaVelScratch = new THREE.Vector3();
  let pendingFullMobSnapshotId: number | null = null;
  let pendingFullMobSnapshotStartMs = 0;
  const pendingFullMobSnapshotSeenIds = new Set<string>();
  const pendingFullMobSnapshotReceivedChunks = new Set<number>();
  let lastMobDeltaReceivedAtMs = 0;
  let lastSnapshotTickSeq = 0;

  const mobPool: MobEntity[] = [];
  const vector3Pool: THREE.Vector3[] = [];
  const acquireVector3 = (x: number, y: number, z: number): THREE.Vector3 =>
    (vector3Pool.pop() ?? new THREE.Vector3()).set(x, y, z);
  const releaseVector3 = (v: THREE.Vector3): void => {
    vector3Pool.push(v);
  };

  const acquireMobFromPool = (): MobEntity | null => {
    const pooled = mobPool.pop();
    if (!pooled) return null;
    pooled.staged = false;
    pooled.siegeAttackCooldown = 0;
    pooled.unreachableTime = 0;
    pooled.berserkMode = false;
    pooled.berserkTarget = null;
    pooled.laneBlocked = false;
    pooled.waypoints = undefined;
    pooled.waypointIndex = undefined;
    pooled.lastHitBy = undefined;
    pooled.lastHitDirection = undefined;
    pooled.hitFlashUntilMs = undefined;
    pooled.spawnerId = undefined;
    pooled.representedCount = undefined;
    return pooled;
  };

  const returnMobToPool = (mob: MobEntity): void => {
    mob.mobId = undefined;
    mob.mesh.position.set(0, ctx.MOB_HEIGHT * 0.5, 0);
    mob.velocity.set(0, 0, 0);
    mob.target.set(0, 0, 0);
    mob.hp = 0;
    mob.maxHp = 0;
    mobPool.push(mob);
  };

  const removeServerMobById = (mobId: string): void => {
    const mob = ctx.serverMobsById.get(mobId);
    const index = mob
      ? ctx.mobs.indexOf(mob)
      : ctx.mobs.findIndex((entry) => entry.mobId === mobId);
    if (index >= 0) {
      const removed = ctx.mobs[index];
      ctx.mobs.splice(index, 1);
      if (removed) returnMobToPool(removed);
    }
    const interpolation = ctx.serverMobInterpolationById.get(mobId);
    if (interpolation) {
      releaseVector3(interpolation.from);
      releaseVector3(interpolation.to);
      releaseVector3(interpolation.velocity);
    }
    const sample = ctx.serverMobSampleById.get(mobId);
    if (sample) {
      releaseVector3(sample.position);
      releaseVector3(sample.velocity);
    }
    ctx.serverMobsById.delete(mobId);
    ctx.serverMobInterpolationById.delete(mobId);
    ctx.serverMobSampleById.delete(mobId);
    ctx.serverMobMaxHpCache.delete(mobId);
  };

  const upsertServerMobFromSnapshot = (mobState: SharedMobState): void => {
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
    const pooled = acquireMobFromPool();
    const mesh = pooled
      ? pooled.mesh
      : new THREE.Mesh(ctx.mobLogicGeometry, ctx.mobLogicMaterial);
    mesh.position.set(
      mobState.position.x,
      ctx.MOB_HEIGHT * 0.5,
      mobState.position.z
    );
    const mob: MobEntity = pooled ?? {
      mesh,
      radius: ctx.MOB_WIDTH * 0.5,
      speed: ctx.MOB_SPEED,
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
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
    if (pooled) {
      mob.mobId = mobState.mobId;
      mob.hp = mobState.hp;
      mob.maxHp = mobState.maxHp;
      mob.velocity.set(mobState.velocity.x, 0, mobState.velocity.z);
      mob.target.set(mobState.position.x, 0, mobState.position.z);
    } else {
      mob.velocity.set(mobState.velocity.x, 0, mobState.velocity.z);
      mob.target.set(mobState.position.x, 0, mobState.position.z);
    }
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
  ): void => {
    const resolvedMaxHp =
      maxHp ?? ctx.serverMobMaxHpCache.get(mobId) ?? DEFAULT_MOB_MAX_HP;
    if (maxHp !== undefined) {
      ctx.serverMobMaxHpCache.set(mobId, maxHp);
    }

    const existing = ctx.serverMobsById.get(mobId);
    if (existing) {
      const sample = ctx.serverMobSampleById.get(mobId);
      if (sample && delta.serverTimeMs <= sample.serverTimeMs) {
        return;
      }
    }
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
        position: acquireVector3(posX, ctx.MOB_HEIGHT * 0.5, posZ),
        velocity: acquireVector3(velX, 0, velZ),
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
      const from = acquireVector3(
        hasPrev && prev ? prev.position.x : 0,
        hasPrev && prev ? prev.position.y : existing.baseY,
        hasPrev && prev ? prev.position.z : 0
      );
      if (!(hasPrev && prev)) {
        from.copy(currentPos).addScaledVector(currentVel, -delta.tickMs / 1000);
      }
      ctx.serverMobInterpolationById.set(mobId, {
        from,
        to: acquireVector3(currentPos.x, currentPos.y, currentPos.z),
        velocity: acquireVector3(currentVel.x, currentVel.y, currentVel.z),
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
        position: acquireVector3(currentPos.x, currentPos.y, currentPos.z),
        velocity: acquireVector3(currentVel.x, currentVel.y, currentVel.z),
        receivedAtPerfMs: performance.now(),
      });
    }
  };

  const applyMobPoolEntries = (
    pool: NonNullable<EntityDelta['mobPool']>,
    indices: number[] | undefined,
    delta: EntityDelta,
    hasMaxHp: boolean
  ): void => {
    const poolLen = Math.min(
      pool.ids?.length ?? 0,
      pool.px?.length ?? 0,
      pool.pz?.length ?? 0,
      pool.vx?.length ?? 0,
      pool.vz?.length ?? 0,
      pool.hp?.length ?? 0
    );
    if (poolLen === 0 && (pool.ids?.length ?? 0) > 0) {
      console.error('[MobDelta] Pool array length mismatch', {
        ids: pool.ids?.length,
        px: pool.px?.length,
        pz: pool.pz?.length,
        vx: pool.vx?.length,
        vz: pool.vz?.length,
        hp: pool.hp?.length,
      });
      return;
    }
    const iter = indices ?? Array.from({ length: poolLen }, (_, i) => i);
    for (const idx of iter) {
      if (idx < 0 || idx >= poolLen) continue;
      try {
        const mobId = String(pool.ids![idx]!);
        if (serverMobSeenIdsScratch.has(mobId)) continue;
        serverMobSeenIdsScratch.add(mobId);
        const px = dequantize(pool.px![idx]!);
        const pz = dequantize(pool.pz![idx]!);
        if (!Number.isFinite(px) || !Number.isFinite(pz)) {
          console.warn('[MobDelta] Skipping mob with invalid position', {
            mobId,
            idx,
            px,
            pz,
          });
          continue;
        }
        applyServerMobUpdateValues(
          mobId,
          px,
          pz,
          dequantize(pool.vx![idx]!),
          dequantize(pool.vz![idx]!),
          pool.hp![idx]!,
          hasMaxHp && pool.maxHp ? pool.maxHp[idx] : undefined,
          delta
        );
      } catch (err) {
        console.error('[MobDelta] Error applying mob entry', {
          idx,
          mobId: pool.ids?.[idx],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const applyServerMobDelta = (
    delta: EntityDelta,
    batchTickSeq?: number
  ): void => {
    deltaProfiler.mark('mob-delta-start');
    if (
      batchTickSeq !== undefined &&
      lastSnapshotTickSeq > 0 &&
      batchTickSeq <= lastSnapshotTickSeq
    ) {
      deltaProfiler.measure('mob-delta', 'mob-delta-start', 'mob-delta-start');
      return;
    }
    const pool = delta.mobPool;
    clockSkew.sync(delta.serverTimeMs);
    lastMobDeltaReceivedAtMs = performance.now();
    serverMobSeenIdsScratch.clear();

    for (const numId of delta.despawnedMobIds ?? []) {
      const mobId = String(numId);
      const mob = ctx.serverMobsById.get(mobId);
      if (mob) {
        ctx.spawnMobDeathVisual(mob);
      }
      removeServerMobById(mobId);
      ctx.serverMobMaxHpCache.delete(mobId);
    }

    if (pool) {
      const isFullSnapshot = !!delta.fullMobList;
      applyMobPoolEntries(pool, undefined, delta, isFullSnapshot);
    }

    if (
      pendingFullMobSnapshotId !== null &&
      performance.now() - pendingFullMobSnapshotStartMs >
        PENDING_SNAPSHOT_TIMEOUT_MS
    ) {
      pendingFullMobSnapshotId = null;
      pendingFullMobSnapshotSeenIds.clear();
      pendingFullMobSnapshotReceivedChunks.clear();
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
          pendingFullMobSnapshotReceivedChunks.clear();
        }
        for (const mobId of serverMobSeenIdsScratch) {
          pendingFullMobSnapshotSeenIds.add(mobId);
        }
        pendingFullMobSnapshotReceivedChunks.add(chunkIndex);
        const isFinalChunk = chunkIndex >= chunkCount - 1;
        const receivedAllChunksInOrder = Array.from(
          { length: chunkCount },
          (_, i) => i
        ).every((i) => pendingFullMobSnapshotReceivedChunks.has(i));
        if (isFinalChunk && receivedAllChunksInOrder) {
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
          pendingFullMobSnapshotReceivedChunks.clear();
        } else if (isFinalChunk && !receivedAllChunksInOrder) {
          pendingFullMobSnapshotId = null;
          pendingFullMobSnapshotSeenIds.clear();
          pendingFullMobSnapshotReceivedChunks.clear();
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
        pendingFullMobSnapshotReceivedChunks.clear();
      }
    }
    deltaProfiler.mark('mob-delta-end');
    deltaProfiler.measure('mob-delta', 'mob-delta-start', 'mob-delta-end');
    if (pendingFullMobSnapshotId !== null) {
      for (const mobId of serverMobSeenIdsScratch) {
        pendingFullMobSnapshotSeenIds.add(mobId);
      }
    } else {
      pendingFullMobSnapshotSeenIds.clear();
      pendingFullMobSnapshotReceivedChunks.clear();
    }
  };

  const setLastSnapshotTickSeq = (tickSeq: number): void => {
    lastSnapshotTickSeq = tickSeq;
  };

  const updateServerMobInterpolation = (now: number): void => {
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
      if ((mob.hp ?? 1) <= 0 && staleMs > ctx.SERVER_MOB_DEAD_STALE_REMOVE_MS) {
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
    if (staleMobIds.length > 0) {
      for (const mobId of staleMobIds) {
        removeServerMobById(mobId);
      }
    }

    const renderNow = now - ctx.SERVER_MOB_INTERPOLATION_BACKTIME_MS;
    for (const [mobId, entry] of ctx.serverMobInterpolationById.entries()) {
      const mob = ctx.serverMobsById.get(mobId);
      if (!mob) continue;
      const duration = Math.max(1, entry.t1 - entry.t0);
      const t = THREE.MathUtils.clamp((renderNow - entry.t0) / duration, 0, 1);
      mob.mesh.position.lerpVectors(entry.from, entry.to, t);
      if (renderNow > entry.t1) {
        const maxExtrapolation = connectionAlive
          ? ctx.SERVER_MOB_EXTRAPOLATION_MAX_MS
          : ctx.SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS;
        const extrapolationMs = Math.min(
          maxExtrapolation,
          renderNow - entry.t1
        );
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

  const clearForSnapshot = (): void => {
    for (const interpolation of ctx.serverMobInterpolationById.values()) {
      releaseVector3(interpolation.from);
      releaseVector3(interpolation.to);
      releaseVector3(interpolation.velocity);
    }
    for (const sample of ctx.serverMobSampleById.values()) {
      releaseVector3(sample.position);
      releaseVector3(sample.velocity);
    }
    ctx.serverMobInterpolationById.clear();
    ctx.serverMobSampleById.clear();
  };

  const addSnapshotMobSample = (
    mobId: string,
    serverTimeMs: number,
    position: { x: number; z: number },
    velocity: { x: number; z: number }
  ): void => {
    ctx.serverMobSampleById.set(mobId, {
      serverTimeMs,
      position: acquireVector3(position.x, ctx.MOB_HEIGHT * 0.5, position.z),
      velocity: acquireVector3(velocity.x, 0, velocity.z),
      receivedAtPerfMs: performance.now(),
    });
  };

  return {
    removeServerMobById,
    upsertServerMobFromSnapshot,
    applyServerMobDelta,
    setLastSnapshotTickSeq,
    updateServerMobInterpolation,
    clearForSnapshot,
    addSnapshotMobSample,
    returnMobToPool,
  };
};

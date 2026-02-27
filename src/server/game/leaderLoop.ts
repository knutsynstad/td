import type {
  DeltaBatch,
  GameDelta,
} from '../../shared/game-protocol';
import type { StructureState } from '../../shared/game-state';
import {
  ENABLE_SERVER_TICK_PROFILING,
  LEADER_BROADCAST_WINDOW_MS,
  LEADER_LOCK_TTL_SECONDS,
  LEADER_STALE_PLAYER_INTERVAL,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  PLAYER_TIMEOUT_MS,
  SERVER_TICK_P95_TARGET_MS,
  SERVER_TICK_PROFILE_LOG_EVERY_TICKS,
  SLOW_TICK_LOG_THRESHOLD_MS,
} from './config';
import { getGameChannelName } from './keys';
import {
  buildPresenceLeaveDelta,
  runSimulation,
  SIM_TICK_MS,
  MAX_STRUCTURE_DELTA_UPSERTS,
} from '../../shared/simulation';
import { percentile } from '../../shared/utils';
import {
  buildStaticMapStructures,
  hasStaticMapStructures,
  sanitizeStaticMapStructures,
} from '../../shared/world/staticStructures';
import { broadcastBatched } from '../core/broadcast';
import { sleep } from '../core/lock';
import {
  acquireLeaderLock,
  markTickPublish,
  refreshLeaderLock,
  releaseLeaderLock,
  verifyLeaderLock,
} from './lock';
import { removeOldPlayersByLastSeen } from './players';
import { popPendingCommands } from './queue';
import { loadWorldState, persistWorldState } from './world';

const BATCH_ENVELOPE_OVERHEAD = 80;

const broadcastConfig = {
  maxBatchBytes: MAX_BATCH_BYTES,
  maxBatchEvents: MAX_BATCH_EVENTS,
  envelopeOverhead: BATCH_ENVELOPE_OVERHEAD,
};

export const broadcast = async (
  worldVersion: number,
  tickSeq: number,
  events: GameDelta[]
): Promise<void> => {
  await broadcastBatched<GameDelta>(
    getGameChannelName(),
    events,
    broadcastConfig,
    (batchEvents) => {
      const batch: DeltaBatch = {
        type: 'deltaBatch',
        tickSeq,
        worldVersion,
        events: batchEvents,
      };
      return batch;
    }
  );
};

const createOwnerToken = (): string =>
  `leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

type TickProfile = {
  loadWorldMs: number;
  simulationMs: number;
  persistMs: number;
  broadcastMs: number;
  totalMs: number;
};

export const ensureStaticMap = (world: {
  structures: Record<string, StructureState>;
  meta: { lastTickMs: number; worldVersion: number };
}): { upserts: StructureState[]; removes: string[] } => {
  const removes = sanitizeStaticMapStructures(world.structures);
  if (hasStaticMapStructures(world.structures)) {
    if (removes.length > 0) world.meta.worldVersion += 1;
    return { upserts: [], removes };
  }
  const statics = buildStaticMapStructures(world.meta.lastTickMs);
  const upserts: StructureState[] = [];
  for (const [id, structure] of Object.entries(statics)) {
    world.structures[id] = structure;
    upserts.push(structure);
  }
  if (upserts.length > 0 || removes.length > 0) world.meta.worldVersion += 1;
  return { upserts, removes };
};

export type LeaderLoopResult = {
  ownerToken: string;
  durationMs: number;
  ticksProcessed: number;
};

export const runLeaderLoop = async (
  windowMs: number = LEADER_BROADCAST_WINDOW_MS
): Promise<LeaderLoopResult> => {
  const ownerToken = createOwnerToken();
  const channel = getGameChannelName();
  const startedAt = Date.now();
  const endAt = startedAt + windowMs;
  let nextTick = startedAt;
  let ticksProcessed = 0;
  const tickProfiles: TickProfile[] = [];

  const acquired = await acquireLeaderLock(ownerToken, LEADER_LOCK_TTL_SECONDS);
  if (!acquired) {
    return {
      ownerToken,
      durationMs: Date.now() - startedAt,
      ticksProcessed: 0,
    };
  }

  console.info('Leader loop started', { ownerToken, channel });

  try {
    while (Date.now() < endAt) {
      const now = Date.now();
      if (now < nextTick) {
        await sleep(nextTick - now);
      }

      const stillOwner = await verifyLeaderLock(ownerToken);
      if (!stillOwner) {
        console.warn('Leader lock stolen, exiting loop', { ownerToken });
        break;
      }

      const stillRefreshed = await refreshLeaderLock(
        ownerToken,
        LEADER_LOCK_TTL_SECONDS
      );
      if (!stillRefreshed) {
        console.warn('Leader lock lost during refresh', { ownerToken });
        break;
      }

      const tickStartMs = Date.now();
      const nowMs = tickStartMs;
      let stageLoadWorldMs = 0;
      let stageSimulationMs = 0;
      let stagePersistMs = 0;
      let stageBroadcastMs = 0;

      if (ticksProcessed % LEADER_STALE_PLAYER_INTERVAL === 0) {
        const stalePlayers = await removeOldPlayersByLastSeen(
          nowMs - PLAYER_TIMEOUT_MS,
          500
        );
        if (stalePlayers.length > 0) {
          const world = await loadWorldState();
          const staleDeltas = stalePlayers.map((playerId) =>
            buildPresenceLeaveDelta(
              world.meta.tickSeq,
              world.meta.worldVersion,
              playerId
            )
          );
          const staleBroadcastStartedAtMs = Date.now();
          await broadcast(
            world.meta.worldVersion,
            world.meta.tickSeq,
            staleDeltas
          );
          stageBroadcastMs += Date.now() - staleBroadcastStartedAtMs;
        }
      }

      const loadStartedAtMs = Date.now();
      const world = await loadWorldState();
      stageLoadWorldMs += Date.now() - loadStartedAtMs;
      const staticSync = ensureStaticMap(world);

      if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
        const bootstrapDelta: GameDelta = {
          type: 'structureDelta',
          tickSeq: world.meta.tickSeq,
          worldVersion: world.meta.worldVersion,
          upserts: staticSync.upserts.slice(0, MAX_STRUCTURE_DELTA_UPSERTS),
          removes: staticSync.removes,
          requiresPathRefresh: true,
        };
        const bootstrapBroadcastStartedAtMs = Date.now();
        await broadcast(world.meta.worldVersion, world.meta.tickSeq, [
          bootstrapDelta,
        ]);
        stageBroadcastMs += Date.now() - bootstrapBroadcastStartedAtMs;
      }

      const commands = await popPendingCommands(nowMs);
      const simulationStartedAtMs = Date.now();
      const result = runSimulation(world, nowMs, commands, 1);
      stageSimulationMs += Date.now() - simulationStartedAtMs;

      const persistStartedAtMs = Date.now();
      await persistWorldState(result.world);
      stagePersistMs += Date.now() - persistStartedAtMs;

      if (result.deltas.length > 0) {
        const deltaBroadcastStartedAtMs = Date.now();
        await markTickPublish(result.world.meta.tickSeq);
        await broadcast(
          result.world.meta.worldVersion,
          result.world.meta.tickSeq,
          result.deltas
        );
        stageBroadcastMs += Date.now() - deltaBroadcastStartedAtMs;
      }

      ticksProcessed += 1;

      const tickDurationMs = Date.now() - tickStartMs;
      tickProfiles.push({
        loadWorldMs: stageLoadWorldMs,
        simulationMs: stageSimulationMs,
        persistMs: stagePersistMs,
        broadcastMs: stageBroadcastMs,
        totalMs: tickDurationMs,
      });
      if (tickProfiles.length > 300) tickProfiles.shift();
      if (tickDurationMs >= SLOW_TICK_LOG_THRESHOLD_MS) {
        console.warn('Slow tick in leader loop', {
          tickDurationMs,
          tickSeq: result.world.meta.tickSeq,
          commandCount: commands.length,
          deltaCount: result.deltas.length,
          simPerf: result.perf,
          stageBreakdownMs: {
            loadWorld: stageLoadWorldMs,
            simulation: stageSimulationMs,
            persist: stagePersistMs,
            broadcast: stageBroadcastMs,
          },
        });
      }
      if (
        ENABLE_SERVER_TICK_PROFILING &&
        ticksProcessed % SERVER_TICK_PROFILE_LOG_EVERY_TICKS === 0
      ) {
        const totals = tickProfiles.map((entry) => entry.totalMs);
        const p95 = percentile(totals, 0.95);
        const avgTotal =
          totals.reduce((sum, value) => sum + value, 0) /
          Math.max(1, totals.length);
        const avgLoadWorld =
          tickProfiles.reduce((sum, value) => sum + value.loadWorldMs, 0) /
          Math.max(1, tickProfiles.length);
        const avgSimulation =
          tickProfiles.reduce((sum, value) => sum + value.simulationMs, 0) /
          Math.max(1, tickProfiles.length);
        const avgPersist =
          tickProfiles.reduce((sum, value) => sum + value.persistMs, 0) /
          Math.max(1, tickProfiles.length);
        const avgBroadcast =
          tickProfiles.reduce((sum, value) => sum + value.broadcastMs, 0) /
          Math.max(1, tickProfiles.length);
        console.info('Leader tick profile', {
          sampleSize: tickProfiles.length,
          avgTotalMs: Number(avgTotal.toFixed(2)),
          p95TotalMs: Number(p95.toFixed(2)),
          targetP95Ms: SERVER_TICK_P95_TARGET_MS,
          avgLoadWorldMs: Number(avgLoadWorld.toFixed(2)),
          avgSimulationMs: Number(avgSimulation.toFixed(2)),
          avgPersistMs: Number(avgPersist.toFixed(2)),
          avgBroadcastMs: Number(avgBroadcast.toFixed(2)),
        });
      }

      const afterSend = Date.now();
      const intervalsElapsed = Math.max(
        1,
        Math.ceil((afterSend - startedAt) / SIM_TICK_MS)
      );
      nextTick = startedAt + intervalsElapsed * SIM_TICK_MS;
    }
  } catch (error) {
    console.error('Leader loop error', { ownerToken, error });
  } finally {
    await releaseLeaderLock(ownerToken);
  }

  const durationMs = Date.now() - startedAt;
  console.info('Leader loop ended', { ownerToken, durationMs, ticksProcessed });
  return { ownerToken, durationMs, ticksProcessed };
};

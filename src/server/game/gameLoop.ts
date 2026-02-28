import { redis } from '@devvit/web/server';
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
  LOCK_REFRESH_INTERVAL_TICKS,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  PERSIST_INTERVAL_TICKS,
  PLAYER_TIMEOUT_MS,
  SERVER_TICK_P95_TARGET_MS,
  SERVER_TICK_PROFILE_LOG_EVERY_TICKS,
  SLOW_TICK_LOG_THRESHOLD_MS,
} from './config';
import { getGameChannelName, getGameRedisKeys } from './keys';
import {
  buildPresenceLeaveDelta,
  runSimulation,
  SIM_TICK_MS,
} from '../../shared/simulation';
import {
  buildStaticMapStructures,
  hasStaticMapStructures,
  sanitizeStaticMapStructures,
} from '../../shared/world/staticStructures';
import { broadcastBatched } from '../core/broadcast';
import { runTickLoop } from '../tick';
import type { TickContext } from '../tick';
import { popPendingCommands, trimCommandQueue } from './queue';
import {
  cleanupStalePlayersSeen,
  findAndRemoveStalePlayersInMemory,
  loadWorldState,
  mergePlayersFromRedis,
  persistDirtyState,
} from './world';
import {
  createDirtyTracker,
  markDirtyFromDeltas,
  markIntentRemoved,
  markPlayerRemoved,
  markStructureRemoved,
  markStructureUpserted,
  markWaveDirty,
} from './dirtyTracker';
import type { DirtyTracker } from './dirtyTracker';
import type { WorldState } from '../../shared/game-state';

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

type GameState = {
  world: WorldState;
  tracker: DirtyTracker;
  keys: ReturnType<typeof getGameRedisKeys>;
};

const onGameTick = async (
  { world, tracker, keys }: GameState,
  { nowMs, ticksProcessed, timer }: TickContext
) => {
  const deltas: GameDelta[] = [];

  const isMaintenanceTick =
    ticksProcessed > 0 &&
    ticksProcessed % PERSIST_INTERVAL_TICKS === 0;

  if (isMaintenanceTick) {
    await timer.measureAsync('maintenance', async () => {
      await persistDirtyState(world, tracker);
      await mergePlayersFromRedis(world);

      if (ticksProcessed % LEADER_STALE_PLAYER_INTERVAL === 0) {
        await trimCommandQueue();
        const stalePlayers = findAndRemoveStalePlayersInMemory(
          world,
          nowMs - PLAYER_TIMEOUT_MS,
          500
        );
        if (stalePlayers.length > 0) {
          for (const id of stalePlayers) {
            markPlayerRemoved(tracker, id);
            markIntentRemoved(tracker, id);
          }
          await cleanupStalePlayersSeen(stalePlayers);
          for (const playerId of stalePlayers) {
            deltas.push(buildPresenceLeaveDelta(playerId));
          }
        }
      }
    });
  }

  const commands = await popPendingCommands(nowMs);
  const result = timer.measureSync('simulation', () =>
    runSimulation(world, nowMs, commands, 1)
  );

  markDirtyFromDeltas(tracker, result.deltas);
  deltas.push(...result.deltas);

  if (deltas.length > 0) {
    await timer.measureAsync('broadcast', async () => {
      await redis.set(
        keys.lastPublishTickSeq,
        String(Math.max(0, Math.floor(result.world.meta.tickSeq)))
      );
      await broadcast(
        result.world.meta.worldVersion,
        result.world.meta.tickSeq,
        deltas
      );
    });
  }

  return {
    tickSeq: result.world.meta.tickSeq,
    commandCount: commands.length,
    deltaCount: deltas.length,
    perf: result.perf,
  };
};

export type GameLoopResult = {
  ownerToken: string;
  durationMs: number;
  ticksProcessed: number;
};

export const runGameLoop = (
  windowMs: number = LEADER_BROADCAST_WINDOW_MS
): Promise<GameLoopResult> => {
  const keys = getGameRedisKeys();

  return runTickLoop<GameState>(
    {
      windowMs,
      tickIntervalMs: SIM_TICK_MS,
      lockKey: keys.leaderLock,
      lockTtlSeconds: LEADER_LOCK_TTL_SECONDS,
      lockRefreshIntervalTicks: LOCK_REFRESH_INTERVAL_TICKS,
      channelName: getGameChannelName(),
      instrumentation: {
        slowThresholdMs: SLOW_TICK_LOG_THRESHOLD_MS,
        enableProfiling: ENABLE_SERVER_TICK_PROFILING,
        profileLogEveryTicks: SERVER_TICK_PROFILE_LOG_EVERY_TICKS,
        targetP95Ms: SERVER_TICK_P95_TARGET_MS,
      },
    },
    {
      onInit: async () => {
        const world = await loadWorldState();
        const staticSync = ensureStaticMap(world);
        const tracker = createDirtyTracker();
        for (const s of staticSync.upserts) {
          markStructureUpserted(tracker, s.structureId);
        }
        for (const id of staticSync.removes) {
          markStructureRemoved(tracker, id);
        }
        if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
          markWaveDirty(tracker);
        }
        return { world, tracker, keys };
      },
      onTick: onGameTick,
      onTeardown: async ({ world, tracker }) => {
        await persistDirtyState(world, tracker);
      },
    }
  );
};

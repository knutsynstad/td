import type { DeltaBatch, GameDelta } from '../../shared/game-protocol';
import type { GameWorld, StructureState } from '../../shared/game-state';
import {
  LEADER_BROADCAST_WINDOW_MS,
  LEADER_LOCK_TTL_SECONDS,
  LEADER_STALE_PLAYER_INTERVAL,
  LOCK_REFRESH_INTERVAL_TICKS,
  MAX_BATCH_EVENTS,
  PERSIST_INTERVAL_TICKS,
  PLAYER_TIMEOUT_MS,
} from '../config';
import { KEYS } from '../core/redis';
import { CHANNELS } from '../core/realtime';
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
import { broadcastBatched } from '../core/realtime';
import { runTickLoop, type TickContext } from './tick';
import { popPendingCommands, trimCommandQueue } from './queue';
import {
  flushGameWorld,
  loadGameWorld,
  mergePlayersFromRedis,
  findAndRemoveStalePlayersInMemory,
} from './gameWorld';
import { cleanupStalePlayersSeen } from './world';

export const broadcast = async (
  worldVersion: number,
  tickSeq: number,
  events: GameDelta[]
): Promise<void> => {
  await broadcastBatched<GameDelta>(
    CHANNELS.game,
    events,
    MAX_BATCH_EVENTS,
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
  structures: Map<string, StructureState>;
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
    world.structures.set(id, structure);
    upserts.push(structure);
  }
  if (upserts.length > 0 || removes.length > 0) world.meta.worldVersion += 1;
  return { upserts, removes };
};

const onGameTick = async (
  world: GameWorld,
  { nowMs, ticksProcessed }: TickContext
) => {
  const deltas: GameDelta[] = [];

  const isMaintenanceTick =
    ticksProcessed > 0 && ticksProcessed % PERSIST_INTERVAL_TICKS === 0;

  if (isMaintenanceTick) {
    await flushGameWorld(world);
    await mergePlayersFromRedis(world);

    if (ticksProcessed % LEADER_STALE_PLAYER_INTERVAL === 0) {
      await trimCommandQueue();
      const stalePlayers = findAndRemoveStalePlayersInMemory(
        world,
        nowMs - PLAYER_TIMEOUT_MS,
        500
      );
      if (stalePlayers.length > 0) {
        await cleanupStalePlayersSeen(stalePlayers);
        for (const playerId of stalePlayers) {
          deltas.push(buildPresenceLeaveDelta(playerId));
        }
      }
    }
  }

  const commands = await popPendingCommands(nowMs);
  const result = runSimulation(world, nowMs, commands, 1);

  if (result.deltas.some((d) => d.type === 'waveDelta')) {
    world.waveDirty = true;
  }

  deltas.push(...result.deltas);

  if (deltas.length > 0) {
    await broadcast(
      result.world.meta.worldVersion,
      result.world.meta.tickSeq,
      deltas
    );
  }

  return {
    tickSeq: result.world.meta.tickSeq,
    commandCount: commands.length,
    deltaCount: deltas.length,
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
  const { leaderLock } = KEYS;

  return runTickLoop<GameWorld>(
    {
      windowMs,
      tickIntervalMs: SIM_TICK_MS,
      lockKey: leaderLock,
      lockTtlSeconds: LEADER_LOCK_TTL_SECONDS,
      lockRefreshIntervalTicks: LOCK_REFRESH_INTERVAL_TICKS,
      channelName: CHANNELS.game,
    },
    {
      onInit: async () => {
        const world = await loadGameWorld();
        ensureStaticMap(world);
        world.waveDirty = true;
        return world;
      },
      onTick: onGameTick,
      onTeardown: async (world) => {
        await flushGameWorld(world);
      },
    }
  );
};

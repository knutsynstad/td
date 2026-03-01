import type { GameDelta } from '../../shared/game-protocol';
import type { GameWorld } from '../../shared/game-state';
import {
  LEADER_BROADCAST_WINDOW_MS,
  LEADER_HEARTBEAT_STALE_MS,
  LEADER_LOCK_TTL_SECONDS,
  FOLLOWER_AGGRESSIVE_POLL_INTERVAL_MS,
  FOLLOWER_AGGRESSIVE_POLL_WINDOW_MS,
  FOLLOWER_GATE_TTL_SECONDS,
  FOLLOWER_POLL_INTERVAL_MS,
  FOLLOWER_POLL_MS,
  LEADER_STALE_PLAYER_INTERVAL,
  LOCK_REFRESH_INTERVAL_TICKS,
  PERSIST_INTERVAL_TICKS,
  PLAYER_TIMEOUT_MS,
} from '../config';
import { KEYS } from '../core/keys';
import { broadcastGameDeltas, CHANNELS } from '../core/broadcast';
import { runTickLoop, type TickContext } from '../core/tickLoop';
import {
  buildPresenceLeaveDelta,
  runSimulation,
  SIM_TICK_MS,
} from './simulation';
import { ensureStaticMap } from './staticMap';
import { popPendingCommands, trimCommandQueue } from './queue';
import {
  flushGameWorld,
  loadGameWorld,
  mergePlayersFromRedis,
  findAndRemoveStalePlayersInMemory,
} from './trackedState';
import { cleanupStalePlayersSeen } from './persistence';

async function onGameTick(
  world: GameWorld,
  { nowMs, ticksProcessed }: TickContext
): Promise<{
  tickSeq: number;
  commandCount: number;
  deltaCount: number;
}> {
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
    await broadcastGameDeltas(
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
}

export type GameLoopResult = {
  ownerToken: string;
  durationMs: number;
  ticksProcessed: number;
};

export function runGameLoop(
  windowMs: number = LEADER_BROADCAST_WINDOW_MS
): Promise<GameLoopResult> {
  return runTickLoop<GameWorld>(
    {
      windowMs,
      tickIntervalMs: SIM_TICK_MS,
      lockKey: KEYS.LEADER_LOCK,
      lockTtlSeconds: LEADER_LOCK_TTL_SECONDS,
      lockRefreshIntervalTicks: LOCK_REFRESH_INTERVAL_TICKS,
      channelName: CHANNELS.game,
      followerPollMs: FOLLOWER_POLL_MS,
      followerPollIntervalMs: FOLLOWER_POLL_INTERVAL_MS,
      followerAggressivePollWindowMs: FOLLOWER_AGGRESSIVE_POLL_WINDOW_MS,
      followerAggressivePollIntervalMs: FOLLOWER_AGGRESSIVE_POLL_INTERVAL_MS,
      heartbeatKey: KEYS.LEADER_HEARTBEAT,
      heartbeatStaleMs: LEADER_HEARTBEAT_STALE_MS,
      followerGateKey: KEYS.FOLLOWER_GATE,
      followerGateTtlSeconds: FOLLOWER_GATE_TTL_SECONDS,
    },
    {
      onInit: async function () {
        const world = await loadGameWorld();
        ensureStaticMap(world);
        world.waveDirty = true;
        return world;
      },
      onTick: onGameTick,
      onTeardown: async function (world) {
        await flushGameWorld(world);
      },
    }
  );
}

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
  LOCK_REFRESH_INTERVAL_TICKS,
  PLAYER_POSITION_BROADCAST_INTERVAL_TICKS,
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
} from './trackedState';

async function onGameTick(
  world: GameWorld,
  { nowMs, ticksProcessed }: TickContext
): Promise<{
  tickSeq: number;
  commandCount: number;
  deltaCount: number;
}> {
  const deltas: GameDelta[] = [];

  await flushGameWorld(world);
  const leftIds = await mergePlayersFromRedis(world);
  for (const playerId of leftIds) {
    deltas.push(buildPresenceLeaveDelta(playerId));
  }
  await trimCommandQueue();

  const commands = await popPendingCommands(nowMs);
  const result = runSimulation(world, nowMs, commands, 1);

  if (result.deltas.some((d) => d.type === 'waveDelta')) {
    world.waveDirty = true;
  }

  deltas.push(...result.deltas);

  if (
    ticksProcessed > 0 &&
    ticksProcessed % PLAYER_POSITION_BROADCAST_INTERVAL_TICKS === 0
  ) {
    const players = Array.from(world.players.values()).map((p) => ({
      playerId: p.playerId,
      username: p.username,
      interpolation: {
        from: p.position,
        to: p.position,
        t0: nowMs - SIM_TICK_MS,
        t1: nowMs,
      },
    }));
    if (players.length > 0) {
      deltas.push({
        type: 'entityDelta',
        serverTimeMs: nowMs,
        tickMs: SIM_TICK_MS,
        players,
        despawnedMobIds: [],
      });
    }
  }

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

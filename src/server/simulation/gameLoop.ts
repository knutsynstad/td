import type { GameDelta } from '../../shared/game-protocol';
import type { GameWorld } from '../../shared/game-state';
import {
  WAVE_PREPARE_MS,
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
  SIM_TICK_MS,
} from '../config';
import { KEYS } from '../core/keys';
import { broadcast, CHANNELS } from '../core/broadcast';
import { runTickLoop, type TickContext } from '../core/tickLoop';
import { buildPresenceLeaveDelta, runSimulation } from './index';
import { resetLastBroadcastMobs } from './deltas';
import { ensureInitialWaveSchedule } from './waves';
import { ensureStaticMap } from '../game/staticMap';
import { getQueueSize, popPendingCommands, trimCommandQueue } from './queue';
import {
  flushGameWorld,
  loadGameWorld,
  mergePlayersFromRedis,
} from '../game/trackedState';
import { resetGameToDefault } from '../game/persistence';

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
  const queueSizeAfterPop = await getQueueSize();
  if (
    queueSizeAfterPop > 1000 ||
    (commands.length === 0 && queueSizeAfterPop > 0) ||
    ticksProcessed % 100 === 0
  ) {
    console.log(
      `[Queue] tick ${ticksProcessed}: popped ${commands.length}, queue size after pop=${queueSizeAfterPop}`
    );
  }
  const result = runSimulation(world, nowMs, commands, 1);

  for (const [id, mob] of world.mobs) {
    world.mobs.set(id, mob);
  }

  if (result.perf.elapsedMs > 0 && ticksProcessed % 10 === 0) {
    console.log('[SimPerf]', {
      tickSeq: result.world.meta.tickSeq,
      commands: commands.length,
      deltas: result.deltas.length,
      mobs: result.perf.mobsSimulated,
      towers: result.perf.towersSimulated,
      towerMobChecks: result.perf.towerMobChecks,
      spawned: result.perf.waveSpawnedMobs,
      elapsedMs: result.perf.elapsedMs,
    });
  }

  if (result.gameOver) {
    const tickSeq = result.world.meta.tickSeq;
    const worldVersion = result.world.meta.worldVersion;
    if (result.deltas.length > 0) {
      await broadcast(worldVersion, tickSeq, result.deltas);
    }
    const connectedPlayerIds = Array.from(world.players.keys());
    await resetGameToDefault(nowMs, {
      reason: 'castle_death',
      connectedPlayerIds,
    });
    await broadcast(0, 0, [{ type: 'resyncRequired', reason: 'castle death' }]);
    const fresh = await loadGameWorld();
    ensureStaticMap(fresh);
    ensureInitialWaveSchedule(fresh);
    fresh.wave.nextWaveAtMs = nowMs + WAVE_PREPARE_MS;
    world.meta = fresh.meta;
    world.wave = fresh.wave;
    world.players = fresh.players;
    world.structures = fresh.structures;
    world.mobs = fresh.mobs;
    world.intents = fresh.intents;
    world.waveDirty = true;
    await flushGameWorld(world);
    const waveDelta: GameDelta = {
      type: 'waveDelta',
      wave: world.wave,
      routesIncluded: true,
    };
    await broadcast(world.meta.worldVersion, world.meta.tickSeq, [waveDelta]);
    return {
      tickSeq: world.meta.tickSeq,
      commandCount: commands.length,
      deltaCount: 2,
    };
  }

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
      followerLeaderWindowMs: LEADER_BROADCAST_WINDOW_MS,
      heartbeatKey: KEYS.LEADER_HEARTBEAT,
      heartbeatStaleMs: LEADER_HEARTBEAT_STALE_MS,
      followerGateKey: KEYS.FOLLOWER_GATE,
      followerGateTtlSeconds: FOLLOWER_GATE_TTL_SECONDS,
    },
    {
      onInit: async function () {
        resetLastBroadcastMobs();
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

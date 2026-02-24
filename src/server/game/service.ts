import { realtime, reddit } from '@devvit/web/server';
import type {
  CommandEnvelope,
  CommandResponse,
  DeltaBatch,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  ResyncResponse,
} from '../../shared/game-protocol';
import {
  DEFAULT_PLAYER_SPAWN,
  type PlayerState,
} from '../../shared/game-state';
import {
  BACKLOG_RESYNC_STEP_THRESHOLD,
  ENERGY_COST_TOWER,
  ENERGY_COST_WALL,
  MAX_BATCH_EVENTS,
  MAX_PLAYERS,
  MAX_STEPS_PER_REQUEST,
  PLAYER_TIMEOUT_MS,
  SIM_TICK_MS,
  SLOW_TICK_LOG_THRESHOLD_MS,
  TICK_LEASE_MS,
  TICK_STALE_RECOVERY_MS,
} from './config';
import { getGameChannelName } from './keys';
import { buildPresenceLeaveDelta, runSimulation } from './simulation';
import {
  acquireTickLease,
  addCoins,
  consumeRateLimitToken,
  createDefaultPlayer,
  enqueueCommand,
  enforceStructureCap,
  getTickHealth,
  getCoins,
  loadWorldState,
  markTickPublish,
  markTickRun,
  persistWorldState,
  popPendingCommands,
  releaseTickLease,
  resetGameState,
  removeOldPlayersByLastSeen,
  spendCoins,
  touchPlayerPresence,
  trimCommandQueue,
} from './store';

const getPlayerId = async (): Promise<string> => {
  const username = await reddit.getCurrentUsername();
  if (!username) return `anon-${Date.now()}`;
  return username.toLowerCase();
};

const broadcast = async (
  worldVersion: number,
  tickSeq: number,
  events: GameDelta[]
): Promise<void> => {
  if (events.length === 0) return;
  const boundedEvents = events.slice(0, MAX_BATCH_EVENTS);
  const batch: DeltaBatch = {
    type: 'deltaBatch',
    tickSeq,
    worldVersion,
    events: boundedEvents,
  };
  try {
    await realtime.send(getGameChannelName(), batch);
  } catch (error) {
    console.error('Realtime broadcast failed', {
      tickSeq,
      worldVersion,
      eventCount: boundedEvents.length,
      error,
    });
  }
};

type TickSource =
  | 'command'
  | 'heartbeat'
  | 'scheduler'
  | 'maintenance-recovery';

type TickResult = {
  deltas: GameDelta[];
  tickSeq: number;
  worldVersion: number;
  processedSteps: number;
  remainingSteps: number;
  stalePlayersRemoved: number;
};

type TickOptions = {
  removeStalePlayers?: boolean;
  staleLimit?: number;
};

const runPendingSimulation = async (
  nowMs: number,
  source: TickSource,
  options?: TickOptions
): Promise<TickResult> => {
  const startedAtMs = Date.now();
  const leaseOwnerId = `${source}-${nowMs}-${Math.floor(Math.random() * 1_000_000)}`;
  const lease = await acquireTickLease(leaseOwnerId, nowMs, TICK_LEASE_MS);
  if (!lease) {
    const fallback = await loadWorldState();
    return {
      deltas: [],
      tickSeq: fallback.meta.tickSeq,
      worldVersion: fallback.meta.worldVersion,
      processedSteps: 0,
      remainingSteps: 0,
      stalePlayersRemoved: 0,
    };
  }

  try {
    const stalePlayers = options?.removeStalePlayers
      ? await removeOldPlayersByLastSeen(
          nowMs - PLAYER_TIMEOUT_MS,
          options?.staleLimit ?? 250
        )
      : [];
    const world = await loadWorldState();
    const simulationStartTickMs = world.meta.lastTickMs;
    const commands = await popPendingCommands(nowMs);
    const result = runSimulation(world, nowMs, commands, MAX_STEPS_PER_REQUEST);
    const simulationEndTickMs = result.world.meta.lastTickMs;
    const processedSteps = Math.max(
      0,
      Math.floor((simulationEndTickMs - simulationStartTickMs) / SIM_TICK_MS)
    );
    const remainingSteps = Math.max(
      0,
      Math.floor((nowMs - simulationEndTickMs) / SIM_TICK_MS)
    );
    const staleDeltas = stalePlayers.map((playerId) =>
      buildPresenceLeaveDelta(
        result.world.meta.tickSeq,
        result.world.meta.worldVersion,
        playerId
      )
    );
    const deltas = [...staleDeltas, ...result.deltas];
    if (remainingSteps >= BACKLOG_RESYNC_STEP_THRESHOLD) {
      deltas.push({
        type: 'resyncRequired',
        tickSeq: result.world.meta.tickSeq,
        worldVersion: result.world.meta.worldVersion,
        reason: `tick backlog: ${remainingSteps} steps`,
      });
    }
    await persistWorldState(result.world);
    await markTickRun(nowMs);
    if (deltas.length > 0) {
      await markTickPublish(result.world.meta.tickSeq);
      await broadcast(
        result.world.meta.worldVersion,
        result.world.meta.tickSeq,
        deltas
      );
    }
    const durationMs = Date.now() - startedAtMs;
    if (durationMs >= SLOW_TICK_LOG_THRESHOLD_MS) {
      console.warn('Slow tick processed', {
        source,
        durationMs,
        tickSeq: result.world.meta.tickSeq,
        worldVersion: result.world.meta.worldVersion,
        processedSteps,
        remainingSteps,
        commandCount: commands.length,
        stalePlayersRemoved: stalePlayers.length,
        eventCount: deltas.length,
      });
    }
    return {
      deltas,
      tickSeq: result.world.meta.tickSeq,
      worldVersion: result.world.meta.worldVersion,
      processedSteps,
      remainingSteps,
      stalePlayersRemoved: stalePlayers.length,
    };
  } finally {
    try {
      const released = await releaseTickLease(leaseOwnerId, lease.token);
      if (!released) {
        console.warn('Tick lease release skipped', {
          source,
          leaseToken: lease.token,
        });
      }
    } catch (error) {
      console.error('Tick lease release failed', {
        source,
        leaseToken: lease.token,
        error,
      });
    }
  }
};

export const joinGame = async (): Promise<JoinResponse> => {
  const nowMs = Date.now();
  await removeOldPlayersByLastSeen(nowMs - PLAYER_TIMEOUT_MS, MAX_PLAYERS);
  const world = await loadWorldState();
  const playerCount = Object.keys(world.players).length;
  if (playerCount >= MAX_PLAYERS) {
    throw new Error('game is full');
  }

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const playerId = await getPlayerId();
  const existing = world.players[playerId];
  const player: PlayerState =
    existing ?? createDefaultPlayer(playerId, username, nowMs);
  player.username = username;
  // Always spawn/rejoin at the canonical spawn in front of the castle.
  player.position = { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z };
  player.velocity = { x: 0, z: 0 };
  player.lastSeenMs = nowMs;
  world.players[playerId] = player;
  await persistWorldState(world);
  await touchPlayerPresence(player);
  const coins = await getCoins(nowMs);
  world.meta.energy = coins;

  const joinDelta: GameDelta = {
    type: 'presenceDelta',
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
    joined: {
      playerId,
      username,
      position: player.position,
    },
  };
  await broadcast(world.meta.worldVersion, world.meta.tickSeq, [
    joinDelta,
  ]);

  return {
    type: 'join',
    playerId,
    username,
    channel: getGameChannelName(),
    snapshot: world,
  };
};

export const applyCommand = async (
  envelope: CommandEnvelope
): Promise<CommandResponse> => {
  const nowMs = Date.now();
  const playerId = envelope.command.playerId;
  let spentBuildCoins = 0;
  const hasToken = await consumeRateLimitToken(playerId, nowMs);
  if (!hasToken) {
    const world = await loadWorldState();
    return {
      type: 'commandAck',
      accepted: false,
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: 'rate limited',
    };
  }

  if (envelope.command.type === 'buildStructure') {
    const canBuild = await enforceStructureCap();
    if (!canBuild) {
      const world = await loadWorldState();
      return {
        type: 'commandAck',
        accepted: false,
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        reason: 'structure cap reached',
      };
    }
    const energyCost =
      envelope.command.structure.type === 'tower'
        ? ENERGY_COST_TOWER
        : ENERGY_COST_WALL;
    const spendResult = await spendCoins(energyCost, nowMs);
    if (!spendResult.ok) {
      const world = await loadWorldState();
      return {
        type: 'commandAck',
        accepted: false,
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        reason: 'not enough coins',
      };
    }
    spentBuildCoins = energyCost;
  }

  const enqueueResult = await enqueueCommand(nowMs, envelope);
  if (!enqueueResult.accepted) {
    if (spentBuildCoins > 0) {
      await addCoins(spentBuildCoins, nowMs);
    }
    const world = await loadWorldState();
    return {
      type: 'commandAck',
      accepted: false,
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: enqueueResult.reason,
    };
  }

  const simulation = await runPendingSimulation(nowMs, 'command');

  return {
    type: 'commandAck',
    accepted: true,
    tickSeq: simulation.tickSeq,
    worldVersion: simulation.worldVersion,
  };
};

export const heartbeatGame = async (
  playerId: string,
  position?: { x: number; z: number }
): Promise<HeartbeatResponse> => {
  const nowMs = Date.now();
  const world = await loadWorldState();
  const player = world.players[playerId];
  if (player) {
    player.lastSeenMs = nowMs;
    if (position) {
      player.position = position;
    }
    await touchPlayerPresence(player);
  }
  const simulation = await runPendingSimulation(nowMs, 'heartbeat', {
    removeStalePlayers: true,
    staleLimit: 200,
  });

  return {
    type: 'heartbeatAck',
    tickSeq: simulation.tickSeq,
    worldVersion: simulation.worldVersion,
  };
};

export const getCoinBalance = async (): Promise<number> => getCoins(Date.now());

export const resyncGame = async (_playerId?: string): Promise<ResyncResponse> => {
  const world = await loadWorldState();
  world.meta.energy = await getCoins(Date.now());
  return {
    type: 'snapshot',
    snapshot: world,
  };
};

export const runMaintenance = async (): Promise<{ stalePlayers: number }> => {
  await trimCommandQueue();
  const nowMs = Date.now();
  const stale = await removeOldPlayersByLastSeen(nowMs - PLAYER_TIMEOUT_MS, 500);
  const health = await getTickHealth();
  if (nowMs - health.lastTickRunMs >= TICK_STALE_RECOVERY_MS) {
    await runPendingSimulation(nowMs, 'maintenance-recovery');
  }
  return {
    stalePlayers: stale.length,
  };
};

export const runSchedulerTick = async (): Promise<{
  tickSeq: number;
  worldVersion: number;
  eventCount: number;
  remainingSteps: number;
}> => {
  const nowMs = Date.now();
  const result = await runPendingSimulation(nowMs, 'scheduler', {
    removeStalePlayers: true,
    staleLimit: 500,
  });
  return {
    tickSeq: result.tickSeq,
    worldVersion: result.worldVersion,
    eventCount: result.deltas.length,
    remainingSteps: result.remainingSteps,
  };
};

export const resetGame = async (): Promise<{
  tickSeq: number;
  worldVersion: number;
}> => {
  const nowMs = Date.now();
  await resetGameState(nowMs);
  const world = await loadWorldState();
  await broadcast(world.meta.worldVersion, world.meta.tickSeq, [
    {
      type: 'resyncRequired',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: 'game reset',
    },
  ]);
  return {
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
  };
};

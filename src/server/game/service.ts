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
  type StructureState,
} from '../../shared/game-state';
import {
  ENABLE_SERVER_TICK_PROFILING,
  ENERGY_COST_TOWER,
  ENERGY_COST_WALL,
  LEADER_BROADCAST_WINDOW_MS,
  LEADER_LOCK_TTL_SECONDS,
  LEADER_STALE_PLAYER_INTERVAL,
  MAX_BATCH_EVENTS,
  MAX_PLAYERS,
  MAX_STRUCTURE_DELTA_UPSERTS,
  PLAYER_TIMEOUT_MS,
  SERVER_TICK_P95_TARGET_MS,
  SERVER_TICK_PROFILE_LOG_EVERY_TICKS,
  SIM_TICK_MS,
  SLOW_TICK_LOG_THRESHOLD_MS,
} from './config';
import { getGameChannelName } from './keys';
import { buildPresenceLeaveDelta, runSimulation } from './simulation';
import {
  buildStaticMapStructures,
  hasStaticMapStructures,
  sanitizeStaticMapStructures,
} from './staticStructures';
import {
  acquireLeaderLock,
  addCoins,
  consumeRateLimitToken,
  createDefaultPlayer,
  enqueueCommand,
  enforceStructureCap,
  getCoins,
  loadWorldState,
  markTickPublish,
  persistWorldState,
  popPendingCommands,
  refreshLeaderLock,
  releaseLeaderLock,
  resetGameState,
  removeOldPlayersByLastSeen,
  sleep,
  spendCoins,
  touchPlayerPresence,
  trimCommandQueue,
  verifyLeaderLock,
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
  try {
    const totalBatches = Math.max(1, Math.ceil(events.length / MAX_BATCH_EVENTS));
    for (
      let offset = 0, batchIndex = 0;
      offset < events.length;
      offset += MAX_BATCH_EVENTS, batchIndex += 1
    ) {
      const batchEvents = events.slice(offset, offset + MAX_BATCH_EVENTS);
      const batch: DeltaBatch = {
        type: 'deltaBatch',
        tickSeq,
        worldVersion,
        events: batchEvents,
      };
      const serialized = JSON.stringify(batch);
      const messageSizeBytes = new TextEncoder().encode(serialized).length;
      try {
        await realtime.send(getGameChannelName(), batch);
      } catch (error) {
        console.error('Realtime broadcast failed', {
          tickSeq,
          worldVersion,
          eventCount: events.length,
          batchIndex,
          totalBatches,
          batchEventCount: batchEvents.length,
          messageSizeBytes,
          error,
        });
        throw error;
      }
    }
  } catch (error) {
    // Failure details are logged at the per-batch callsite above.
    void error;
  }
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

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  );
  return sorted[idx] ?? 0;
};

const ensureStaticMap = (
  world: { structures: Record<string, StructureState>; meta: { lastTickMs: number; worldVersion: number } }
): { upserts: StructureState[]; removes: string[] } => {
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
    return { ownerToken, durationMs: Date.now() - startedAt, ticksProcessed: 0 };
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

      await refreshLeaderLock(LEADER_LOCK_TTL_SECONDS);

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
          await broadcast(world.meta.worldVersion, world.meta.tickSeq, staleDeltas);
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
        await broadcast(world.meta.worldVersion, world.meta.tickSeq, [bootstrapDelta]);
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

export const joinGame = async (): Promise<JoinResponse> => {
  const nowMs = Date.now();
  await removeOldPlayersByLastSeen(nowMs - PLAYER_TIMEOUT_MS, MAX_PLAYERS);
  const world = await loadWorldState();
  ensureStaticMap(world);
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
  const getStructureEnergyCost = (type: string): number =>
    type === 'tower' ? ENERGY_COST_TOWER : ENERGY_COST_WALL;
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

  if (
    envelope.command.type === 'buildStructure' ||
    envelope.command.type === 'buildStructures'
  ) {
    const structures =
      envelope.command.type === 'buildStructure'
        ? [envelope.command.structure]
        : envelope.command.structures;
    const requestedCount = structures.length;
    if (requestedCount <= 0) {
      const world = await loadWorldState();
      return {
        type: 'commandAck',
        accepted: false,
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        reason: 'no structures requested',
      };
    }
    const canBuild = await enforceStructureCap(requestedCount);
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
    const energyCost = structures.reduce(
      (total, structure) => total + getStructureEnergyCost(structure.type),
      0
    );
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

  const world = await loadWorldState();
  return {
    type: 'commandAck',
    accepted: true,
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
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

  return {
    type: 'heartbeatAck',
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
  };
};

export const getCoinBalance = async (): Promise<number> => getCoins(Date.now());

export const resyncGame = async (_playerId?: string): Promise<ResyncResponse> => {
  const world = await loadWorldState();
  const staticSync = ensureStaticMap(world);
  if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
    await persistWorldState(world);
  }
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
  return {
    stalePlayers: stale.length,
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

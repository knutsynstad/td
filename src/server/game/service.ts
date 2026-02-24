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
  ENERGY_COST_TOWER,
  ENERGY_COST_WALL,
  LEADER_BROADCAST_WINDOW_MS,
  LEADER_LOCK_TTL_SECONDS,
  LEADER_STALE_PLAYER_INTERVAL,
  MAX_BATCH_EVENTS,
  MAX_PLAYERS,
  MAX_STRUCTURE_DELTA_UPSERTS,
  PLAYER_TIMEOUT_MS,
  SIM_TICK_MS,
  SLOW_TICK_LOG_THRESHOLD_MS,
} from './config';
import { getGameChannelName } from './keys';
import { buildPresenceLeaveDelta, runSimulation } from './simulation';
import { buildStaticMapStructures, hasStaticMapStructures } from './staticStructures';
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

const createOwnerToken = (): string =>
  `leader:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

const ensureStaticMap = (
  world: { structures: Record<string, StructureState>; meta: { lastTickMs: number; worldVersion: number } }
): StructureState[] => {
  if (hasStaticMapStructures(world.structures)) return [];
  const statics = buildStaticMapStructures(world.meta.lastTickMs);
  const upserts: StructureState[] = [];
  for (const [id, structure] of Object.entries(statics)) {
    world.structures[id] = structure;
    upserts.push(structure);
  }
  if (upserts.length > 0) world.meta.worldVersion += 1;
  return upserts;
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
          await broadcast(world.meta.worldVersion, world.meta.tickSeq, staleDeltas);
        }
      }

      const world = await loadWorldState();
      const staticUpserts = ensureStaticMap(world);

      if (staticUpserts.length > 0) {
        const bootstrapDelta: GameDelta = {
          type: 'structureDelta',
          tickSeq: world.meta.tickSeq,
          worldVersion: world.meta.worldVersion,
          upserts: staticUpserts.slice(0, MAX_STRUCTURE_DELTA_UPSERTS),
          removes: [],
          requiresPathRefresh: true,
        };
        await broadcast(world.meta.worldVersion, world.meta.tickSeq, [bootstrapDelta]);
      }

      const commands = await popPendingCommands(nowMs);
      const result = runSimulation(world, nowMs, commands, 1);

      await persistWorldState(result.world);

      if (result.deltas.length > 0) {
        await markTickPublish(result.world.meta.tickSeq);
        await broadcast(
          result.world.meta.worldVersion,
          result.world.meta.tickSeq,
          result.deltas
        );
      }

      ticksProcessed += 1;

      const tickDurationMs = Date.now() - tickStartMs;
      if (tickDurationMs >= SLOW_TICK_LOG_THRESHOLD_MS) {
        console.warn('Slow tick in leader loop', {
          tickDurationMs,
          tickSeq: result.world.meta.tickSeq,
          commandCount: commands.length,
          deltaCount: result.deltas.length,
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
  if (!hasStaticMapStructures(world.structures)) {
    const staticStructures = buildStaticMapStructures(world.meta.lastTickMs);
    for (const [structureId, structure] of Object.entries(staticStructures)) {
      world.structures[structureId] = structure;
    }
  }
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
  if (!hasStaticMapStructures(world.structures)) {
    const staticStructures = buildStaticMapStructures(world.meta.lastTickMs);
    for (const [structureId, structure] of Object.entries(staticStructures)) {
      world.structures[structureId] = structure;
    }
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

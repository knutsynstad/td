import { realtime, reddit } from "@devvit/web/server";
import type {
  CommandEnvelope,
  CommandResponse,
  DeltaBatch,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  ResyncResponse,
} from "../../shared/game-protocol";
import type { PlayerState } from "../../shared/game-state";
import { MAX_BATCH_EVENTS, MAX_PLAYERS, MAX_STEPS_PER_REQUEST, PLAYER_TIMEOUT_MS } from "./config";
import { getGameChannelName } from "./keys";
import { buildPresenceLeaveDelta, runSimulation } from "./simulation";
import {
  consumeRateLimitToken,
  createDefaultPlayer,
  enqueueCommand,
  enforceStructureCap,
  loadWorldState,
  persistWorldState,
  popPendingCommands,
  removeOldPlayersByLastSeen,
  touchPlayerPresence,
  trimCommandQueue,
} from "./store";

const getPlayerId = async (): Promise<string> => {
  const username = await reddit.getCurrentUsername();
  if (!username) return `anon-${Date.now()}`;
  return username.toLowerCase();
};

const broadcast = async (postId: string, worldVersion: number, tickSeq: number, events: GameDelta[]): Promise<void> => {
  if (events.length === 0) return;
  const boundedEvents = events.slice(0, MAX_BATCH_EVENTS);
  const batch: DeltaBatch = {
    type: "deltaBatch",
    tickSeq,
    worldVersion,
    events: boundedEvents,
  };
  try {
    await realtime.send(getGameChannelName(postId), batch);
  } catch (error) {
    console.error("Realtime broadcast failed", {
      postId,
      tickSeq,
      worldVersion,
      eventCount: boundedEvents.length,
      error,
    });
  }
};

const runPendingSimulation = async (postId: string, nowMs: number): Promise<{ deltas: GameDelta[]; tickSeq: number; worldVersion: number }> => {
  const world = await loadWorldState(postId);
  const commands = await popPendingCommands(postId, nowMs);
  const result = runSimulation(world, nowMs, commands, MAX_STEPS_PER_REQUEST);
  await persistWorldState(result.world);
  return {
    deltas: result.deltas,
    tickSeq: result.world.meta.tickSeq,
    worldVersion: result.world.meta.worldVersion,
  };
};

export const joinGame = async (postId: string): Promise<JoinResponse> => {
  const nowMs = Date.now();
  await removeOldPlayersByLastSeen(postId, nowMs - PLAYER_TIMEOUT_MS, MAX_PLAYERS);
  const world = await loadWorldState(postId);
  const playerCount = Object.keys(world.players).length;
  if (playerCount >= MAX_PLAYERS) {
    throw new Error("game is full");
  }

  const username = (await reddit.getCurrentUsername()) ?? "anonymous";
  const playerId = await getPlayerId();
  const existing = world.players[playerId];
  const player: PlayerState =
    existing ??
    createDefaultPlayer(
      playerId,
      username,
      nowMs,
    );
  player.username = username;
  player.lastSeenMs = nowMs;
  world.players[playerId] = player;
  await persistWorldState(world);
  await touchPlayerPresence(postId, player);

  const joinDelta: GameDelta = {
    type: "presenceDelta",
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
    joined: {
      playerId,
      username,
      position: player.position,
    },
  };
  await broadcast(postId, world.meta.worldVersion, world.meta.tickSeq, [joinDelta]);

  return {
    type: "join",
    playerId,
    username,
    channel: getGameChannelName(postId),
    snapshot: world,
  };
};

export const applyCommand = async (postId: string, envelope: CommandEnvelope): Promise<CommandResponse> => {
  const nowMs = Date.now();
  const playerId = envelope.command.playerId;
  const hasToken = await consumeRateLimitToken(postId, playerId, nowMs);
  if (!hasToken) {
    const world = await loadWorldState(postId);
    return {
      type: "commandAck",
      accepted: false,
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: "rate limited",
    };
  }

  if (envelope.command.type === "buildStructure") {
    const canBuild = await enforceStructureCap(postId);
    if (!canBuild) {
      const world = await loadWorldState(postId);
      return {
        type: "commandAck",
        accepted: false,
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        reason: "structure cap reached",
      };
    }
  }

  const enqueueResult = await enqueueCommand(postId, nowMs, envelope);
  if (!enqueueResult.accepted) {
    const world = await loadWorldState(postId);
    return {
      type: "commandAck",
      accepted: false,
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: enqueueResult.reason,
    };
  }

  const simulation = await runPendingSimulation(postId, nowMs);
  await broadcast(postId, simulation.worldVersion, simulation.tickSeq, simulation.deltas);

  return {
    type: "commandAck",
    accepted: true,
    tickSeq: simulation.tickSeq,
    worldVersion: simulation.worldVersion,
  };
};

export const heartbeatGame = async (
  postId: string,
  playerId: string,
  position?: { x: number; z: number },
): Promise<HeartbeatResponse> => {
  const world = await loadWorldState(postId);
  const player = world.players[playerId];
  if (player) {
    player.lastSeenMs = Date.now();
    if (position) {
      player.position = position;
    }
    await touchPlayerPresence(postId, player);
    await persistWorldState(world);
  }

  const nowMs = Date.now();
  const stale = await removeOldPlayersByLastSeen(postId, nowMs - PLAYER_TIMEOUT_MS, 200);
  const staleDeltas = stale.map((stalePlayerId) => buildPresenceLeaveDelta(world.meta.tickSeq, world.meta.worldVersion, stalePlayerId));

  const simulation = await runPendingSimulation(postId, nowMs);
  const allDeltas = [...staleDeltas, ...simulation.deltas];
  await broadcast(postId, simulation.worldVersion, simulation.tickSeq, allDeltas);

  return {
    type: "heartbeatAck",
    tickSeq: simulation.tickSeq,
    worldVersion: simulation.worldVersion,
  };
};

export const resyncGame = async (postId: string): Promise<ResyncResponse> => {
  const world = await loadWorldState(postId);
  return {
    type: "snapshot",
    snapshot: world,
  };
};

export const runMaintenance = async (postId: string): Promise<{ stalePlayers: number }> => {
  await trimCommandQueue(postId);
  const stale = await removeOldPlayersByLastSeen(postId, Date.now() - PLAYER_TIMEOUT_MS, 500);
  return {
    stalePlayers: stale.length,
  };
};

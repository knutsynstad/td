import { reddit } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import type {
  CommandEnvelope,
  CommandResponse,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  ResyncResponse,
} from '../../shared/game-protocol';
import {
  DEFAULT_PLAYER_SPAWN,
  type PlayerState,
} from '../../shared/game-state';
import { getStructureCoinCost } from '../../shared/content';
import { MAX_PLAYERS, PLAYER_TIMEOUT_MS } from '../config';
import { CHANNELS } from '../core/realtime';
import { addUserCoins, getUserCoinBalance, spendUserCoins } from './economy';
import {
  createDefaultPlayer,
  enforceStructureCap,
  removeOldPlayersByLastSeen,
  touchPlayerPresence,
} from './players';
import { enqueueCommand } from './queue';
import { loadWorldState, resetGameState } from './world';
import {
  flushGameWorld,
  gameWorldToSnapshot,
  loadGameWorld,
} from './gameWorld';
import { broadcast, ensureStaticMap } from './gameLoop';

/**
 * Resolve the current player's ID from the Reddit username, falling back to an anonymous ID.
 */
export async function getPlayerId(): Promise<string> {
  const username = await reddit.getCurrentUsername();
  if (!username) return `anon-${Date.now()}`;
  return username.toLowerCase();
}

/**
 * Join the game: prune stale players, create or restore the player, and broadcast the join delta.
 */
export async function joinGame(
  playerIdOverride?: string
): Promise<JoinResponse> {
  const nowMs = Date.now();
  await removeOldPlayersByLastSeen(nowMs - PLAYER_TIMEOUT_MS, MAX_PLAYERS);
  const world = await loadGameWorld();
  ensureStaticMap(world);
  if (world.players.size >= MAX_PLAYERS) {
    throw new Error('game is full');
  }

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const playerId = playerIdOverride ?? (await getPlayerId());
  const existing = world.players.get(playerId);
  const player: PlayerState =
    existing ?? createDefaultPlayer(playerId, username, nowMs);
  player.username = username;
  player.position = { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z };
  player.velocity = { x: 0, z: 0 };
  player.lastSeenMs = nowMs;
  world.players.set(playerId, player);
  await touchPlayerPresence(player);
  const coins = await getUserCoinBalance(playerId as T2);
  world.meta.coins = coins;

  const joinDelta: GameDelta = {
    type: 'presenceDelta',
    joined: {
      playerId,
      username,
      position: player.position,
    },
  };
  await broadcast(world.meta.worldVersion, world.meta.tickSeq, [joinDelta]);

  return {
    type: 'join',
    playerId,
    username,
    channel: CHANNELS.game,
    snapshot: gameWorldToSnapshot(world),
  };
}

/**
 * Validate and enqueue a player command, spending coins for build commands and refunding on failure.
 */
export async function applyCommand(
  envelope: CommandEnvelope,
  playerIdOverride?: string
): Promise<CommandResponse> {
  const nowMs = Date.now();
  let spentBuildCoins = 0;

  const resolvePlayerId = async () => playerIdOverride ?? getPlayerId();

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
    const coinCost = structures.reduce(
      (total, structure) => total + getStructureCoinCost(structure.type),
      0
    );
    const playerId = (await resolvePlayerId()) as T2;
    const spendResult = await spendUserCoins(playerId, coinCost);
    if (!spendResult.success) {
      const world = await loadWorldState();
      return {
        type: 'commandAck',
        accepted: false,
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        reason: 'not enough coins',
      };
    }
    spentBuildCoins = coinCost;
  }

  const enqueueResult = await enqueueCommand(nowMs, envelope);
  if (!enqueueResult.accepted) {
    if (spentBuildCoins > 0) {
      const playerId = (await resolvePlayerId()) as T2;
      await addUserCoins(playerId, spentBuildCoins);
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
}

/**
 * Update a player's presence timestamp and optional position, returning current wave state.
 */
export async function heartbeatGame(
  playerId: string,
  position?: { x: number; z: number }
): Promise<HeartbeatResponse> {
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
    wave: world.wave.wave,
    waveActive: world.wave.active,
    nextWaveAtMs: world.wave.nextWaveAtMs,
  };
}

/**
 * Get a player's current coin balance (with accrual applied).
 */
export async function getCoinBalance(
  playerIdOverride?: string
): Promise<number> {
  const playerId = (playerIdOverride ?? (await getPlayerId())) as T2;
  return getUserCoinBalance(playerId);
}

export type GamePreview = {
  wave: number;
  mobsLeft: number;
  playerCount: number;
};

/**
 * Return a lightweight preview of the game state for the splash screen.
 */
export async function getGamePreview(): Promise<GamePreview> {
  const world = await loadWorldState();
  return {
    wave: world.wave.wave,
    mobsLeft: Object.keys(world.mobs).length,
    playerCount: Object.keys(world.players).length,
  };
}

/**
 * Return a full world snapshot for client resynchronization, healing the static map if needed.
 */
export async function resyncGame(
  playerIdOverride?: string
): Promise<ResyncResponse> {
  const world = await loadGameWorld();
  const staticSync = ensureStaticMap(world);
  if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
    await flushGameWorld(world);
  }
  const playerId = (playerIdOverride ?? (await getPlayerId())) as T2;
  world.meta.coins = await getUserCoinBalance(playerId);
  return {
    type: 'snapshot',
    snapshot: gameWorldToSnapshot(world),
  };
}

/**
 * Reset the game to initial state, preserving the caller's coin balance, and broadcast a resync event.
 */
export async function resetGame(playerIdOverride?: string): Promise<{
  tickSeq: number;
  worldVersion: number;
}> {
  const nowMs = Date.now();
  const playerId = (playerIdOverride ?? (await getPlayerId())) as T2;
  await resetGameState(nowMs, playerId);
  const world = await loadWorldState();
  await broadcast(world.meta.worldVersion, world.meta.tickSeq, [
    {
      type: 'resyncRequired',
      reason: 'game reset',
    },
  ]);
  return {
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
  };
}

import { reddit } from '@devvit/web/server';
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
import { getStructureEnergyCost } from '../../shared/content';
import { MAX_PLAYERS, PLAYER_TIMEOUT_MS } from './config';
import { getGameChannelName } from './keys';
import { getCoins, spendCoins, addCoins } from './economy';
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

const getPlayerId = async (): Promise<string> => {
  const username = await reddit.getCurrentUsername();
  if (!username) return `anon-${Date.now()}`;
  return username.toLowerCase();
};

export const joinGame = async (): Promise<JoinResponse> => {
  const nowMs = Date.now();
  await removeOldPlayersByLastSeen(nowMs - PLAYER_TIMEOUT_MS, MAX_PLAYERS);
  const world = await loadGameWorld();
  ensureStaticMap(world);
  if (world.players.size >= MAX_PLAYERS) {
    throw new Error('game is full');
  }

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const playerId = await getPlayerId();
  const existing = world.players.get(playerId);
  const player: PlayerState =
    existing ?? createDefaultPlayer(playerId, username, nowMs);
  player.username = username;
  player.position = { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z };
  player.velocity = { x: 0, z: 0 };
  player.lastSeenMs = nowMs;
  world.players.set(playerId, player);
  await touchPlayerPresence(player);
  const coins = await getCoins(nowMs);
  world.meta.energy = coins;

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
    channel: getGameChannelName(),
    snapshot: gameWorldToSnapshot(world),
  };
};

export const applyCommand = async (
  envelope: CommandEnvelope
): Promise<CommandResponse> => {
  const nowMs = Date.now();
  let spentBuildCoins = 0;

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
    wave: world.wave.wave,
    waveActive: world.wave.active,
    nextWaveAtMs: world.wave.nextWaveAtMs,
  };
};

export const getCoinBalance = async (): Promise<number> => getCoins(Date.now());

export type GamePreview = {
  wave: number;
  mobsLeft: number;
  playerCount: number;
};

export const getGamePreview = async (): Promise<GamePreview> => {
  const world = await loadWorldState();
  return {
    wave: world.wave.wave,
    mobsLeft: Object.keys(world.mobs).length,
    playerCount: Object.keys(world.players).length,
  };
};

export const resyncGame = async (
  _playerId?: string
): Promise<ResyncResponse> => {
  const world = await loadGameWorld();
  const staticSync = ensureStaticMap(world);
  if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
    await flushGameWorld(world);
  }
  world.meta.energy = await getCoins(Date.now());
  return {
    type: 'snapshot',
    snapshot: gameWorldToSnapshot(world),
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
      reason: 'game reset',
    },
  ]);
  return {
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
  };
};

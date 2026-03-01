import { reddit, redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import type {
  CommandEnvelope,
  CommandResponse,
  GameDelta,
  HeartbeatResponse,
  JoinResponse,
  MetaSyncResponse,
  ResyncResponse,
  StructuresSyncResponse,
} from '../../shared/game-protocol';
import {
  DEFAULT_PLAYER_SPAWN,
  type StructureState,
  type PlayerState,
} from '../../shared/game-state';
import { getStructureCoinCost } from '../../shared/content';
import { MAX_PLAYERS } from '../config';
import { broadcast, CHANNELS } from '../core/broadcast';
import { KEYS } from '../core/keys';
import { addUserCoins, getUserCoinBalance, spendUserCoins } from './economy';
import {
  createDefaultPlayer,
  enforceStructureCap,
  touchPlayerPresence,
} from './players';
import { enqueueCommand } from '../simulation/queue';
import { loadWorldState, resetGameToDefault } from './persistence';
import {
  flushGameWorld,
  gameWorldToSnapshot,
  loadGameWorld,
} from './trackedState';
import { ensureStaticMap } from './staticMap';
import {
  ensureInitialWaveSchedule,
  ensureWaveSpawnersPrepared,
} from '../simulation/waves';
import { parseMapFromHash, parseMeta, parseStructure } from './parse';

export async function getPlayerId(): Promise<string> {
  const username = await reddit.getCurrentUsername();
  if (!username) return `anon-${Date.now()}`;
  return username.toLowerCase();
}

export async function joinGame(
  playerIdOverride?: string
): Promise<JoinResponse> {
  const nowMs = Date.now();
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
  player.target = undefined;
  player.lastSeenMs = nowMs;
  world.players.set(playerId, player);
  await touchPlayerPresence(player);
  await redis.hDel(KEYS.PLAYER_COMMAND_SEQ, [playerId]);
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

export async function applyCommand(
  envelope: CommandEnvelope,
  playerIdOverride?: string
): Promise<CommandResponse> {
  const nowMs = Date.now();
  let spentBuildCoins = 0;

  const resolvePlayerId = async () => playerIdOverride ?? getPlayerId();

  const playerId = await resolvePlayerId();
  const lastSeqRaw = await redis.hGet(KEYS.PLAYER_COMMAND_SEQ, playerId);
  const lastSeq = lastSeqRaw ? Number(lastSeqRaw) : 0;
  if (envelope.seq > 0 && envelope.seq <= lastSeq) {
    const world = await loadWorldState();
    return {
      type: 'commandAck',
      accepted: false,
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      reason: 'duplicate',
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
    const coinCost = structures.reduce(
      (total, structure) => total + getStructureCoinCost(structure.type),
      0
    );
    const spendResult = await spendUserCoins(playerId as T2, coinCost);
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
      await addUserCoins(playerId as T2, spentBuildCoins);
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

  if (envelope.seq > 0) {
    await redis.hSet(KEYS.PLAYER_COMMAND_SEQ, {
      [playerId]: String(envelope.seq),
    });
  }

  const world = await loadWorldState();
  return {
    type: 'commandAck',
    accepted: true,
    tickSeq: world.meta.tickSeq,
    worldVersion: world.meta.worldVersion,
  };
}

const HEARTBEAT_STALE_MS = 30_000;

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

  if (nowMs - world.meta.lastTickMs > HEARTBEAT_STALE_MS) {
    await broadcast(world.meta.worldVersion, world.meta.tickSeq, [
      { type: 'resyncRequired', reason: 'stale world' },
    ]);
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

export async function getGamePreview(): Promise<GamePreview> {
  const world = await loadWorldState();
  return {
    wave: world.wave.wave,
    mobsLeft: Object.keys(world.mobs).length,
    playerCount: Object.keys(world.players).length,
  };
}

export async function getStructuresSync(): Promise<StructuresSyncResponse> {
  const [structuresRaw, metaRaw] = await Promise.all([
    redis.hGetAll(KEYS.STRUCTURES),
    redis.hGetAll(KEYS.META),
  ]);
  const structures = parseMapFromHash<StructureState>(
    structuresRaw,
    parseStructure
  );
  const meta = parseMeta(metaRaw);
  return {
    type: 'structures',
    structures,
    structureChangeSeq: meta.lastStructureChangeTickSeq ?? 0,
  };
}

export async function getMetaSync(): Promise<MetaSyncResponse> {
  const metaRaw = await redis.hGetAll(KEYS.META);
  return {
    type: 'meta',
    meta: parseMeta(metaRaw),
  };
}

export async function resyncGame(
  playerIdOverride?: string
): Promise<ResyncResponse> {
  const world = await loadGameWorld();
  const staticSync = ensureStaticMap(world);
  ensureWaveSpawnersPrepared(world);
  if (staticSync.upserts.length > 0 || staticSync.removes.length > 0) {
    await flushGameWorld(world);
  }
  const playerId = (playerIdOverride ?? (await getPlayerId())) as T2;
  world.meta.coins = await getUserCoinBalance(playerId);
  const resetReason = await redis.get(KEYS.LAST_RESET_REASON);
  if (resetReason) {
    await redis.del(KEYS.LAST_RESET_REASON);
  }
  const response: ResyncResponse = {
    type: 'snapshot',
    snapshot: gameWorldToSnapshot(world),
  };
  if (resetReason) {
    response.resetReason = resetReason;
  }
  return response;
}

export async function resetGame(playerIdOverride?: string): Promise<{
  tickSeq: number;
  worldVersion: number;
}> {
  const nowMs = Date.now();
  const playerId = (playerIdOverride ?? (await getPlayerId())) as T2;
  await resetGameToDefault(nowMs, {
    reason: 'menu',
    connectedPlayerIds: [],
    primaryUserId: playerId,
  });
  const world = await loadGameWorld();
  ensureStaticMap(world);
  ensureInitialWaveSchedule(world);
  world.waveDirty = true;
  await flushGameWorld(world);
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

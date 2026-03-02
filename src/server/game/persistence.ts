import { redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import type {
  MobState,
  PlayerIntent,
  PlayerState,
  StructureState,
  WorldState,
} from '../../shared/game-state';
import { DEFAULT_PLAYER_SPAWN } from '../../shared/game-state';
import { PLAYER_TIMEOUT_MS } from '../config';
import { KEYS } from '../core/keys';
import { applyCastleDeathTax, getUserCoinBalance } from './economy';
import {
  defaultMeta,
  defaultWave,
  parseMapFromHash,
  parseMeta,
  parseMob,
  parseIntent,
  parseStructure,
  parseWaveState,
} from './parse';
import { buildStaticMapStructures } from './staticMap';
import { loadPlayersFromRedis } from './trackedState';

export async function loadWorldState(): Promise<WorldState> {
  const [metaRaw, intentsRaw, structuresRaw, mobsRaw, waveRaw, playersResult] =
    await Promise.all([
      redis.hGetAll(KEYS.META),
      redis.hGetAll(KEYS.INTENTS),
      redis.hGetAll(KEYS.STRUCTURES),
      redis.hGetAll(KEYS.MOBS),
      redis.get(KEYS.WAVE),
      loadPlayersFromRedis(),
    ]);

  const players: Record<string, PlayerState> = {};
  for (const [id, p] of playersResult.players) {
    players[id] = p;
  }

  return {
    meta: parseMeta(metaRaw),
    players,
    intents: parseMapFromHash<PlayerIntent>(intentsRaw, parseIntent),
    structures: parseMapFromHash<StructureState>(structuresRaw, parseStructure),
    mobs: parseMapFromHash<MobState>(mobsRaw, parseMob),
    wave: parseWaveState(waveRaw ?? undefined),
  };
}

export async function persistWorldState(world: WorldState): Promise<void> {
  const metaWrites: Record<string, string> = {
    tickSeq: String(world.meta.tickSeq),
    worldVersion: String(world.meta.worldVersion),
    lastTickMs: String(world.meta.lastTickMs),
    lastStructureChangeTickSeq: String(
      world.meta.lastStructureChangeTickSeq ?? 0
    ),
    seed: String(world.meta.seed),
    coins: String(world.meta.coins),
    lives: String(world.meta.lives),
    nextMobSeq: String(world.meta.nextMobSeq),
  };

  const playerTtlSeconds = Math.ceil(PLAYER_TIMEOUT_MS / 1000);

  const intentsWrites: Record<string, string> = {};
  for (const [playerId, intent] of Object.entries(world.intents)) {
    intentsWrites[playerId] = JSON.stringify(intent);
  }

  const structureWrites: Record<string, string> = {};
  for (const [structureId, structure] of Object.entries(world.structures)) {
    structureWrites[structureId] = JSON.stringify(structure);
  }

  const mobWrites: Record<string, string> = {};
  for (const [mobId, mob] of Object.entries(world.mobs)) {
    mobWrites[mobId] = JSON.stringify(mob);
  }

  await clearPlayerKeys();
  const exp = new Date(Date.now() + playerTtlSeconds * 1000);
  for (const [playerId, player] of Object.entries(world.players)) {
    await redis.set(KEYS.playerPresence(playerId), JSON.stringify(player), {
      expiration: exp,
    });
    await redis.hSet(KEYS.PLAYER_IDS, { [playerId]: '1' });
  }

  await Promise.all([
    redis.hSet(KEYS.META, metaWrites),
    redis.del(KEYS.INTENTS),
    redis.del(KEYS.STRUCTURES),
    redis.del(KEYS.MOBS),
    redis.set(KEYS.WAVE, JSON.stringify(world.wave)),
  ]);

  await Promise.all([
    Object.keys(intentsWrites).length > 0
      ? redis.hSet(KEYS.INTENTS, intentsWrites)
      : Promise.resolve(),
    Object.keys(structureWrites).length > 0
      ? redis.hSet(KEYS.STRUCTURES, structureWrites)
      : Promise.resolve(),
    Object.keys(mobWrites).length > 0
      ? redis.hSet(KEYS.MOBS, mobWrites)
      : Promise.resolve(),
  ]);
}

async function clearPlayerKeys(): Promise<void> {
  const idsRecord = await redis.hGetAll(KEYS.PLAYER_IDS);
  const ids = Object.keys(idsRecord ?? {});
  await Promise.all([
    ...ids.map((id: string) => redis.del(KEYS.playerPresence(id))),
    redis.del(KEYS.PLAYER_IDS),
  ]);
}

export type ResetOptions = {
  reason: 'menu' | 'castle_death';
  connectedPlayerIds: string[];
  primaryUserId?: T2;
};

export async function resetGameToDefault(
  nowMs: number,
  options: ResetOptions
): Promise<void> {
  const { reason, connectedPlayerIds, primaryUserId } = options;

  let coinsForMeta = 0;
  const playersToPreserve: PlayerState[] = [];

  if (reason === 'menu') {
    const userId = primaryUserId;
    coinsForMeta = userId ? await getUserCoinBalance(userId) : 0;
  } else {
    await applyCastleDeathTax();
    const playersResult = await loadPlayersFromRedis();

    for (const playerId of connectedPlayerIds) {
      const player = playersResult.players.get(playerId);
      if (!player) continue;
      const updated: PlayerState = {
        ...player,
        position: { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z },
        target: undefined,
        lastSeenMs: nowMs,
      };
      playersToPreserve.push(updated);
    }
    const firstId = connectedPlayerIds[0];
    coinsForMeta = firstId ? await getUserCoinBalance(firstId as T2) : 0;
  }

  const nextMeta = defaultMeta(nowMs, coinsForMeta);
  const staticStructures = buildStaticMapStructures(nowMs);
  const structureWrites: Record<string, string> = {};
  for (const [structureId, structure] of Object.entries(staticStructures)) {
    structureWrites[structureId] = JSON.stringify(structure);
  }

  await clearPlayerKeys();

  if (reason === 'castle_death' && playersToPreserve.length > 0) {
    const exp = new Date(
      Date.now() + Math.ceil(PLAYER_TIMEOUT_MS / 1000) * 1000
    );
    for (const player of playersToPreserve) {
      await redis.set(
        KEYS.playerPresence(player.playerId),
        JSON.stringify(player),
        {
          expiration: exp,
        }
      );
      await redis.hSet(KEYS.PLAYER_IDS, { [player.playerId]: '1' });
    }
  }

  await Promise.all([
    redis.hSet(KEYS.META, {
      tickSeq: String(nextMeta.tickSeq),
      worldVersion: String(nextMeta.worldVersion),
      lastTickMs: String(nextMeta.lastTickMs),
      lastStructureChangeTickSeq: String(
        nextMeta.lastStructureChangeTickSeq ?? 0
      ),
      seed: String(nextMeta.seed),
      coins: String(nextMeta.coins),
      lives: String(nextMeta.lives),
    }),
    redis.set(KEYS.WAVE, JSON.stringify(defaultWave())),
    redis.del(KEYS.INTENTS),
    redis.del(KEYS.STRUCTURES),
    redis.del(KEYS.MOBS),
    redis.del(KEYS.QUEUE),
    redis.del(KEYS.SNAPS),
    redis.del(KEYS.LEADER_LOCK),
  ]);
  if (Object.keys(structureWrites).length > 0) {
    await redis.hSet(KEYS.STRUCTURES, structureWrites);
  }
  const resetReason = reason === 'castle_death' ? 'castle death' : 'game reset';
  await redis.set(KEYS.LAST_RESET_REASON, resetReason);
}

export async function resetGameState(nowMs: number, userId: T2): Promise<void> {
  await resetGameToDefault(nowMs, {
    reason: 'menu',
    connectedPlayerIds: [],
    primaryUserId: userId,
  });
}

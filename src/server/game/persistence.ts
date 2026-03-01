import { redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import type {
  MobState,
  PlayerIntent,
  PlayerState,
  StructureState,
  WorldState,
} from '../../shared/game-state';
import { KEYS } from '../core/keys';
import { getUserCoinBalance } from './economy';
import {
  defaultMeta,
  defaultWave,
  parseMapFromHash,
  parseMeta,
  parseMob,
  parsePlayerState,
  parseIntent,
  parseStructure,
  parseWaveState,
} from './parse';
import { buildStaticMapStructures } from './staticMap';

export async function loadWorldState(): Promise<WorldState> {
  const [metaRaw, playersRaw, intentsRaw, structuresRaw, mobsRaw, waveRaw] =
    await Promise.all([
      redis.hGetAll(KEYS.META),
      redis.hGetAll(KEYS.PLAYERS),
      redis.hGetAll(KEYS.INTENTS),
      redis.hGetAll(KEYS.STRUCTURES),
      redis.hGetAll(KEYS.MOBS),
      redis.get(KEYS.WAVE),
    ]);

  return {
    meta: parseMeta(metaRaw),
    players: parseMapFromHash<PlayerState>(playersRaw, parsePlayerState),
    intents: parseMapFromHash<PlayerIntent>(intentsRaw, parseIntent),
    structures: parseMapFromHash<StructureState>(
      structuresRaw,
      parseStructure
    ),
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

  const playersWrites: Record<string, string> = {};
  for (const [playerId, player] of Object.entries(world.players)) {
    playersWrites[playerId] = JSON.stringify(player);
  }

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

  await Promise.all([
    redis.hSet(KEYS.META, metaWrites),
    redis.del(KEYS.PLAYERS),
    redis.del(KEYS.INTENTS),
    redis.del(KEYS.STRUCTURES),
    redis.del(KEYS.MOBS),
    redis.set(KEYS.WAVE, JSON.stringify(world.wave)),
  ]);

  await Promise.all([
    Object.keys(playersWrites).length > 0
      ? redis.hSet(KEYS.PLAYERS, playersWrites)
      : Promise.resolve(),
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

export async function cleanupStalePlayersSeen(
  playerIds: string[]
): Promise<void> {
  if (playerIds.length === 0) return;
  await redis.zRem(KEYS.SEEN, playerIds);
}

export async function resetGameState(
  nowMs: number,
  userId: T2
): Promise<void> {
  const preservedCoins = await getUserCoinBalance(userId);
  const nextMeta = defaultMeta(nowMs, preservedCoins);

  const staticStructures = buildStaticMapStructures(nowMs);
  const structureWrites: Record<string, string> = {};
  for (const [structureId, structure] of Object.entries(staticStructures)) {
    structureWrites[structureId] = JSON.stringify(structure);
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
    redis.del(KEYS.PLAYERS),
    redis.del(KEYS.INTENTS),
    redis.del(KEYS.STRUCTURES),
    redis.del(KEYS.MOBS),
    redis.del(KEYS.QUEUE),
    redis.del(KEYS.SEEN),
    redis.del(KEYS.SNAPS),
    redis.del(KEYS.LEADER_LOCK),
  ]);
  if (Object.keys(structureWrites).length > 0) {
    await redis.hSet(KEYS.STRUCTURES, structureWrites);
  }
}

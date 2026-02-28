import { redis } from '@devvit/web/server';
import { ENERGY_CAP } from '../../shared/content';
import type {
  MobState,
  PlayerIntent,
  PlayerState,
  StructureState,
  WaveState,
  WorldMeta,
  WorldState,
} from '../../shared/game-state';
import { isRecord } from '../../shared/utils';
import { buildStaticMapStructures } from '../../shared/world/staticStructures';
import { getCoins } from '../economy';
import type { DirtyTracker } from './dirtyTracker';
import { resetDirtyTracker } from './dirtyTracker';
import { getGameRedisKeys } from './keys';
import {
  defaultMeta,
  defaultWave,
  parseIntent,
  parseJson,
  parseMapFromHash,
  parseMob,
  parsePlayerState,
  parseStructure,
  parseVec2,
  toJson,
} from './parsers';

export const loadWorldState = async (): Promise<WorldState> => {
  const keys = getGameRedisKeys();
  const [metaRaw, playersRaw, intentsRaw, structuresRaw, mobsRaw, waveRaw] =
    await Promise.all([
      redis.hGetAll(keys.meta),
      redis.hGetAll(keys.players),
      redis.hGetAll(keys.intents),
      redis.hGetAll(keys.structures),
      redis.hGetAll(keys.mobs),
      redis.get(keys.wave),
    ]);

  const now = Date.now();
  const meta: WorldMeta = {
    tickSeq: Number(metaRaw?.tickSeq ?? '0'),
    worldVersion: Number(metaRaw?.worldVersion ?? '0'),
    lastTickMs: Number(metaRaw?.lastTickMs ?? String(now)),
    lastStructureChangeTickSeq: Number(
      metaRaw?.lastStructureChangeTickSeq ?? '0'
    ),
    seed: Number(metaRaw?.seed ?? String(now)),
    energy: Math.max(
      0,
      Math.min(ENERGY_CAP, Number(metaRaw?.energy ?? String(ENERGY_CAP)))
    ),
    lives: Number(metaRaw?.lives ?? '1'),
    nextMobSeq: Number(metaRaw?.nextMobSeq ?? '1'),
  };

  const players = parseMapFromHash<PlayerState>(playersRaw, parsePlayerState);
  const intents = parseMapFromHash<PlayerIntent>(intentsRaw, parseIntent);
  const structures = parseMapFromHash<StructureState>(
    structuresRaw,
    parseStructure
  );
  const mobs = parseMapFromHash<MobState>(mobsRaw, parseMob);
  const parsedWave = parseJson(waveRaw ?? undefined);
  const makeDefaultSpawner = (): WaveState['spawners'][number] => ({
    spawnerId: '',
    totalCount: 0,
    spawnedCount: 0,
    aliveCount: 0,
    spawnRatePerSecond: 0,
    spawnAccumulator: 0,
    gateOpen: false,
    routeState: 'blocked',
    route: [],
  });
  const wave: WaveState = isRecord(parsedWave)
    ? {
        wave: Number(parsedWave.wave ?? 0),
        active: Boolean(parsedWave.active ?? false),
        nextWaveAtMs: Number(parsedWave.nextWaveAtMs ?? 0),
        spawners: Array.isArray(parsedWave.spawners)
          ? parsedWave.spawners.map((entry) => {
              if (!isRecord(entry)) return makeDefaultSpawner();
              const rawRoute = Array.isArray(entry.route) ? entry.route : [];
              const routeState: WaveState['spawners'][number]['routeState'] =
                entry.routeState === 'reachable' ||
                entry.routeState === 'unstable'
                  ? entry.routeState
                  : 'blocked';
              return {
                spawnerId: String(entry.spawnerId ?? ''),
                totalCount: Number(entry.totalCount ?? 0),
                spawnedCount: Number(entry.spawnedCount ?? 0),
                aliveCount: Number(entry.aliveCount ?? 0),
                spawnRatePerSecond: Number(entry.spawnRatePerSecond ?? 0),
                spawnAccumulator: Number(entry.spawnAccumulator ?? 0),
                gateOpen: Boolean(entry.gateOpen ?? false),
                routeState,
                route: rawRoute.map((point) => parseVec2(point)),
              };
            })
          : [],
      }
    : defaultWave();

  return { meta, players, intents, structures, mobs, wave };
};

export const persistWorldState = async (world: WorldState): Promise<void> => {
  const keys = getGameRedisKeys();
  const metaWrites: Record<string, string> = {
    tickSeq: String(world.meta.tickSeq),
    worldVersion: String(world.meta.worldVersion),
    lastTickMs: String(world.meta.lastTickMs),
    lastStructureChangeTickSeq: String(
      world.meta.lastStructureChangeTickSeq ?? 0
    ),
    seed: String(world.meta.seed),
    energy: String(world.meta.energy),
    lives: String(world.meta.lives),
    nextMobSeq: String(world.meta.nextMobSeq),
  };

  const playersWrites: Record<string, string> = {};
  for (const [playerId, player] of Object.entries(world.players)) {
    playersWrites[playerId] = toJson(player);
  }

  const intentsWrites: Record<string, string> = {};
  for (const [playerId, intent] of Object.entries(world.intents)) {
    intentsWrites[playerId] = toJson(intent);
  }

  const structureWrites: Record<string, string> = {};
  for (const [structureId, structure] of Object.entries(world.structures)) {
    structureWrites[structureId] = toJson(structure);
  }

  const mobWrites: Record<string, string> = {};
  for (const [mobId, mob] of Object.entries(world.mobs)) {
    mobWrites[mobId] = toJson(mob);
  }

  await Promise.all([
    redis.hSet(keys.meta, metaWrites),
    redis.del(keys.players),
    redis.del(keys.intents),
    redis.del(keys.structures),
    redis.del(keys.mobs),
    redis.set(keys.wave, toJson(world.wave)),
  ]);

  await Promise.all([
    Object.keys(playersWrites).length > 0
      ? redis.hSet(keys.players, playersWrites)
      : Promise.resolve(),
    Object.keys(intentsWrites).length > 0
      ? redis.hSet(keys.intents, intentsWrites)
      : Promise.resolve(),
    Object.keys(structureWrites).length > 0
      ? redis.hSet(keys.structures, structureWrites)
      : Promise.resolve(),
    Object.keys(mobWrites).length > 0
      ? redis.hSet(keys.mobs, mobWrites)
      : Promise.resolve(),
  ]);
};

export const persistDirtyState = async (
  world: WorldState,
  tracker: DirtyTracker
): Promise<void> => {
  const keys = getGameRedisKeys();
  const ops: Promise<unknown>[] = [];

  ops.push(
    redis.hSet(keys.meta, {
      tickSeq: String(world.meta.tickSeq),
      worldVersion: String(world.meta.worldVersion),
      lastTickMs: String(world.meta.lastTickMs),
      lastStructureChangeTickSeq: String(
        world.meta.lastStructureChangeTickSeq ?? 0
      ),
      seed: String(world.meta.seed),
      energy: String(world.meta.energy),
      lives: String(world.meta.lives),
      nextMobSeq: String(world.meta.nextMobSeq),
    })
  );

  if (tracker.allMobsDirty) {
    const mobWrites: Record<string, string> = {};
    for (const [mobId, mob] of Object.entries(world.mobs)) {
      mobWrites[mobId] = toJson(mob);
    }
    if (Object.keys(mobWrites).length > 0) {
      ops.push(redis.hSet(keys.mobs, mobWrites));
    }
  }
  if (tracker.removedMobIds.size > 0) {
    ops.push(redis.hDel(keys.mobs, Array.from(tracker.removedMobIds)));
  }

  if (tracker.structures.upserted.size > 0) {
    const writes: Record<string, string> = {};
    for (const id of tracker.structures.upserted) {
      const structure = world.structures[id];
      if (structure) writes[id] = toJson(structure);
    }
    if (Object.keys(writes).length > 0) {
      ops.push(redis.hSet(keys.structures, writes));
    }
  }
  if (tracker.structures.removed.size > 0) {
    ops.push(
      redis.hDel(keys.structures, Array.from(tracker.structures.removed))
    );
  }

  if (tracker.players.upserted.size > 0) {
    const writes: Record<string, string> = {};
    for (const id of tracker.players.upserted) {
      const player = world.players[id];
      if (player) writes[id] = toJson(player);
    }
    if (Object.keys(writes).length > 0) {
      ops.push(redis.hSet(keys.players, writes));
    }
  }
  if (tracker.players.removed.size > 0) {
    ops.push(redis.hDel(keys.players, Array.from(tracker.players.removed)));
  }

  if (tracker.intents.upserted.size > 0) {
    const writes: Record<string, string> = {};
    for (const id of tracker.intents.upserted) {
      const intent = world.intents[id];
      if (intent) writes[id] = toJson(intent);
    }
    if (Object.keys(writes).length > 0) {
      ops.push(redis.hSet(keys.intents, writes));
    }
  }
  if (tracker.intents.removed.size > 0) {
    ops.push(redis.hDel(keys.intents, Array.from(tracker.intents.removed)));
  }

  if (tracker.waveDirty) {
    ops.push(redis.set(keys.wave, toJson(world.wave)));
  }

  await Promise.all(ops);
  resetDirtyTracker(tracker);
};

export const mergePlayersFromRedis = async (
  world: WorldState
): Promise<void> => {
  const keys = getGameRedisKeys();
  const [playersRaw, intentsRaw] = await Promise.all([
    redis.hGetAll(keys.players),
    redis.hGetAll(keys.intents),
  ]);

  if (playersRaw) {
    for (const [playerId, encoded] of Object.entries(playersRaw)) {
      const redisPlayer = parsePlayerState(parseJson(encoded));
      if (!world.players[playerId]) {
        world.players[playerId] = redisPlayer;
      } else {
        world.players[playerId].lastSeenMs = Math.max(
          world.players[playerId].lastSeenMs,
          redisPlayer.lastSeenMs
        );
      }
    }
  }

  if (intentsRaw) {
    for (const [playerId, encoded] of Object.entries(intentsRaw)) {
      if (!world.intents[playerId]) {
        world.intents[playerId] = parseIntent(parseJson(encoded));
      }
    }
  }
};

export const findAndRemoveStalePlayersInMemory = (
  world: WorldState,
  cutoffMs: number,
  limit: number
): string[] => {
  const stale: string[] = [];
  for (const player of Object.values(world.players)) {
    if (player.lastSeenMs < cutoffMs) {
      stale.push(player.playerId);
      if (stale.length >= limit) break;
    }
  }
  for (const id of stale) {
    delete world.players[id];
    delete world.intents[id];
  }
  return stale;
};

export const cleanupStalePlayersSeen = async (
  playerIds: string[]
): Promise<void> => {
  if (playerIds.length === 0) return;
  const keys = getGameRedisKeys();
  await redis.zRem(keys.seen, playerIds);
};

export const resetGameState = async (nowMs: number): Promise<void> => {
  const keys = getGameRedisKeys();
  const preservedCoins = await getCoins(nowMs);
  const nextMeta = defaultMeta(nowMs, preservedCoins);

  const staticStructures = buildStaticMapStructures(nowMs);
  const structureWrites: Record<string, string> = {};
  for (const [structureId, structure] of Object.entries(staticStructures)) {
    structureWrites[structureId] = toJson(structure);
  }

  await Promise.all([
    redis.hSet(keys.meta, {
      tickSeq: String(nextMeta.tickSeq),
      worldVersion: String(nextMeta.worldVersion),
      lastTickMs: String(nextMeta.lastTickMs),
      lastStructureChangeTickSeq: String(
        nextMeta.lastStructureChangeTickSeq ?? 0
      ),
      seed: String(nextMeta.seed),
      energy: String(nextMeta.energy),
      lives: String(nextMeta.lives),
    }),
    redis.set(keys.wave, toJson(defaultWave())),
    redis.del(keys.players),
    redis.del(keys.intents),
    redis.del(keys.structures),
    redis.del(keys.mobs),
    redis.del(keys.queue),
    redis.del(keys.seen),
    redis.del(keys.rate),
    redis.del(keys.snaps),
    redis.del(keys.leaderLock),
  ]);
  if (Object.keys(structureWrites).length > 0) {
    await redis.hSet(keys.structures, structureWrites);
  }
};

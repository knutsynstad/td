import { redis } from '@devvit/web/server';
import { ENERGY_CAP } from '../../shared/content';
import type {
  GameWorld,
  MobState,
  PlayerIntent,
  PlayerState,
  StructureState,
  WaveState,
  WorldMeta,
  WorldState,
} from '../../shared/game-state';
import { parseVec2 } from '../../shared/game-state';
import { isRecord, safeParseJson } from '../../shared/utils';
import { TrackedMap } from '../../shared/utils/trackedMap';
import { getGameRedisKeys } from './keys';
import { parseIntent, parsePlayerState } from './players';
import {
  defaultWave,
  parseMob,
  parseStructure,
} from './world';

const parseTrackedMapFromHash = <T>(
  raw: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): TrackedMap<T> => {
  const map = new TrackedMap<T>();
  if (!raw) return map;
  for (const [key, encoded] of Object.entries(raw)) {
    Map.prototype.set.call(map, key, parser(safeParseJson(encoded)));
  }
  return map;
};

const parseWaveState = (waveRaw: string | undefined): WaveState => {
  const parsed = safeParseJson(waveRaw);
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
  if (!isRecord(parsed)) return defaultWave();
  return {
    wave: Number(parsed.wave ?? 0),
    active: Boolean(parsed.active ?? false),
    nextWaveAtMs: Number(parsed.nextWaveAtMs ?? 0),
    spawners: Array.isArray(parsed.spawners)
      ? parsed.spawners.map((entry) => {
          if (!isRecord(entry)) return makeDefaultSpawner();
          const rawRoute = Array.isArray(entry.route) ? entry.route : [];
          const routeState: WaveState['spawners'][number]['routeState'] =
            entry.routeState === 'reachable' || entry.routeState === 'unstable'
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
  };
};

export const loadGameWorld = async (): Promise<GameWorld> => {
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

  return {
    meta,
    players: parseTrackedMapFromHash<PlayerState>(playersRaw, parsePlayerState),
    intents: parseTrackedMapFromHash<PlayerIntent>(intentsRaw, parseIntent),
    structures: parseTrackedMapFromHash<StructureState>(
      structuresRaw,
      parseStructure
    ),
    mobs: parseTrackedMapFromHash<MobState>(mobsRaw, parseMob),
    wave: parseWaveState(waveRaw ?? undefined),
    waveDirty: false,
  };
};

export const flushGameWorld = async (world: GameWorld): Promise<void> => {
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

  const flushCollection = (
    redisKey: string,
    map: Map<string, unknown> & {
      upserted: ReadonlySet<string>;
      removed: ReadonlySet<string>;
      resetTracking(): void;
    }
  ) => {
    if (map.upserted.size > 0) {
      const writes: Record<string, string> = {};
      for (const id of map.upserted) {
        const value = map.get(id);
        if (value !== undefined) writes[id] = JSON.stringify(value);
      }
      if (Object.keys(writes).length > 0) {
        ops.push(redis.hSet(redisKey, writes));
      }
    }
    if (map.removed.size > 0) {
      ops.push(redis.hDel(redisKey, Array.from(map.removed)));
    }
    map.resetTracking();
  };

  flushCollection(keys.mobs, world.mobs as TrackedMap<MobState>);
  flushCollection(keys.structures, world.structures as TrackedMap<StructureState>);
  flushCollection(keys.players, world.players as TrackedMap<PlayerState>);
  flushCollection(keys.intents, world.intents as TrackedMap<PlayerIntent>);

  if (world.waveDirty) {
    ops.push(redis.set(keys.wave, JSON.stringify(world.wave)));
    world.waveDirty = false;
  }

  await Promise.all(ops);
};

export const gameWorldToSnapshot = (world: GameWorld): WorldState => {
  const toRecord = <V>(map: Map<string, V>): Record<string, V> => {
    const record: Record<string, V> = {};
    for (const [key, value] of map.entries()) {
      record[key] = value;
    }
    return record;
  };

  return {
    meta: world.meta,
    players: toRecord(world.players),
    intents: toRecord(world.intents),
    structures: toRecord(world.structures),
    mobs: toRecord(world.mobs),
    wave: world.wave,
  };
};

export const mergePlayersFromRedis = async (
  world: GameWorld
): Promise<void> => {
  const keys = getGameRedisKeys();
  const [playersRaw, intentsRaw] = await Promise.all([
    redis.hGetAll(keys.players),
    redis.hGetAll(keys.intents),
  ]);

  if (playersRaw) {
    for (const [playerId, encoded] of Object.entries(playersRaw)) {
      const redisPlayer = parsePlayerState(safeParseJson(encoded));
      const existing = world.players.get(playerId);
      if (!existing) {
        world.players.set(playerId, redisPlayer);
      } else {
        existing.lastSeenMs = Math.max(existing.lastSeenMs, redisPlayer.lastSeenMs);
      }
    }
  }

  if (intentsRaw) {
    for (const [playerId, encoded] of Object.entries(intentsRaw)) {
      if (!world.intents.has(playerId)) {
        world.intents.set(playerId, parseIntent(safeParseJson(encoded)));
      }
    }
  }
};

export const findAndRemoveStalePlayersInMemory = (
  world: GameWorld,
  cutoffMs: number,
  limit: number
): string[] => {
  const stale: string[] = [];
  for (const player of world.players.values()) {
    if (player.lastSeenMs < cutoffMs) {
      stale.push(player.playerId);
      if (stale.length >= limit) break;
    }
  }
  for (const id of stale) {
    world.players.delete(id);
    world.intents.delete(id);
  }
  return stale;
};

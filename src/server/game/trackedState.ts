import { redis } from '@devvit/web/server';
import type {
  GameWorld,
  MobState,
  PlayerIntent,
  PlayerState,
  StructureState,
  WorldState,
} from '../../shared/game-state';
import { safeParseJson } from '../../shared/utils';
import { TrackedMap } from '../../shared/utils/trackedMap';
import { PLAYER_TIMEOUT_MS } from '../config';
import { KEYS } from '../core/keys';
import {
  parseIntent,
  parseMeta,
  parseMob,
  parsePlayerState,
  parseStructure,
  parseTrackedMapFromHash,
  parseWaveState,
} from './parse';

export async function loadPlayersFromRedis(): Promise<{
  players: Map<string, PlayerState>;
  expiredIds: string[];
}> {
  const idsRecord = await redis.hGetAll(KEYS.PLAYER_IDS);
  const ids = Object.keys(idsRecord ?? {});
  if (ids.length === 0) {
    return { players: new Map(), expiredIds: [] };
  }
  const keys = ids.map((id: string) => KEYS.playerPresence(id));
  const values = await redis.mGet(keys);
  const players = new Map<string, PlayerState>();
  const expiredIds: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const raw = values[i];
    if (!raw) {
      expiredIds.push(ids[i]!);
      continue;
    }
    const player = parsePlayerState(safeParseJson(raw));
    player.playerId = ids[i]!;
    players.set(ids[i]!, player);
  }
  if (expiredIds.length > 0) {
    await redis.hDel(KEYS.PLAYER_IDS, expiredIds);
  }
  return { players, expiredIds };
}

export async function loadGameWorld(): Promise<GameWorld> {
  const [metaRaw, intentsRaw, structuresRaw, mobsRaw, waveRaw, playersResult] =
    await Promise.all([
      redis.hGetAll(KEYS.META),
      redis.hGetAll(KEYS.INTENTS),
      redis.hGetAll(KEYS.STRUCTURES),
      redis.hGetAll(KEYS.MOBS),
      redis.get(KEYS.WAVE),
      loadPlayersFromRedis(),
    ]);

  const players = new TrackedMap<PlayerState>();
  for (const [id, p] of playersResult.players) {
    players.set(id, p);
  }

  return {
    meta: parseMeta(metaRaw),
    players,
    intents: parseTrackedMapFromHash<PlayerIntent>(intentsRaw, parseIntent),
    structures: parseTrackedMapFromHash<StructureState>(
      structuresRaw,
      parseStructure
    ),
    mobs: parseTrackedMapFromHash<MobState>(mobsRaw, parseMob),
    wave: parseWaveState(waveRaw ?? undefined),
    waveDirty: false,
  };
}

export async function flushGameWorld(world: GameWorld): Promise<void> {
  const ops: Promise<unknown>[] = [];

  ops.push(
    redis.hSet(KEYS.META, {
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
    })
  );

  function flushCollection(
    redisKey: string,
    map: Map<string, unknown> & {
      upserted: ReadonlySet<string>;
      removed: ReadonlySet<string>;
      resetTracking(): void;
    }
  ): void {
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
  }

  flushCollection(KEYS.MOBS, world.mobs as TrackedMap<MobState>);
  flushCollection(
    KEYS.STRUCTURES,
    world.structures as TrackedMap<StructureState>
  );

  const playersMap = world.players as TrackedMap<PlayerState>;
  const now = Date.now();
  for (const [playerId, player] of world.players) {
    const expireAt = player.lastSeenMs + PLAYER_TIMEOUT_MS;
    if (expireAt <= now) {
      ops.push(redis.del(KEYS.playerPresence(playerId)));
    } else {
      ops.push(
        redis.set(KEYS.playerPresence(playerId), JSON.stringify(player), {
          expiration: new Date(expireAt),
        })
      );
      ops.push(redis.hSet(KEYS.PLAYER_IDS, { [playerId]: '1' }));
    }
  }
  for (const playerId of playersMap.removed) {
    ops.push(redis.del(KEYS.playerPresence(playerId)));
    ops.push(redis.hDel(KEYS.PLAYER_IDS, [playerId]));
  }
  playersMap.resetTracking();

  flushCollection(KEYS.INTENTS, world.intents as TrackedMap<PlayerIntent>);

  if (world.waveDirty) {
    ops.push(redis.set(KEYS.WAVE, JSON.stringify(world.wave)));
    world.waveDirty = false;
  }

  await Promise.all(ops);
}

export function gameWorldToSnapshot(world: GameWorld): WorldState {
  function toRecord<V>(map: Map<string, V>): Record<string, V> {
    const record: Record<string, V> = {};
    for (const [key, value] of map.entries()) {
      record[key] = value;
    }
    return record;
  }

  return {
    meta: world.meta,
    players: toRecord(world.players),
    intents: toRecord(world.intents),
    structures: toRecord(world.structures),
    mobs: toRecord(world.mobs),
    wave: world.wave,
  };
}

export async function mergePlayersFromRedis(
  world: GameWorld
): Promise<string[]> {
  const { players: redisPlayers, expiredIds } = await loadPlayersFromRedis();

  const leftIds = expiredIds.filter((id) => world.players.has(id));
  for (const id of expiredIds) {
    world.players.delete(id);
    world.intents.delete(id);
  }
  if (expiredIds.length > 0) {
    await redis.hDel(KEYS.INTENTS, expiredIds);
  }

  for (const [playerId, redisPlayer] of redisPlayers) {
    const existing = world.players.get(playerId);
    if (!existing) {
      world.players.set(playerId, redisPlayer);
    } else {
      existing.lastSeenMs = Math.max(
        existing.lastSeenMs,
        redisPlayer.lastSeenMs
      );
    }
  }

  const intentsRaw = await redis.hGetAll(KEYS.INTENTS);
  if (intentsRaw) {
    for (const [playerId, encoded] of Object.entries(intentsRaw)) {
      if (!world.intents.has(playerId)) {
        world.intents.set(playerId, parseIntent(safeParseJson(encoded)));
      }
    }
  }

  return leftIds;
}

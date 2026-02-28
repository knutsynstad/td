import { redis } from '@devvit/web/server';
import { ENERGY_CAP } from '../../shared/content';
import type {
  MobState,
  PlayerIntent,
  PlayerState,
  StructureMetadata,
  StructureState,
  WaveState,
  WorldMeta,
  WorldState,
} from '../../shared/game-state';
import { parseVec2 } from '../../shared/game-state';
import { isRecord, safeParseJson } from '../../shared/utils';
import { buildStaticMapStructures } from '../../shared/world/staticStructures';
import { clampCoins, getCoins } from './economy';
import { getGameRedisKeys } from './keys';
import { parseIntent, parsePlayerState } from './players';

export const parseStructureType = (value: unknown): StructureState['type'] =>
  value === 'tower' || value === 'tree' || value === 'rock' || value === 'bank'
    ? value
    : 'wall';

const parseStructureMetadata = (raw: unknown): StructureMetadata | undefined => {
  if (!isRecord(raw)) return undefined;
  const out: StructureMetadata = {};
  const treeFootprint = Number(raw.treeFootprint ?? 0);
  if (treeFootprint >= 1 && treeFootprint < 2) out.treeFootprint = 1;
  else if (treeFootprint >= 2 && treeFootprint < 3) out.treeFootprint = 2;
  else if (treeFootprint >= 3 && treeFootprint < 4) out.treeFootprint = 3;
  else if (treeFootprint >= 4) out.treeFootprint = 4;
  const rockRaw = raw.rock;
  if (isRecord(rockRaw)) {
    const yawQuarterTurns = Number(rockRaw.yawQuarterTurns ?? 0);
    const modelIndex = Number(rockRaw.modelIndex ?? 0);
    const parsedYaw =
      yawQuarterTurns >= 0 && yawQuarterTurns < 1
        ? 0
        : yawQuarterTurns >= 1 && yawQuarterTurns < 2
          ? 1
          : yawQuarterTurns >= 2 && yawQuarterTurns < 3
            ? 2
            : 3;
    out.rock = {
      footprintX: Math.max(1, Number(rockRaw.footprintX ?? 1)),
      footprintZ: Math.max(1, Number(rockRaw.footprintZ ?? 1)),
      yawQuarterTurns: parsedYaw,
      modelIndex: modelIndex === 1 ? 1 : 0,
      mirrorX: Boolean(rockRaw.mirrorX ?? false),
      mirrorZ: Boolean(rockRaw.mirrorZ ?? false),
      verticalScale: Math.max(0.1, Number(rockRaw.verticalScale ?? 1)),
    };
  }
  if (!out.treeFootprint && !out.rock) return undefined;
  return out;
};

export const parseStructure = (value: unknown): StructureState => {
  if (!isRecord(value)) {
    return {
      structureId: '',
      ownerId: '',
      type: 'wall',
      center: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      createdAtMs: 0,
    };
  }
  return {
    structureId: String(value.structureId ?? ''),
    ownerId: String(value.ownerId ?? ''),
    type:
      value.type === 'tower' ||
      value.type === 'tree' ||
      value.type === 'rock' ||
      value.type === 'bank'
        ? value.type
        : 'wall',
    center: parseVec2(value.center),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    createdAtMs: Number(value.createdAtMs ?? 0),
    metadata: parseStructureMetadata(value.metadata),
  };
};

export const parseMob = (value: unknown): MobState => {
  if (!isRecord(value)) {
    return {
      mobId: '',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      spawnerId: '',
      routeIndex: 0,
      stuckMs: 0,
      lastProgressDistanceToGoal: Number.POSITIVE_INFINITY,
    };
  }
  return {
    mobId: String(value.mobId ?? ''),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    spawnerId: String(value.spawnerId ?? ''),
    routeIndex: Number(value.routeIndex ?? 0),
    stuckMs: Number(value.stuckMs ?? 0),
    lastProgressDistanceToGoal: Number(
      value.lastProgressDistanceToGoal ?? Number.POSITIVE_INFINITY
    ),
  };
};

export const parseMapFromHash = <T>(
  value: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): Record<string, T> => {
  const out: Record<string, T> = {};
  if (!value) return out;
  for (const [field, encoded] of Object.entries(value)) {
    out[field] = parser(safeParseJson(encoded));
  }
  return out;
};

export const defaultWave = (): WaveState => ({
  wave: 0,
  active: false,
  nextWaveAtMs: 0,
  spawners: [],
});

export const defaultMeta = (nowMs: number, energy: number): WorldMeta => ({
  tickSeq: 0,
  worldVersion: 0,
  lastTickMs: nowMs,
  lastStructureChangeTickSeq: 0,
  seed: nowMs,
  energy: clampCoins(energy),
  lives: 1,
  nextMobSeq: 1,
});

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
  const parsedWave = safeParseJson(waveRaw ?? undefined);
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
    redis.hSet(keys.meta, metaWrites),
    redis.del(keys.players),
    redis.del(keys.intents),
    redis.del(keys.structures),
    redis.del(keys.mobs),
    redis.set(keys.wave, JSON.stringify(world.wave)),
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
    structureWrites[structureId] = JSON.stringify(structure);
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
    redis.set(keys.wave, JSON.stringify(defaultWave())),
    redis.del(keys.players),
    redis.del(keys.intents),
    redis.del(keys.structures),
    redis.del(keys.mobs),
    redis.del(keys.queue),
    redis.del(keys.seen),
    redis.del(keys.snaps),
    redis.del(keys.leaderLock),
  ]);
  if (Object.keys(structureWrites).length > 0) {
    await redis.hSet(keys.structures, structureWrites);
  }
};

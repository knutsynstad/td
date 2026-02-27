import { redis } from '@devvit/web/server';
import type { CommandEnvelope } from '../../shared/game-protocol';
import {
  DEFAULT_PLAYER_SPAWN,
  type MobState,
  type PlayerIntent,
  type PlayerState,
  type StructureMetadata,
  type StructureState,
  type WaveState,
  type WorldMeta,
  type WorldState,
} from '../../shared/game-state';
import {
  ENERGY_CAP,
  ENERGY_REGEN_PER_SECOND,
  PLAYER_SPEED,
} from '../../shared/content';
import {
  MAX_COMMANDS_PER_BATCH,
  MAX_QUEUE_COMMANDS,
  MAX_RATE_TOKENS,
  MAX_STRUCTURES,
  RATE_REFILL_PER_SECOND,
} from './config';
import { isRecord } from '../../shared/utils';
import { getEconomyRedisKeys, getGameRedisKeys } from './keys';
import { buildStaticMapStructures } from '../../shared/world/staticStructures';

type RateLimitState = {
  tokens: number;
  lastRefillMs: number;
};

type GlobalCoinState = {
  coins: number;
  lastAccruedMs: number;
};

export type LeaderLockResult = {
  acquired: boolean;
  ownerToken: string;
};

const toJson = (value: unknown): string => JSON.stringify(value);

const parseJson = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const clampCoins = (coins: number): number =>
  Math.max(0, Math.min(ENERGY_CAP, coins));
const MAX_TX_RETRIES = 5;
const economyKeys = getEconomyRedisKeys();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseVec2 = (value: unknown) => {
  if (!isRecord(value)) return { x: 0, z: 0 };
  return {
    x: Number(value.x ?? 0),
    z: Number(value.z ?? 0),
  };
};

const parseStructureType = (value: unknown): StructureState['type'] =>
  value === 'tower' || value === 'tree' || value === 'rock' || value === 'bank'
    ? value
    : 'wall';

const parsePlayerState = (value: unknown): PlayerState => {
  if (!isRecord(value)) {
    return {
      playerId: '',
      username: 'anonymous',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: PLAYER_SPEED,
      lastSeenMs: 0,
    };
  }
  return {
    playerId: String(value.playerId ?? ''),
    username: String(value.username ?? 'anonymous'),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    speed: Number(value.speed ?? PLAYER_SPEED),
    lastSeenMs: Number(value.lastSeenMs ?? 0),
  };
};

const parseIntent = (value: unknown): PlayerIntent => {
  if (!isRecord(value)) {
    return { updatedAtMs: 0 };
  }
  const parsed: PlayerIntent = {
    updatedAtMs: Number(value.updatedAtMs ?? 0),
  };
  if (value.desiredDir) parsed.desiredDir = parseVec2(value.desiredDir);
  if (value.target) parsed.target = parseVec2(value.target);
  return parsed;
};

const parseStructure = (value: unknown): StructureState => {
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
  const parseStructureMetadata = (
    raw: unknown
  ): StructureMetadata | undefined => {
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

const parseMob = (value: unknown): MobState => {
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

const parseMapFromHash = <T>(
  value: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): Record<string, T> => {
  const out: Record<string, T> = {};
  if (!value) return out;
  for (const [field, encoded] of Object.entries(value)) {
    out[field] = parser(parseJson(encoded));
  }
  return out;
};

const parseCommandEnvelope = (value: unknown): CommandEnvelope | undefined => {
  if (!isRecord(value)) return undefined;
  const seq = Number(value.seq ?? -1);
  const sentAtMs = Number(value.sentAtMs ?? 0);
  if (!isRecord(value.command)) return undefined;
  const commandType = String(value.command.type ?? '');
  const playerId = String(value.command.playerId ?? '');
  if (commandType === 'moveIntent') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'moveIntent',
        playerId,
        intent: parseIntent(value.command.intent),
        clientPosition: value.command.clientPosition
          ? parseVec2(value.command.clientPosition)
          : undefined,
      },
    };
  }
  if (commandType === 'buildStructure') {
    const structure = isRecord(value.command.structure)
      ? value.command.structure
      : {};
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructure',
        playerId,
        structure: {
          structureId: String(structure.structureId ?? ''),
          type: parseStructureType(structure.type),
          center: parseVec2(structure.center),
        },
      },
    };
  }
  if (commandType === 'buildStructures') {
    const rawStructures = Array.isArray(value.command.structures)
      ? value.command.structures
      : [];
    const structures = rawStructures
      .filter(isRecord)
      .map((structure) => ({
        structureId: String(structure.structureId ?? ''),
        type: parseStructureType(structure.type),
        center: parseVec2(structure.center),
      }))
      .filter((structure) => structure.structureId.length > 0);
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructures',
        playerId,
        structures,
      },
    };
  }
  if (commandType === 'removeStructure') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'removeStructure',
        playerId,
        structureId: String(value.command.structureId ?? ''),
      },
    };
  }
  if (commandType === 'startWave') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'startWave',
        playerId,
      },
    };
  }
  if (commandType === 'shoot') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'shoot',
        playerId,
        target: parseVec2(value.command.target),
      },
    };
  }
  return undefined;
};

const defaultWave = (): WaveState => ({
  wave: 0,
  active: false,
  nextWaveAtMs: 0,
  spawners: [],
});

const defaultMeta = (nowMs: number, energy: number): WorldMeta => ({
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

export const touchPlayerPresence = async (
  player: PlayerState
): Promise<void> => {
  const keys = getGameRedisKeys();
  await Promise.all([
    redis.hSet(keys.players, { [player.playerId]: toJson(player) }),
    redis.zAdd(keys.seen, {
      member: player.playerId,
      score: player.lastSeenMs,
    }),
  ]);
};

export const getCoins = async (nowMs: number): Promise<number> => {
  const raw = await redis.get(economyKeys.coins);
  const parsed = parseJson(raw ?? undefined);
  const current: GlobalCoinState = isRecord(parsed)
    ? {
        coins: clampCoins(Number(parsed.coins ?? parsed.energy ?? ENERGY_CAP)),
        lastAccruedMs: Number(parsed.lastAccruedMs ?? nowMs),
      }
    : {
        coins: ENERGY_CAP,
        lastAccruedMs: nowMs,
      };
  const elapsedMs = Math.max(0, nowMs - current.lastAccruedMs);
  const regenerated = (elapsedMs / 1000) * ENERGY_REGEN_PER_SECOND;
  return clampCoins(current.coins + regenerated);
};

const parseGlobalCoinState = (
  raw: string | undefined,
  nowMs: number
): GlobalCoinState => {
  const parsed = parseJson(raw ?? undefined);
  if (!isRecord(parsed)) {
    return {
      coins: ENERGY_CAP,
      lastAccruedMs: nowMs,
    };
  }
  return {
    coins: clampCoins(Number(parsed.coins ?? parsed.energy ?? ENERGY_CAP)),
    lastAccruedMs: Number(parsed.lastAccruedMs ?? nowMs),
  };
};

const accrueCoins = (state: GlobalCoinState, nowMs: number): number => {
  const elapsedMs = Math.max(0, nowMs - state.lastAccruedMs);
  const regenerated = (elapsedMs / 1000) * ENERGY_REGEN_PER_SECOND;
  return clampCoins(state.coins + regenerated);
};

const parseCastleCoins = (raw: string | undefined): number => {
  const numeric = Number(raw ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

export const spendCoins = async (
  amount: number,
  nowMs: number
): Promise<{ ok: boolean; coins: number }> => {
  const safeAmount = Math.max(0, amount);
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(economyKeys.coins);
    const current = parseGlobalCoinState(
      await redis.get(economyKeys.coins),
      nowMs
    );
    const accrued = accrueCoins(current, nowMs);
    if (accrued < safeAmount) {
      await tx.unwatch();
      return { ok: false, coins: accrued };
    }
    const nextCoins = clampCoins(accrued - safeAmount);
    await tx.multi();
    await tx.set(
      economyKeys.coins,
      toJson({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    const result = await tx.exec();
    if (result !== null) {
      return { ok: true, coins: nextCoins };
    }
  }
  const fallback = await getCoins(nowMs);
  return { ok: false, coins: fallback };
};

export const addCoins = async (
  amount: number,
  nowMs: number
): Promise<{ added: number; coins: number }> => {
  const safeAmount = Math.max(0, amount);
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(economyKeys.coins);
    const current = parseGlobalCoinState(
      await redis.get(economyKeys.coins),
      nowMs
    );
    const accrued = accrueCoins(current, nowMs);
    const nextCoins = clampCoins(accrued + safeAmount);
    const added = Math.max(0, nextCoins - accrued);
    await tx.multi();
    await tx.set(
      economyKeys.coins,
      toJson({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    const result = await tx.exec();
    if (result !== null) {
      return { added, coins: nextCoins };
    }
  }
  return { added: 0, coins: await getCoins(nowMs) };
};

export const getCastleCoins = async (): Promise<number> =>
  parseCastleCoins(await redis.get(economyKeys.castle));

export const depositCastleCoins = async (
  amount: number,
  nowMs: number
): Promise<{
  ok: boolean;
  deposited: number;
  coins: number;
  castleCoins: number;
}> => {
  const safeAmount = Math.max(0, Math.floor(amount));
  if (safeAmount <= 0) {
    return {
      ok: false,
      deposited: 0,
      coins: await getCoins(nowMs),
      castleCoins: await getCastleCoins(),
    };
  }
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(economyKeys.coins, economyKeys.castle);
    const coinState = parseGlobalCoinState(
      await redis.get(economyKeys.coins),
      nowMs
    );
    const castleCoins = parseCastleCoins(await redis.get(economyKeys.castle));
    const accrued = accrueCoins(coinState, nowMs);
    if (accrued < safeAmount) {
      await tx.unwatch();
      return { ok: false, deposited: 0, coins: accrued, castleCoins };
    }
    const nextCoins = clampCoins(accrued - safeAmount);
    const nextCastleCoins = castleCoins + safeAmount;
    await tx.multi();
    await tx.set(
      economyKeys.coins,
      toJson({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    await tx.set(economyKeys.castle, String(nextCastleCoins));
    const result = await tx.exec();
    if (result !== null) {
      return {
        ok: true,
        deposited: safeAmount,
        coins: nextCoins,
        castleCoins: nextCastleCoins,
      };
    }
  }
  return {
    ok: false,
    deposited: 0,
    coins: await getCoins(nowMs),
    castleCoins: await getCastleCoins(),
  };
};

export const withdrawCastleCoins = async (
  requested: number,
  nowMs: number
): Promise<{ withdrawn: number; coins: number; castleCoins: number }> => {
  const safeRequested = Math.max(0, Math.floor(requested));
  if (safeRequested <= 0) {
    return {
      withdrawn: 0,
      coins: await getCoins(nowMs),
      castleCoins: await getCastleCoins(),
    };
  }
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(economyKeys.coins, economyKeys.castle);
    const coinState = parseGlobalCoinState(
      await redis.get(economyKeys.coins),
      nowMs
    );
    const castleCoins = parseCastleCoins(await redis.get(economyKeys.castle));
    const accrued = accrueCoins(coinState, nowMs);
    const maxAddable = Math.max(0, ENERGY_CAP - accrued);
    const withdrawn = Math.min(
      safeRequested,
      castleCoins,
      Math.floor(maxAddable)
    );
    const nextCoins = clampCoins(accrued + withdrawn);
    const nextCastleCoins = Math.max(0, castleCoins - withdrawn);
    await tx.multi();
    await tx.set(
      economyKeys.coins,
      toJson({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    await tx.set(economyKeys.castle, String(nextCastleCoins));
    const result = await tx.exec();
    if (result !== null) {
      return { withdrawn, coins: nextCoins, castleCoins: nextCastleCoins };
    }
  }
  return {
    withdrawn: 0,
    coins: await getCoins(nowMs),
    castleCoins: await getCastleCoins(),
  };
};

export const enqueueCommand = async (
  nowMs: number,
  envelope: CommandEnvelope
): Promise<{ accepted: boolean; reason?: string }> => {
  const keys = getGameRedisKeys();
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(keys.queue);
    const queueSize = await redis.zCard(keys.queue);
    if (queueSize >= MAX_QUEUE_COMMANDS) {
      await tx.unwatch();
      return { accepted: false, reason: 'command queue is full' };
    }
    await tx.multi();
    await tx.zAdd(keys.queue, {
      member: toJson(envelope),
      score: nowMs,
    });
    const result = await tx.exec();
    if (result !== null) {
      return { accepted: true };
    }
  }
  return { accepted: false, reason: 'queue contention' };
};

export const popPendingCommands = async (
  upToMs: number
): Promise<CommandEnvelope[]> => {
  const keys = getGameRedisKeys();
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(keys.queue);
    const items = await redis.zRange(keys.queue, 0, upToMs, {
      by: 'score',
      limit: { offset: 0, count: MAX_COMMANDS_PER_BATCH },
    });
    if (items.length === 0) {
      await tx.unwatch();
      return [];
    }

    const envelopes: CommandEnvelope[] = [];
    const membersToRemove: string[] = [];
    for (const item of items) {
      const parsed = parseJson(item.member);
      const envelope = parseCommandEnvelope(parsed);
      if (envelope) {
        envelopes.push(envelope);
      }
      membersToRemove.push(item.member);
    }

    if (membersToRemove.length === 0) {
      await tx.unwatch();
      return [];
    }

    await tx.multi();
    await tx.zRem(keys.queue, membersToRemove);
    const result = await tx.exec();
    if (result !== null) {
      return envelopes;
    }
  }
  return [];
};

export const trimCommandQueue = async (): Promise<void> => {
  const keys = getGameRedisKeys();
  const count = await redis.zCard(keys.queue);
  if (count <= MAX_QUEUE_COMMANDS) return;
  const overflow = count - MAX_QUEUE_COMMANDS;
  await redis.zRemRangeByRank(keys.queue, 0, overflow - 1);
};

export const consumeRateLimitToken = async (
  playerId: string,
  nowMs: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(keys.rate);
    const raw = await redis.hGet(keys.rate, playerId);
    const parsed = parseJson(raw ?? undefined);
    const current: RateLimitState = isRecord(parsed)
      ? {
          tokens: Number(parsed.tokens ?? MAX_RATE_TOKENS),
          lastRefillMs: Number(parsed.lastRefillMs ?? nowMs),
        }
      : {
          tokens: MAX_RATE_TOKENS,
          lastRefillMs: nowMs,
        };

    const elapsed = Math.max(0, nowMs - current.lastRefillMs);
    const refill = (elapsed / 1000) * RATE_REFILL_PER_SECOND;
    const tokens = Math.min(MAX_RATE_TOKENS, current.tokens + refill);
    const hasToken = tokens >= 1;
    const nextTokens = hasToken ? tokens - 1 : tokens;

    await tx.multi();
    await tx.hSet(keys.rate, {
      [playerId]: toJson({
        tokens: nextTokens,
        lastRefillMs: nowMs,
      }),
    });
    const result = await tx.exec();
    if (result !== null) {
      return hasToken;
    }
  }
  return false;
};

export const removePlayers = async (playerIds: string[]): Promise<void> => {
  if (playerIds.length === 0) return;
  const keys = getGameRedisKeys();
  await Promise.all([
    redis.hDel(keys.players, playerIds),
    redis.hDel(keys.intents, playerIds),
    redis.zRem(keys.seen, playerIds),
  ]);
};

export const acquireLeaderLock = async (
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  const result = await redis.set(keys.leaderLock, ownerToken, {
    expiration: new Date(Date.now() + ttlSeconds * 1000),
    nx: true,
  });
  return Boolean(result);
};

export const verifyLeaderLock = async (
  ownerToken: string
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  const current = await redis.get(keys.leaderLock);
  return current === ownerToken;
};

export const refreshLeaderLock = async (
  ownerToken: string,
  ttlSeconds: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  const current = await redis.get(keys.leaderLock);
  if (current !== ownerToken) return false;
  await redis.expire(keys.leaderLock, ttlSeconds);
  return true;
};

export const releaseLeaderLock = async (ownerToken: string): Promise<void> => {
  const keys = getGameRedisKeys();
  const tx = await redis.watch(keys.leaderLock);
  const current = await redis.get(keys.leaderLock);
  if (current !== ownerToken) {
    await tx.unwatch();
    return;
  }
  await tx.multi();
  await tx.del(keys.leaderLock);
  await tx.exec();
};

export const markTickPublish = async (tickSeq: number): Promise<void> => {
  const keys = getGameRedisKeys();
  await redis.set(
    keys.lastPublishTickSeq,
    String(Math.max(0, Math.floor(tickSeq)))
  );
};

export const removeOldPlayersByLastSeen = async (
  cutoffMs: number,
  limit = 250
): Promise<string[]> => {
  const keys = getGameRedisKeys();
  const stale = await redis.zRange(keys.seen, 0, cutoffMs, {
    by: 'score',
    limit: { offset: 0, count: limit },
  });
  if (stale.length === 0) return [];
  const playerIds = stale.map((entry) => entry.member);
  await removePlayers(playerIds);
  return playerIds;
};

export const enforceStructureCap = async (
  incomingCount = 1
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  const count = await redis.hLen(keys.structures);
  const safeIncoming = Math.max(0, Math.floor(incomingCount));
  return count + safeIncoming <= MAX_STRUCTURES;
};

export const createDefaultPlayer = (
  playerId: string,
  username: string,
  nowMs: number
): PlayerState => ({
  playerId,
  username,
  position: { x: DEFAULT_PLAYER_SPAWN.x, z: DEFAULT_PLAYER_SPAWN.z },
  velocity: { x: 0, z: 0 },
  speed: PLAYER_SPEED,
  lastSeenMs: nowMs,
});

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
    redis.del(keys.lastPublishTickSeq),
  ]);
  if (Object.keys(structureWrites).length > 0) {
    await redis.hSet(keys.structures, structureWrites);
  }
};

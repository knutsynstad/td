import { redis } from "@devvit/web/server";
import type { CommandEnvelope } from "../../shared/game-protocol";
import type { MobState, PlayerIntent, PlayerState, StructureState, WaveState, WorldMeta, WorldState } from "../../shared/game-state";
import {
  ENERGY_CAP,
  ENERGY_REGEN_PER_SECOND,
  MAX_COMMANDS_PER_BATCH,
  MAX_QUEUE_COMMANDS,
  MAX_RATE_TOKENS,
  MAX_STRUCTURES,
  PLAYER_SPEED_UNITS_PER_SECOND,
  RATE_REFILL_PER_SECOND,
  SIM_TICK_MS,
} from "./config";
import { getGameRedisKeys } from "./keys";

type RateLimitState = {
  tokens: number;
  lastRefillMs: number;
};

type GlobalCoinState = {
  coins: number;
  lastAccruedMs: number;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampCoins = (coins: number): number => Math.max(0, Math.min(ENERGY_CAP, coins));
const GLOBAL_COINS_KEY = "coins";
export const CASTLE_COINS_KEY = "castleCoins";
const MAX_TX_RETRIES = 5;

const parseVec2 = (value: unknown) => {
  if (!isRecord(value)) return { x: 0, z: 0 };
  return {
    x: Number(value.x ?? 0),
    z: Number(value.z ?? 0),
  };
};

const parsePlayerState = (value: unknown): PlayerState => {
  if (!isRecord(value)) {
    return {
      playerId: "",
      username: "anonymous",
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: PLAYER_SPEED_UNITS_PER_SECOND,
      lastSeenMs: 0,
    };
  }
  return {
    playerId: String(value.playerId ?? ""),
    username: String(value.username ?? "anonymous"),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    speed: Number(value.speed ?? PLAYER_SPEED_UNITS_PER_SECOND),
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
      structureId: "",
      ownerId: "",
      type: "wall",
      center: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      createdAtMs: 0,
    };
  }
  return {
    structureId: String(value.structureId ?? ""),
    ownerId: String(value.ownerId ?? ""),
    type: value.type === "tower" || value.type === "tree" || value.type === "rock" || value.type === "bank" ? value.type : "wall",
    center: parseVec2(value.center),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    createdAtMs: Number(value.createdAtMs ?? 0),
  };
};

const parseMob = (value: unknown): MobState => {
  if (!isRecord(value)) {
    return {
      mobId: "",
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      spawnerId: "",
    };
  }
  return {
    mobId: String(value.mobId ?? ""),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    spawnerId: String(value.spawnerId ?? ""),
  };
};

const parseMapFromHash = <T>(
  value: Record<string, string> | undefined,
  parser: (entry: unknown) => T,
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
  const commandType = String(value.command.type ?? "");
  const playerId = String(value.command.playerId ?? "");
  if (commandType === "moveIntent") {
    return {
      seq,
      sentAtMs,
      command: {
        type: "moveIntent",
        playerId,
        intent: parseIntent(value.command.intent),
        clientPosition: value.command.clientPosition ? parseVec2(value.command.clientPosition) : undefined,
      },
    };
  }
  if (commandType === "buildStructure") {
    const structure = isRecord(value.command.structure) ? value.command.structure : {};
    return {
      seq,
      sentAtMs,
      command: {
        type: "buildStructure",
        playerId,
        structure: {
          structureId: String(structure.structureId ?? ""),
          type:
            structure.type === "tower" ||
            structure.type === "tree" ||
            structure.type === "rock" ||
            structure.type === "bank"
              ? structure.type
              : "wall",
          center: parseVec2(structure.center),
        },
      },
    };
  }
  if (commandType === "removeStructure") {
    return {
      seq,
      sentAtMs,
      command: {
        type: "removeStructure",
        playerId,
        structureId: String(value.command.structureId ?? ""),
      },
    };
  }
  if (commandType === "startWave") {
    return {
      seq,
      sentAtMs,
      command: {
        type: "startWave",
        playerId,
      },
    };
  }
  if (commandType === "shoot") {
    return {
      seq,
      sentAtMs,
      command: {
        type: "shoot",
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

export const loadWorldState = async (postId: string): Promise<WorldState> => {
  const keys = getGameRedisKeys(postId);
  const [metaRaw, playersRaw, intentsRaw, structuresRaw, mobsRaw, waveRaw] = await Promise.all([
    redis.hGetAll(keys.meta),
    redis.hGetAll(keys.players),
    redis.hGetAll(keys.intents),
    redis.hGetAll(keys.structures),
    redis.hGetAll(keys.mobs),
    redis.get(keys.wave),
  ]);

  const now = Date.now();
  const meta: WorldMeta = {
    postId,
    tickSeq: Number(metaRaw?.tickSeq ?? "0"),
    worldVersion: Number(metaRaw?.worldVersion ?? "0"),
    lastTickMs: Number(metaRaw?.lastTickMs ?? String(now)),
    seed: Number(metaRaw?.seed ?? String(now)),
    energy: Math.max(0, Math.min(ENERGY_CAP, Number(metaRaw?.energy ?? String(ENERGY_CAP)))),
    lives: Number(metaRaw?.lives ?? "1"),
  };

  const players = parseMapFromHash<PlayerState>(playersRaw, parsePlayerState);
  const intents = parseMapFromHash<PlayerIntent>(intentsRaw, parseIntent);
  const structures = parseMapFromHash<StructureState>(structuresRaw, parseStructure);
  const mobs = parseMapFromHash<MobState>(mobsRaw, parseMob);
  const parsedWave = parseJson(waveRaw ?? undefined);
  const wave = isRecord(parsedWave)
    ? {
        wave: Number(parsedWave.wave ?? 0),
        active: Boolean(parsedWave.active ?? false),
        nextWaveAtMs: Number(parsedWave.nextWaveAtMs ?? 0),
        spawners: Array.isArray(parsedWave.spawners)
          ? parsedWave.spawners.map((entry) => {
              if (!isRecord(entry)) {
                return {
                  spawnerId: "",
                  totalCount: 0,
                  spawnedCount: 0,
                  aliveCount: 0,
                  spawnRatePerSecond: 0,
                  spawnAccumulator: 0,
                  gateOpen: false,
                };
              }
              return {
                spawnerId: String(entry.spawnerId ?? ""),
                totalCount: Number(entry.totalCount ?? 0),
                spawnedCount: Number(entry.spawnedCount ?? 0),
                aliveCount: Number(entry.aliveCount ?? 0),
                spawnRatePerSecond: Number(entry.spawnRatePerSecond ?? 0),
                spawnAccumulator: Number(entry.spawnAccumulator ?? 0),
                gateOpen: Boolean(entry.gateOpen ?? false),
              };
            })
          : [],
      }
    : defaultWave();

  return { meta, players, intents, structures, mobs, wave };
};

export const persistWorldState = async (world: WorldState): Promise<void> => {
  const keys = getGameRedisKeys(world.meta.postId);
  const metaWrites: Record<string, string> = {
    tickSeq: String(world.meta.tickSeq),
    worldVersion: String(world.meta.worldVersion),
    lastTickMs: String(world.meta.lastTickMs),
    seed: String(world.meta.seed),
    energy: String(world.meta.energy),
    lives: String(world.meta.lives),
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
    Object.keys(playersWrites).length > 0 ? redis.hSet(keys.players, playersWrites) : Promise.resolve(),
    Object.keys(intentsWrites).length > 0 ? redis.hSet(keys.intents, intentsWrites) : Promise.resolve(),
    Object.keys(structureWrites).length > 0 ? redis.hSet(keys.structures, structureWrites) : Promise.resolve(),
    Object.keys(mobWrites).length > 0 ? redis.hSet(keys.mobs, mobWrites) : Promise.resolve(),
  ]);
};

export const touchPlayerPresence = async (postId: string, player: PlayerState): Promise<void> => {
  const keys = getGameRedisKeys(postId);
  await Promise.all([
    redis.hSet(keys.players, { [player.playerId]: toJson(player) }),
    redis.zAdd(keys.lastSeen, { member: player.playerId, score: player.lastSeenMs }),
  ]);
};

export const getGlobalCoins = async (nowMs: number): Promise<number> => {
  const raw = await redis.get(GLOBAL_COINS_KEY);
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

const parseGlobalCoinState = (raw: string | undefined, nowMs: number): GlobalCoinState => {
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

export const spendGlobalCoins = async (
  amount: number,
  nowMs: number,
): Promise<{ ok: boolean; coins: number }> => {
  const safeAmount = Math.max(0, amount);
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(GLOBAL_COINS_KEY);
    const current = parseGlobalCoinState(await redis.get(GLOBAL_COINS_KEY), nowMs);
    const accrued = accrueCoins(current, nowMs);
    if (accrued < safeAmount) {
      await tx.unwatch();
      return { ok: false, coins: accrued };
    }
    const nextCoins = clampCoins(accrued - safeAmount);
    await tx.multi();
    await tx.set(GLOBAL_COINS_KEY, toJson({ coins: nextCoins, lastAccruedMs: nowMs }));
    const result = await tx.exec();
    if (result !== null) {
      return { ok: true, coins: nextCoins };
    }
  }
  const fallback = await getGlobalCoins(nowMs);
  return { ok: false, coins: fallback };
};

export const addGlobalCoins = async (
  amount: number,
  nowMs: number,
): Promise<{ added: number; coins: number }> => {
  const safeAmount = Math.max(0, amount);
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(GLOBAL_COINS_KEY);
    const current = parseGlobalCoinState(await redis.get(GLOBAL_COINS_KEY), nowMs);
    const accrued = accrueCoins(current, nowMs);
    const nextCoins = clampCoins(accrued + safeAmount);
    const added = Math.max(0, nextCoins - accrued);
    await tx.multi();
    await tx.set(GLOBAL_COINS_KEY, toJson({ coins: nextCoins, lastAccruedMs: nowMs }));
    const result = await tx.exec();
    if (result !== null) {
      return { added, coins: nextCoins };
    }
  }
  return { added: 0, coins: await getGlobalCoins(nowMs) };
};

export const getCastleCoins = async (): Promise<number> =>
  parseCastleCoins(await redis.get(CASTLE_COINS_KEY));

export const depositCoinsToCastle = async (
  amount: number,
  nowMs: number,
): Promise<{ ok: boolean; deposited: number; coins: number; castleCoins: number }> => {
  const safeAmount = Math.max(0, Math.floor(amount));
  if (safeAmount <= 0) {
    return { ok: false, deposited: 0, coins: await getGlobalCoins(nowMs), castleCoins: await getCastleCoins() };
  }
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(GLOBAL_COINS_KEY, CASTLE_COINS_KEY);
    const coinState = parseGlobalCoinState(await redis.get(GLOBAL_COINS_KEY), nowMs);
    const castleCoins = parseCastleCoins(await redis.get(CASTLE_COINS_KEY));
    const accrued = accrueCoins(coinState, nowMs);
    if (accrued < safeAmount) {
      await tx.unwatch();
      return { ok: false, deposited: 0, coins: accrued, castleCoins };
    }
    const nextCoins = clampCoins(accrued - safeAmount);
    const nextCastleCoins = castleCoins + safeAmount;
    await tx.multi();
    await tx.set(GLOBAL_COINS_KEY, toJson({ coins: nextCoins, lastAccruedMs: nowMs }));
    await tx.set(CASTLE_COINS_KEY, String(nextCastleCoins));
    const result = await tx.exec();
    if (result !== null) {
      return { ok: true, deposited: safeAmount, coins: nextCoins, castleCoins: nextCastleCoins };
    }
  }
  return { ok: false, deposited: 0, coins: await getGlobalCoins(nowMs), castleCoins: await getCastleCoins() };
};

export const withdrawCoinsFromCastle = async (
  requested: number,
  nowMs: number,
): Promise<{ withdrawn: number; coins: number; castleCoins: number }> => {
  const safeRequested = Math.max(0, Math.floor(requested));
  if (safeRequested <= 0) {
    return { withdrawn: 0, coins: await getGlobalCoins(nowMs), castleCoins: await getCastleCoins() };
  }
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(GLOBAL_COINS_KEY, CASTLE_COINS_KEY);
    const coinState = parseGlobalCoinState(await redis.get(GLOBAL_COINS_KEY), nowMs);
    const castleCoins = parseCastleCoins(await redis.get(CASTLE_COINS_KEY));
    const accrued = accrueCoins(coinState, nowMs);
    const maxAddable = Math.max(0, ENERGY_CAP - accrued);
    const withdrawn = Math.min(safeRequested, castleCoins, Math.floor(maxAddable));
    const nextCoins = clampCoins(accrued + withdrawn);
    const nextCastleCoins = Math.max(0, castleCoins - withdrawn);
    await tx.multi();
    await tx.set(GLOBAL_COINS_KEY, toJson({ coins: nextCoins, lastAccruedMs: nowMs }));
    await tx.set(CASTLE_COINS_KEY, String(nextCastleCoins));
    const result = await tx.exec();
    if (result !== null) {
      return { withdrawn, coins: nextCoins, castleCoins: nextCastleCoins };
    }
  }
  return { withdrawn: 0, coins: await getGlobalCoins(nowMs), castleCoins: await getCastleCoins() };
};

export const setPlayerIntent = async (postId: string, playerId: string, intent: PlayerIntent): Promise<void> => {
  const keys = getGameRedisKeys(postId);
  await redis.hSet(keys.intents, { [playerId]: toJson(intent) });
};

export const enqueueCommand = async (
  postId: string,
  nowMs: number,
  envelope: CommandEnvelope,
): Promise<{ accepted: boolean; reason?: string }> => {
  const keys = getGameRedisKeys(postId);
  const queueSize = await redis.zCard(keys.pendingCommands);
  if (queueSize >= MAX_QUEUE_COMMANDS) {
    return { accepted: false, reason: "command queue is full" };
  }
  await redis.zAdd(keys.pendingCommands, {
    member: toJson(envelope),
    score: nowMs,
  });
  return { accepted: true };
};

export const popPendingCommands = async (postId: string, upToMs: number): Promise<CommandEnvelope[]> => {
  const keys = getGameRedisKeys(postId);
  const items = await redis.zRange(keys.pendingCommands, 0, upToMs, {
    by: "score",
    limit: { offset: 0, count: MAX_COMMANDS_PER_BATCH },
  });

  if (items.length === 0) return [];

  const envelopes: CommandEnvelope[] = [];
  const membersToRemove: string[] = [];
  for (const item of items) {
    const parsed = parseJson(item.member);
    const envelope = parseCommandEnvelope(parsed);
    if (envelope) {
      envelopes.push(envelope);
      membersToRemove.push(item.member);
    }
  }

  if (membersToRemove.length > 0) {
    await redis.zRem(keys.pendingCommands, membersToRemove);
  }
  return envelopes;
};

export const trimCommandQueue = async (postId: string): Promise<void> => {
  const keys = getGameRedisKeys(postId);
  const count = await redis.zCard(keys.pendingCommands);
  if (count <= MAX_QUEUE_COMMANDS) return;
  const overflow = count - MAX_QUEUE_COMMANDS;
  await redis.zRemRangeByRank(keys.pendingCommands, 0, overflow - 1);
};

export const consumeRateLimitToken = async (postId: string, playerId: string, nowMs: number): Promise<boolean> => {
  const keys = getGameRedisKeys(postId);
  const raw = await redis.hGet(keys.rateLimits, playerId);
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
  if (tokens < 1) {
    await redis.hSet(keys.rateLimits, {
      [playerId]: toJson({
        tokens,
        lastRefillMs: nowMs,
      }),
    });
    return false;
  }

  await redis.hSet(keys.rateLimits, {
    [playerId]: toJson({
      tokens: tokens - 1,
      lastRefillMs: nowMs,
    }),
  });
  return true;
};

export const removePlayers = async (postId: string, playerIds: string[]): Promise<void> => {
  if (playerIds.length === 0) return;
  const keys = getGameRedisKeys(postId);
  await Promise.all([
    redis.hDel(keys.players, playerIds),
    redis.hDel(keys.intents, playerIds),
    redis.zRem(keys.lastSeen, playerIds),
  ]);
};

export const removeOldPlayersByLastSeen = async (postId: string, cutoffMs: number, limit = 250): Promise<string[]> => {
  const keys = getGameRedisKeys(postId);
  const stale = await redis.zRange(keys.lastSeen, 0, cutoffMs, {
    by: "score",
    limit: { offset: 0, count: limit },
  });
  if (stale.length === 0) return [];
  const playerIds = stale.map((entry) => entry.member);
  await removePlayers(postId, playerIds);
  return playerIds;
};

export const enforceStructureCap = async (postId: string): Promise<boolean> => {
  const keys = getGameRedisKeys(postId);
  const count = await redis.hLen(keys.structures);
  return count < MAX_STRUCTURES;
};

export const createDefaultPlayer = (playerId: string, username: string, nowMs: number): PlayerState => ({
  playerId,
  username,
  position: { x: 0, z: 0 },
  velocity: { x: 0, z: 0 },
  speed: PLAYER_SPEED_UNITS_PER_SECOND,
  lastSeenMs: nowMs,
});

export const nextTickBoundary = (lastTickMs: number): number => lastTickMs + SIM_TICK_MS;

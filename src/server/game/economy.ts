import { redis } from '@devvit/web/server';
import { ENERGY_CAP, ENERGY_REGEN_PER_SECOND } from '../../shared/content';
import { isRecord, safeParseJson } from '../../shared/utils';

const MAX_TX_RETRIES = 5;

export type EconomyRedisKeys = {
  coins: string;
  castle: string;
};

const getEconomyRedisKeys = (): EconomyRedisKeys => ({
  coins: 'g:c',
  castle: 'g:cs',
});

export { getEconomyRedisKeys };

const economyKeys = getEconomyRedisKeys();

export const clampCoins = (coins: number): number =>
  Math.max(0, Math.min(ENERGY_CAP, coins));

type GlobalCoinState = {
  coins: number;
  lastAccruedMs: number;
};

const parseGlobalCoinState = (
  raw: string | undefined,
  nowMs: number
): GlobalCoinState => {
  const parsed = safeParseJson(raw ?? undefined);
  if (!isRecord(parsed)) {
    return { coins: ENERGY_CAP, lastAccruedMs: nowMs };
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

export const getCoins = async (nowMs: number): Promise<number> => {
  const raw = await redis.get(economyKeys.coins);
  return accrueCoins(parseGlobalCoinState(raw ?? undefined, nowMs), nowMs);
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
      JSON.stringify({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    const result = await tx.exec();
    if (result !== null) return { ok: true, coins: nextCoins };
  }
  return { ok: false, coins: await getCoins(nowMs) };
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
      JSON.stringify({ coins: nextCoins, lastAccruedMs: nowMs })
    );
    const result = await tx.exec();
    if (result !== null) return { added, coins: nextCoins };
  }
  return { added: 0, coins: await getCoins(nowMs) };
};

const parseCastleCoins = (raw: string | undefined): number => {
  const numeric = Number(raw ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
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
      JSON.stringify({ coins: nextCoins, lastAccruedMs: nowMs })
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
      JSON.stringify({ coins: nextCoins, lastAccruedMs: nowMs })
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

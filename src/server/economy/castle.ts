import { redis } from '@devvit/web/server';
import { ENERGY_CAP } from '../../shared/content';
import { getEconomyRedisKeys } from './keys';
import {
  accrueCoins,
  clampCoins,
  getCoins,
  parseGlobalCoinState,
} from './coins';

const MAX_TX_RETRIES = 5;
const economyKeys = getEconomyRedisKeys();

const toJson = (value: unknown): string => JSON.stringify(value);

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

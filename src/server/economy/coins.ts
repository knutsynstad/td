import { redis } from '@devvit/web/server';
import { ENERGY_CAP, ENERGY_REGEN_PER_SECOND } from '../../shared/content';
import { isRecord } from '../../shared/utils';
import { getEconomyRedisKeys } from './keys';

const MAX_TX_RETRIES = 5;
const economyKeys = getEconomyRedisKeys();

const toJson = (value: unknown): string => JSON.stringify(value);

const parseJson = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const clampCoins = (coins: number): number =>
  Math.max(0, Math.min(ENERGY_CAP, coins));

type GlobalCoinState = {
  coins: number;
  lastAccruedMs: number;
};

export const parseGlobalCoinState = (
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

export const accrueCoins = (state: GlobalCoinState, nowMs: number): number => {
  const elapsedMs = Math.max(0, nowMs - state.lastAccruedMs);
  const regenerated = (elapsedMs / 1000) * ENERGY_REGEN_PER_SECOND;
  return clampCoins(state.coins + regenerated);
};

export const getCoins = async (nowMs: number): Promise<number> => {
  const raw = await redis.get(economyKeys.coins);
  const current = parseGlobalCoinState(raw ?? undefined, nowMs);
  return accrueCoins(current, nowMs);
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

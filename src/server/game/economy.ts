import { redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import { KEYS, FIELDS } from '../core/keys';
import {
  CASTLE_COINS_MIN,
  CASTLE_DEATH_TAX_RATIO,
  COIN_ACCRUAL_INTERVAL_MS,
  USER_COINS_MIN,
  USER_COINS_MAX,
} from '../../shared/content';
import { clamp } from '../../shared/utils';

/**
 * Get the coin balance for a given player. Returns the current coin balance with any accrued coins applied. If the player does not exist, it will be created with the initial balance.
 */
export async function getUserCoinBalance(userId: T2): Promise<number> {
  const now = Date.now();

  let [balance, lastAccruedMs]: (string | number | null)[] = await redis.hMGet(
    KEYS.PLAYER(userId),
    [FIELDS.USER_COIN_BALANCE, FIELDS.USER_COIN_LAST_ACCRUED_MS]
  );

  if (balance === null || lastAccruedMs === null) {
    await redis.hSet(KEYS.PLAYER(userId), {
      [FIELDS.USER_COIN_BALANCE]: String(USER_COINS_MAX),
      [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(now),
    });
    return USER_COINS_MAX;
  }

  balance = Number(balance);
  lastAccruedMs = Number(lastAccruedMs);

  const elapsedMs = now - lastAccruedMs;
  const accrued = Math.floor(elapsedMs / COIN_ACCRUAL_INTERVAL_MS);

  balance += accrued;
  balance = Math.floor(balance);
  balance = clamp(balance, USER_COINS_MIN, USER_COINS_MAX);

  const newLastAccruedMs =
    lastAccruedMs + accrued * COIN_ACCRUAL_INTERVAL_MS;

  await redis.hSet(KEYS.PLAYER(userId), {
    [FIELDS.USER_COIN_BALANCE]: String(balance),
    [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(newLastAccruedMs),
  });

  return balance;
}

/**
 * Spend coins from a given user's coin balance.
 */
export async function spendUserCoins(
  userId: T2,
  amount: number
): Promise<{ success: boolean; balance: number }> {
  let balance = await getUserCoinBalance(userId);

  if (balance < amount) {
    return { success: false, balance };
  }

  balance -= amount;
  balance = Math.floor(balance);
  balance = clamp(balance, USER_COINS_MIN, USER_COINS_MAX);

  await redis.hSet(KEYS.PLAYER(userId), {
    [FIELDS.USER_COIN_BALANCE]: String(balance),
    // Deliberately not updating lastAccruedMs since getUserCoinBalance already did.
  });

  return { success: true, balance };
}

/**
 * Add coins to a user's balance (e.g. refund). Clamps to valid range.
 */
export async function addUserCoins(
  userId: T2,
  amount: number
): Promise<{ added: number; balance: number }> {
  const current = await getUserCoinBalance(userId);
  const next = Math.floor(
    clamp(current + amount, USER_COINS_MIN, USER_COINS_MAX)
  );
  const added = next - current;
  if (added <= 0) return { added: 0, balance: current };

  await redis.hSet(KEYS.PLAYER(userId), {
    [FIELDS.USER_COIN_BALANCE]: String(next),
    // Deliberately not updating lastAccruedMs since getUserCoinBalance already did.
  });
  return { added, balance: next };
}

/**
 * Apply castle death tax: reduce castle balance by 20%. Called when castle falls.
 */
export async function applyCastleDeathTax(): Promise<number> {
  const balance = await getCastleCoinBalance();
  const tax = Math.floor(balance * CASTLE_DEATH_TAX_RATIO);
  if (tax <= 0) return 0;
  const newBalance = Math.max(CASTLE_COINS_MIN, balance - tax);
  await redis.set(KEYS.CASTLE_COIN_BALANCE, String(newBalance));
  return tax;
}

/**
 * Get the current castle coin balance.
 */
export async function getCastleCoinBalance(): Promise<number> {
  const data = await redis.get(KEYS.CASTLE_COIN_BALANCE);
  return Number(data ?? CASTLE_COINS_MIN);
}

/**
 * Deposit coins into the castle. Returns the amount deposited, the new user balance, and the new castle balance.
 */
export async function addCoinsToCastle(
  userId: T2,
  amount: number
): Promise<{
  deposited: number;
  userBalance: number;
  castleBalance: number;
}> {
  let [userBalance, castleBalance] = await Promise.all([
    getUserCoinBalance(userId),
    getCastleCoinBalance(),
  ]);

  let deposited = Math.floor(amount);
  deposited = Math.max(deposited, CASTLE_COINS_MIN);

  if (userBalance < deposited) {
    return { deposited: 0, userBalance, castleBalance };
  }

  userBalance -= deposited;
  castleBalance += deposited;
  userBalance = clamp(userBalance, USER_COINS_MIN, USER_COINS_MAX);

  await Promise.all([
    redis.hIncrBy(KEYS.PLAYER(userId), FIELDS.USER_COIN_BALANCE, -deposited),
    redis.incrBy(KEYS.CASTLE_COIN_BALANCE, deposited),
  ]);

  return { deposited, userBalance, castleBalance };
}

/**
 * Withdraw coins from the castle. Returns the amount withdrawn, the new user balance, and the new castle balance.
 */
export async function takeCoinsFromCastle(
  userId: T2,
  amount: number
): Promise<{
  withdrawn: number;
  userBalance: number;
  castleBalance: number;
}> {
  const [userBalance, castleBalance] = await Promise.all([
    getUserCoinBalance(userId),
    getCastleCoinBalance(),
  ]);

  const outcome = { withdrawn: 0, userBalance, castleBalance };

  if (castleBalance < amount) return outcome;

  const maxAddable = Math.max(0, USER_COINS_MAX - userBalance);
  if (amount > maxAddable) return outcome;

  outcome.withdrawn = Math.floor(amount);
  outcome.userBalance = userBalance + outcome.withdrawn;
  outcome.castleBalance = castleBalance - outcome.withdrawn;

  await Promise.all([
    redis.hIncrBy(
      KEYS.PLAYER(userId),
      FIELDS.USER_COIN_BALANCE,
      outcome.withdrawn
    ),
    // Deliberately not updating lastAccruedMs since getUserCoinBalance already did.
    redis.incrBy(KEYS.CASTLE_COIN_BALANCE, -outcome.withdrawn),
  ]);

  return outcome;
}

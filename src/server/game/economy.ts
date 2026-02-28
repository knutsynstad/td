import { redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';
import { KEYS, FIELDS } from '../core/redis';
import {
  CASTLE_COINS_MIN,
  USER_COINS_ACCRUED_PER_SECOND,
  USER_COINS_MIN,
  USER_COINS_MAX,
} from '../../shared/content';
import { clamp } from '../../shared/utils';

/**
 * Get the coin balance for a given player. Returns the current coin balance with any accrued coins applied. If the player does not exist, it will be created with the initial balance.
 */
export async function getUserCoinBalance(userId: T2): Promise<number> {
  // Get the current time
  const now = Date.now();

  // Get the current balance and last accrued time
  let [balance, lastAccruedMs]: (string | number | null)[] = await redis.hMGet(
    KEYS.PLAYER(userId),
    [FIELDS.USER_COIN_BALANCE, FIELDS.USER_COIN_LAST_ACCRUED_MS]
  );

  // Initialize the player's coins if they don't exist
  if (balance === null || lastAccruedMs === null) {
    await redis.hSet(KEYS.PLAYER(userId), {
      [FIELDS.USER_COIN_BALANCE]: String(USER_COINS_MAX),
      [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(now),
    });
    return USER_COINS_MAX;
  }

  // Parse the balance and last accrued time
  balance = Number(balance);
  lastAccruedMs = Number(lastAccruedMs);

  // Calculate how many coins have been earned since the last accrual
  const elapsedMs = now - lastAccruedMs;
  const accrued = Math.floor(elapsedMs * 1_000 * USER_COINS_ACCRUED_PER_SECOND);

  // Add the accrued coins to the balance
  balance += accrued;

  // Ensure the balance is within the valid range
  balance = Math.floor(balance);
  balance = clamp(balance + accrued, USER_COINS_MIN, USER_COINS_MAX);

  // Update the player balance and last accrued time
  await redis.hSet(KEYS.PLAYER(userId), {
    [FIELDS.USER_COIN_BALANCE]: String(balance),
    [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(now),
  });

  // Return the new balance
  return balance;
}

/**
 * Spend coins from a given user's coin balance.
 */
export async function spendUserCoins(
  userId: T2,
  amount: number
): Promise<{ success: boolean; balance: number }> {
  // Get the current balance
  let balance = await getUserCoinBalance(userId);

  // Insufficient funds
  if (balance < amount) {
    return { success: false, balance };
  }

  // Calculate the new balance
  balance -= amount;

  // Ensure the balance is a whole number and within the valid range
  balance = Math.floor(balance);
  balance = clamp(balance, USER_COINS_MIN, USER_COINS_MAX);

  // Save the updated balance. Deliberately not updating the last accrued time here since the balance is being updated by calling getUserCoinBalance.
  await redis.hSet(KEYS.PLAYER(userId), {
    [FIELDS.USER_COIN_BALANCE]: String(balance),
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
    [FIELDS.USER_COIN_LAST_ACCRUED_MS]: String(Date.now()),
  });
  return { added, balance: next };
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
  // Get the current user and castle coin balances
  let [userBalance, castleBalance] = await Promise.all([
    getUserCoinBalance(userId),
    getCastleCoinBalance(),
  ]);

  // Parse the amount for deposit
  let deposited = Math.floor(amount);
  deposited = Math.max(deposited, CASTLE_COINS_MIN);

  // Insufficient funds
  if (userBalance < deposited) {
    return { deposited: 0, userBalance, castleBalance };
  }

  // Calculate the new user balance
  userBalance -= deposited;
  castleBalance += deposited;

  // Ensure the balances are within the valid range
  userBalance = clamp(userBalance, USER_COINS_MIN, USER_COINS_MAX);

  // Update the user and castle balances
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
  // Get the current user and castle coin balances
  const [userBalance, castleBalance] = await Promise.all([
    getUserCoinBalance(userId),
    getCastleCoinBalance(),
  ]);

  // Initialize an empty outcome object
  const outcome = { withdrawn: 0, userBalance, castleBalance };

  // Insufficient funds -> return early
  if (castleBalance < amount) return outcome;

  // Calculate the maximum amount that can be added to the user's balance
  const maxAddable = Math.max(0, USER_COINS_MAX - userBalance);

  // User unable to hold the requested amount of coins -> return early
  if (amount > maxAddable) return outcome;

  // Update the outcome
  outcome.withdrawn = Math.floor(amount);
  outcome.userBalance = userBalance + outcome.withdrawn;
  outcome.castleBalance = castleBalance - outcome.withdrawn;

  // Update the user and castle balances
  await Promise.all([
    redis.hIncrBy(
      KEYS.PLAYER(userId),
      FIELDS.USER_COIN_BALANCE,
      outcome.withdrawn
    ),
    redis.incrBy(KEYS.CASTLE_COIN_BALANCE, -outcome.withdrawn),
  ]);

  return outcome;
}

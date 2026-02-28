import { redis } from '@devvit/web/server';
import { KEYS } from '../core/redis';
import { COINS_CAP, COINS_REGEN_PER_SECOND } from '../../shared/content';
import { clamp } from '../../shared/utils';

const MAX_TX_RETRIES = 5;
const PLAYER_COINS_FIELD_COINS = 'coins';
const PLAYER_COINS_FIELD_LAST_ACCRUED_MS = 'lastAccruedMs';

// --- Player coins (personal balance with regen) ---

type PlayerCoinsState = {
  coins: number;
  lastAccruedMs: number;
};

/**
 * Compute the accrued coins.
 */
function computeAccrued(state: PlayerCoinsState, nowMs: number): number {
  const elapsedMs = Math.max(0, nowMs - state.lastAccruedMs);
  const regenerated = (elapsedMs / 1000) * COINS_REGEN_PER_SECOND;
  return Math.floor(clamp(state.coins + regenerated, 0, COINS_CAP));
}

/**
 * Read the player coins state from the database.
 * If raw is provided, skips fetch and parses it (for use inside watch blocks).
 */
async function readPlayerCoinsState(
  raw?: Record<string, string>,
  nowMs = Date.now()
): Promise<PlayerCoinsState> {
  const data = raw ?? (await redis.hGetAll(KEYS.coins)) ?? undefined;
  if (!data || typeof data[PLAYER_COINS_FIELD_COINS] === 'undefined') {
    return { coins: COINS_CAP, lastAccruedMs: nowMs };
  }
  return {
    coins: clamp(
      Number(data[PLAYER_COINS_FIELD_COINS] ?? COINS_CAP),
      0,
      COINS_CAP
    ),
    lastAccruedMs: Number(data[PLAYER_COINS_FIELD_LAST_ACCRUED_MS] ?? nowMs),
  };
}

async function getPlayerBalanceFromRaw(
  raw: Record<string, string> | undefined,
  nowMs: number
): Promise<number> {
  const state = await readPlayerCoinsState(raw, nowMs);
  return computeAccrued(state, nowMs);
}

/**
 * Get the player coins.
 */
export async function getPlayerCoins(nowMs: number): Promise<number> {
  const raw = await redis.hGetAll(KEYS.coins);
  return await getPlayerBalanceFromRaw(raw ?? undefined, nowMs);
}

/**
 * Spend coins from the player's wallet.
 */
export async function spendPlayerCoins(
  amount: number,
  nowMs: number
): Promise<{ ok: boolean; coins: number }> {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.coins);
    const balance = await getPlayerBalanceFromRaw(
      (await redis.hGetAll(KEYS.coins)) ?? undefined,
      nowMs
    );
    if (balance < amount) {
      await tx.unwatch();
      return { ok: false, coins: balance };
    }
    const nextCoins = Math.floor(clamp(balance - amount, 0, COINS_CAP));
    await tx.multi();
    await tx.hSet(KEYS.coins, {
      [PLAYER_COINS_FIELD_COINS]: String(nextCoins),
      [PLAYER_COINS_FIELD_LAST_ACCRUED_MS]: String(nowMs),
    });
    const result = await tx.exec();
    if (result !== null) return { ok: true, coins: nextCoins };
  }
  return { ok: false, coins: await getPlayerCoins(nowMs) };
}

/**
 * Add coins to the player's wallet.
 */
export async function addPlayerCoins(
  amount: number,
  nowMs: number
): Promise<{ added: number; coins: number }> {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.coins);
    const balance = await getPlayerBalanceFromRaw(
      (await redis.hGetAll(KEYS.coins)) ?? undefined,
      nowMs
    );
    const nextCoins = Math.floor(clamp(balance + amount, 0, COINS_CAP));
    const added = Math.max(0, nextCoins - balance);
    await tx.multi();
    await tx.hSet(KEYS.coins, {
      [PLAYER_COINS_FIELD_COINS]: String(nextCoins),
      [PLAYER_COINS_FIELD_LAST_ACCRUED_MS]: String(nowMs),
    });
    const result = await tx.exec();
    if (result !== null) return { added, coins: nextCoins };
  }
  return { added: 0, coins: await getPlayerCoins(nowMs) };
}

/**
 * Get the current castle coin balance.
 */
export async function getCastleBalance(): Promise<number> {
  const data = await redis.get(KEYS.castle);
  return data ? Number(data) : 0;
}

/**
 * Deposit coins into the castle.
 */
export async function depositToCastle(amount: number): Promise<{
  deposited: number;
  userBalance: number;
  castleBalance: number;
}> {
  const now = Date.now();
  const [userBalance, castleBalance] = await Promise.all([
    getPlayerCoins(now),
    getCastleBalance(),
  ]);

  // Insufficient funds
  if (userBalance < amount) {
    return { deposited: 0, userBalance, castleBalance };
  }

  const nextUserBalance = Math.floor(clamp(userBalance - amount, 0, COINS_CAP));
  const nextCastleBalance = castleBalance + amount;

  await Promise.all([
    redis.hSet(KEYS.coins, {
      [PLAYER_COINS_FIELD_COINS]: String(nextUserBalance),
      [PLAYER_COINS_FIELD_LAST_ACCRUED_MS]: String(now),
    }),
    redis.incrBy(KEYS.castle, amount),
  ]);

  return {
    deposited: amount,
    userBalance: nextUserBalance,
    castleBalance: nextCastleBalance,
  };
}

/**
 * Withdraw coins from the castle.
 */
export async function withdrawFromCastle(amount: number): Promise<{
  withdrawn: number;
  userBalance: number;
  castleBalance: number;
}> {
  const now = Date.now();
  const [userBalance, castleBalance] = await Promise.all([
    getPlayerCoins(now),
    getCastleBalance(),
  ]);

  // Insufficient funds
  if (castleBalance < amount) {
    return { withdrawn: 0, userBalance, castleBalance };
  }

  const maxAddable = Math.max(0, COINS_CAP - userBalance);
  const withdrawn = Math.min(amount, castleBalance, Math.floor(maxAddable));
  const nextUserBalance = Math.floor(
    clamp(userBalance + withdrawn, 0, COINS_CAP)
  );

  await Promise.all([
    redis.hSet(KEYS.coins, {
      [PLAYER_COINS_FIELD_COINS]: String(nextUserBalance),
      [PLAYER_COINS_FIELD_LAST_ACCRUED_MS]: String(now),
    }),
    redis.incrBy(KEYS.castle, -withdrawn),
  ]);

  return {
    withdrawn,
    userBalance: nextUserBalance,
    castleBalance: castleBalance - withdrawn,
  };
}

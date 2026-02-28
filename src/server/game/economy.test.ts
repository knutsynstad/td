import { createDevvitTest } from '@devvit/test/server/vitest';
import { afterEach, expect, vi } from 'vitest';
import { redis } from '@devvit/web/server';
import {
  getUserCoinBalance,
  spendUserCoins,
  addUserCoins,
  getCastleCoinBalance,
  addCoinsToCastle,
  takeCoinsFromCastle,
} from './economy';
import { KEYS } from '../core/redis';
import {
  USER_COINS_MAX,
  USER_COINS_MIN,
  CASTLE_COINS_MIN,
} from '../../shared/content';

const test = createDevvitTest();

let userIdCounter = 0;

const uniqueUserId = (): `t2_${string}` =>
  `t2_economy-user-${++userIdCounter}` as `t2_${string}`;

const clearCastleCoins = async (): Promise<void> => {
  await redis.del(KEYS.CASTLE_COIN_BALANCE);
};

afterEach(() => {
  vi.useRealTimers();
});

test('getUserCoinBalance initializes new user with USER_COINS_MAX', async () => {
  const userId = uniqueUserId();
  const balance = await getUserCoinBalance(userId);
  expect(balance).toBe(USER_COINS_MAX);
});

test('getUserCoinBalance returns persisted balance for existing user', async () => {
  vi.useFakeTimers();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await spendUserCoins(userId, 30);
  expect(result.success).toBe(true);
  const balance = await getUserCoinBalance(userId);
  expect(balance).toBe(70);
});

test('getUserCoinBalance accrues coins over time', async () => {
  vi.useFakeTimers();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const { balance: afterSpend } = await spendUserCoins(userId, 50);
  expect(afterSpend).toBe(50);
  vi.advanceTimersByTime(4000);
  const balanceAfterTime = await getUserCoinBalance(userId);
  expect(balanceAfterTime).toBeGreaterThanOrEqual(50);
});

test('spendUserCoins succeeds when sufficient funds', async () => {
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await spendUserCoins(userId, 25);
  expect(result.success).toBe(true);
  expect(result.balance).toBe(75);
});

test('spendUserCoins fails when insufficient funds', async () => {
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await spendUserCoins(userId, 150);
  expect(result.success).toBe(false);
  expect(result.balance).toBe(USER_COINS_MAX);
});

test('spendUserCoins clamps balance to USER_COINS_MIN', async () => {
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await spendUserCoins(userId, USER_COINS_MAX);
  expect(result.success).toBe(true);
  expect(result.balance).toBe(USER_COINS_MIN);
});

test('addUserCoins adds coins up to cap', async () => {
  vi.useFakeTimers();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  await spendUserCoins(userId, 40);
  const result = await addUserCoins(userId, 30);
  expect(result.added).toBe(30);
  expect(result.balance).toBe(90);
});

test('addUserCoins clamps at USER_COINS_MAX', async () => {
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await addUserCoins(userId, 50);
  expect(result.added).toBe(0);
  expect(result.balance).toBe(USER_COINS_MAX);
});

test('addUserCoins returns added 0 when at cap', async () => {
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await addUserCoins(userId, 1);
  expect(result.added).toBe(0);
  expect(result.balance).toBe(USER_COINS_MAX);
});

test('getCastleCoinBalance returns CASTLE_COINS_MIN when empty', async () => {
  await clearCastleCoins();
  const balance = await getCastleCoinBalance();
  expect(balance).toBe(CASTLE_COINS_MIN);
});

test('getCastleCoinBalance returns stored value when set', async () => {
  await clearCastleCoins();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  await addCoinsToCastle(userId, 20);
  const balance = await getCastleCoinBalance();
  expect(balance).toBe(20);
});

test('addCoinsToCastle deposits and returns correct balances', async () => {
  await clearCastleCoins();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  const result = await addCoinsToCastle(userId, 15);
  expect(result.deposited).toBe(15);
  expect(result.userBalance).toBe(85);
  expect(result.castleBalance).toBe(15);
});

test('addCoinsToCastle returns 0 deposited when insufficient user funds', async () => {
  vi.useFakeTimers();
  await clearCastleCoins();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  await spendUserCoins(userId, 95);
  const result = await addCoinsToCastle(userId, 20);
  expect(result.deposited).toBe(0);
  expect(result.userBalance).toBe(5);
  expect(result.castleBalance).toBe(CASTLE_COINS_MIN);
});

test('takeCoinsFromCastle withdraws when castle has funds and user has capacity', async () => {
  vi.useFakeTimers();
  await clearCastleCoins();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  await addCoinsToCastle(userId, 30); // user 70, castle 30
  await spendUserCoins(userId, 50); // user 20
  const result = await takeCoinsFromCastle(userId, 10);
  expect(result.withdrawn).toBe(10);
  expect(result.userBalance).toBe(30); // 20 + 10
  expect(result.castleBalance).toBe(20); // 30 - 10
});

test('takeCoinsFromCastle returns 0 withdrawn when castle insufficient', async () => {
  vi.useFakeTimers();
  await clearCastleCoins();
  const userId = uniqueUserId();
  await getUserCoinBalance(userId);
  await addCoinsToCastle(userId, 5); // user 95, castle 5
  await spendUserCoins(userId, 50); // user 45
  const result = await takeCoinsFromCastle(userId, 10);
  expect(result.withdrawn).toBe(0);
  expect(result.userBalance).toBe(45);
  expect(result.castleBalance).toBe(5);
});

test('takeCoinsFromCastle returns 0 when user at USER_COINS_MAX', async () => {
  vi.useFakeTimers();
  await clearCastleCoins();
  const funderId = uniqueUserId();
  const userId = uniqueUserId();
  await getUserCoinBalance(funderId);
  await addCoinsToCastle(funderId, 50);
  await getUserCoinBalance(userId);
  const result = await takeCoinsFromCastle(userId, 10);
  expect(result.withdrawn).toBe(0);
  expect(result.userBalance).toBe(USER_COINS_MAX);
  expect(result.castleBalance).toBe(50);
});

import { expect } from 'vitest';
import { createTestApp, devvitTest, postJson } from '../helpers/devvitTest';

devvitTest('castle coin deposit and withdraw journey', async () => {
  const app = createTestApp();

  const depositResponse = await postJson(app, '/api/castle/coins/deposit', {
    amount: 10,
  });
  expect(depositResponse.status).toBe(200);
  const depositBody = await depositResponse.json();
  expect(depositBody.type).toBe('castleCoinsDeposit');
  expect(Number(depositBody.castleCoins)).toBe(10);

  const withdrawResponse = await postJson(app, '/api/castle/coins/withdraw', {
    amount: 5,
  });
  expect(withdrawResponse.status).toBe(200);
  const withdrawBody = await withdrawResponse.json();
  expect(withdrawBody.type).toBe('castleCoinsWithdraw');
  expect(Number(withdrawBody.castleCoins)).toBe(5);
});

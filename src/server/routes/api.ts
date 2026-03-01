import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  CommandResponse,
  CoinBalanceResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  JoinRequest,
  JoinResponse,
  MetaSyncResponse,
  ResyncRequest,
  ResyncResponse,
  StructuresSyncResponse,
} from '../../shared/game-protocol';
import { isCommandRequest } from '../../shared/game-protocol';
import type {
  CastleCoinsBalanceResponse,
  CastleCoinsDepositResponse,
  CastleCoinsWithdrawResponse,
  GamePreviewResponse,
} from '../../shared/api';
import { isRecord, parsePositiveInt } from '../../shared/utils';
import type { T2 } from '@devvit/web/shared';
import {
  applyCommand,
  getCoinBalance,
  getGamePreview,
  getMetaSync,
  getPlayerId,
  getStructuresSync,
  heartbeatGame,
  joinGame,
  resetGame,
  resyncGame,
} from '../game/handlers';
import {
  addCoinsToCastle,
  getCastleCoinBalance,
  takeCoinsFromCastle,
} from '../game/economy';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const resolvePlayerId = async (c: Context): Promise<string> => {
  const testUserId = c.req.header('x-test-user-id');
  if (testUserId) return testUserId;
  return getPlayerId();
};

const requireObjectBody = async (
  c: Context
): Promise<Record<string, unknown> | Response> => {
  const body = await c.req.json().catch(() => undefined);
  if (!isRecord(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'invalid request body' },
      400
    );
  }
  return body;
};
api.post('/game/join', async (c) => {
  try {
    // Request body currently optional; reserved for future join options.
    await c.req.json<JoinRequest>().catch(() => undefined);
    const playerId = await resolvePlayerId(c);
    const response = await joinGame(playerId);
    return c.json<JoinResponse>(response);
  } catch (error) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'failed to join game',
      },
      400
    );
  }
});

api.post('/game/command', async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (!isCommandRequest(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'invalid command payload' },
      400
    );
  }

  const playerId = await resolvePlayerId(c);
  const response = await applyCommand(body.envelope, playerId);
  return c.json<CommandResponse>(response, response.accepted ? 200 : 429);
});

api.post('/game/heartbeat', async (c) => {
  const bodyResult = await requireObjectBody(c);
  if (!isRecord(bodyResult)) return bodyResult;
  const body = bodyResult;
  const request: HeartbeatRequest = {
    playerId: String(body.playerId ?? ''),
    position: isRecord(body.position)
      ? {
          x: Number(body.position.x ?? 0),
          z: Number(body.position.z ?? 0),
        }
      : undefined,
  };

  if (!request.playerId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'playerId is required' },
      400
    );
  }

  const response = await heartbeatGame(request.playerId, request.position);
  return c.json<HeartbeatResponse>(response);
});

api.get('/game/coins', async (c) => {
  const playerId = await resolvePlayerId(c);
  const coins = await getCoinBalance(playerId);
  return c.json<CoinBalanceResponse>({
    type: 'coinBalance',
    coins,
  });
});

api.get('/game/preview', async (c) => {
  try {
    const preview = await getGamePreview();
    return c.json<GamePreviewResponse>(preview);
  } catch (error) {
    return c.json<GamePreviewResponse>(
      { wave: 0, mobsLeft: 0, playerCount: 0 },
      200
    );
  }
});

api.get('/game/structures', async (c) => {
  const response = await getStructuresSync();
  return c.json<StructuresSyncResponse>(response);
});

api.get('/game/meta', async (c) => {
  const response = await getMetaSync();
  return c.json<MetaSyncResponse>(response);
});

api.post('/game/resync', async (c) => {
  const body = await c.req.json<ResyncRequest>().catch(() => undefined);
  const request: ResyncRequest = {
    playerId: body?.playerId ? String(body.playerId) : undefined,
  };
  const playerId = request.playerId ?? (await resolvePlayerId(c));
  const response = await resyncGame(playerId);
  return c.json<ResyncResponse>(response);
});

api.post('/game/reset', async (c) => {
  try {
    await c.req.json().catch(() => undefined);
    const playerId = await resolvePlayerId(c);
    await resetGame(playerId);
    return c.json({
      showToast: 'Game reset',
    });
  } catch (error) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to reset game',
      },
      500
    );
  }
});

api.get('/castle/coins', async (c) => {
  const castleBalance = await getCastleCoinBalance();
  return c.json<CastleCoinsBalanceResponse>({
    type: 'castleCoinsBalance',
    castleCoins: castleBalance,
  });
});

api.post('/castle/coins/deposit', async (c) => {
  const bodyResult = await requireObjectBody(c);
  if (!isRecord(bodyResult)) return bodyResult;
  const body = bodyResult;
  const amount = parsePositiveInt(body.amount);
  if (amount <= 0) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'amount must be positive' },
      400
    );
  }
  const playerId = (await resolvePlayerId(c)) as T2;
  const result = await addCoinsToCastle(playerId, amount);
  if (result.deposited === 0) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'insufficient coins' },
      400
    );
  }
  return c.json<CastleCoinsDepositResponse>({
    type: 'castleCoinsDeposit',
    deposited: result.deposited,
    castleCoins: result.castleBalance,
    coins: result.userBalance,
  });
});

api.post('/castle/coins/withdraw', async (c) => {
  const bodyResult = await requireObjectBody(c);
  if (!isRecord(bodyResult)) return bodyResult;
  const body = bodyResult;
  const requested = parsePositiveInt(body.amount);
  if (requested <= 0) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'amount must be positive' },
      400
    );
  }
  const playerId = (await resolvePlayerId(c)) as T2;
  const result = await takeCoinsFromCastle(playerId, requested);
  return c.json<CastleCoinsWithdrawResponse>({
    type: 'castleCoinsWithdraw',
    withdrawn: result.withdrawn,
    castleCoins: result.castleBalance,
    coins: result.userBalance,
  });
});

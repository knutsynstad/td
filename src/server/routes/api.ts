import { context, redis, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type {
  CommandResponse,
  CoinBalanceResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  JoinRequest,
  JoinResponse,
  ResyncRequest,
  ResyncResponse,
} from '../../shared/game-protocol';
import { isCommandRequest } from '../../shared/game-protocol';
import type {
  CastleCoinsBalanceResponse,
  CastleCoinsDepositResponse,
  CastleCoinsWithdrawResponse,
  DecrementResponse,
  IncrementResponse,
  InitResponse
} from '../../shared/api';
import { applyCommand, getCoinBalance, heartbeatGame, joinGame, resyncGame } from '../game/service';
import { depositCoinsToCastle, getCastleCoins, withdrawCoinsFromCastle } from '../game/store';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const parsePositiveInt = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const [count, username] = await Promise.all([redis.get('count'), reddit.getCurrentUsername()]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: count ? parseInt(count, 10) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const errorMessage =
      error instanceof Error ? `Initialization failed: ${error.message}` : 'Unknown error during initialization';
    return c.json<ErrorResponse>({ status: 'error', message: errorMessage }, 400);
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({
    count,
    postId,
    type: 'increment',
  });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({
    count,
    postId,
    type: 'decrement',
  });
});

api.post('/game/join', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  try {
    // Request body currently optional; reserved for future join options.
    await c.req.json<JoinRequest>().catch(() => undefined);
    const response = await joinGame(postId);
    return c.json<JoinResponse>(response);
  } catch (error) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'failed to join game',
      },
      400,
    );
  }
});

api.post('/game/command', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  const body = await c.req.json().catch(() => undefined);
  if (!isCommandRequest(body)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'invalid command payload' }, 400);
  }

  const response = await applyCommand(postId, body.envelope);
  return c.json<CommandResponse>(response, response.accepted ? 200 : 429);
});

api.post('/game/heartbeat', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const body = await c.req.json().catch(() => undefined);
  if (!isObject(body)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'invalid heartbeat payload' }, 400);
  }
  const request: HeartbeatRequest = {
    playerId: String(body.playerId ?? ''),
    position: isObject(body.position)
      ? {
          x: Number(body.position.x ?? 0),
          z: Number(body.position.z ?? 0),
        }
      : undefined,
  };

  if (!request.playerId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'playerId is required' }, 400);
  }

  const response = await heartbeatGame(postId, request.playerId, request.position);
  return c.json<HeartbeatResponse>(response);
});

api.get('/game/coins', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const coins = await getCoinBalance();
  return c.json<CoinBalanceResponse>({
    type: 'coinBalance',
    coins
  });
});

api.post('/game/resync', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const body = await c.req.json<ResyncRequest>().catch(() => undefined);
  const request: ResyncRequest = {
    tickSeq: Number(body?.tickSeq ?? 0),
    playerId: body?.playerId ? String(body.playerId) : undefined,
  };
  const response = await resyncGame(postId, request.playerId);
  return c.json<ResyncResponse>(response);
});

api.get('/castle/coins', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const castleCoins = await getCastleCoins();
  return c.json<CastleCoinsBalanceResponse>({
    type: 'castleCoinsBalance',
    postId,
    castleCoins
  });
});

api.post('/castle/coins/deposit', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const body = await c.req.json().catch(() => undefined);
  if (!isObject(body)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'invalid request body' }, 400);
  }
  const amount = parsePositiveInt(body.amount);
  if (amount <= 0) {
    return c.json<ErrorResponse>({ status: 'error', message: 'amount must be positive' }, 400);
  }
  const result = await depositCoinsToCastle(amount, Date.now());
  if (!result.ok) {
    return c.json<ErrorResponse>({ status: 'error', message: 'insufficient coins' }, 400);
  }
  return c.json<CastleCoinsDepositResponse>({
    type: 'castleCoinsDeposit',
    postId,
    deposited: result.deposited,
    castleCoins: result.castleCoins
  });
});

api.post('/castle/coins/withdraw', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const body = await c.req.json().catch(() => undefined);
  if (!isObject(body)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'invalid request body' }, 400);
  }
  const requested = parsePositiveInt(body.amount);
  if (requested <= 0) {
    return c.json<ErrorResponse>({ status: 'error', message: 'amount must be positive' }, 400);
  }
  const result = await withdrawCoinsFromCastle(requested, Date.now());
  return c.json<CastleCoinsWithdrawResponse>({
    type: 'castleCoinsWithdraw',
    postId,
    withdrawn: result.withdrawn,
    castleCoins: result.castleCoins
  });
});

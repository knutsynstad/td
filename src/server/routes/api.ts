import { context, redis, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type {
  CommandResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  JoinRequest,
  JoinResponse,
  ResyncRequest,
  ResyncResponse,
} from '../../shared/game-protocol';
import { isCommandRequest } from '../../shared/game-protocol';
import type {
  BankBalanceResponse,
  BankDepositResponse,
  BankWithdrawResponse,
  DecrementResponse,
  IncrementResponse,
  InitResponse
} from '../../shared/api';
import { applyCommand, heartbeatGame, joinGame, resyncGame } from '../game/service';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const BANK_ENERGY_KEY = 'game:bankEnergy';
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

api.post('/game/resync', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  await c.req.json<ResyncRequest>().catch(() => undefined);
  const response = await resyncGame(postId);
  return c.json<ResyncResponse>(response);
});

api.get('/game/bank', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const raw = await redis.get(BANK_ENERGY_KEY);
  const bankEnergy = parsePositiveInt(raw ?? 0);
  return c.json<BankBalanceResponse>({
    type: 'bankBalance',
    postId,
    bankEnergy
  });
});

api.post('/game/bank/deposit', async (c) => {
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
  const bankEnergy = await redis.incrBy(BANK_ENERGY_KEY, amount);
  return c.json<BankDepositResponse>({
    type: 'bankDeposit',
    postId,
    deposited: amount,
    bankEnergy
  });
});

api.post('/game/bank/withdraw', async (c) => {
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
  const current = parsePositiveInt((await redis.get(BANK_ENERGY_KEY)) ?? 0);
  const withdrawn = Math.min(current, requested);
  const bankEnergy = withdrawn > 0 ? await redis.incrBy(BANK_ENERGY_KEY, -withdrawn) : current;
  return c.json<BankWithdrawResponse>({
    type: 'bankWithdraw',
    postId,
    withdrawn,
    bankEnergy
  });
});

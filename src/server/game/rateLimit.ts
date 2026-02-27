import { consumeToken } from '../core/rateLimit';
import { MAX_RATE_TOKENS, RATE_REFILL_PER_SECOND } from './config';
import { getGameRedisKeys } from './keys';

export const consumeRateLimitToken = async (
  playerId: string,
  nowMs: number
): Promise<boolean> => {
  const keys = getGameRedisKeys();
  return consumeToken(keys.rate, playerId, nowMs, {
    maxTokens: MAX_RATE_TOKENS,
    refillPerSecond: RATE_REFILL_PER_SECOND,
  });
};

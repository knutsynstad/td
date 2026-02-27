import { redis } from '@devvit/web/server';
import { isRecord } from '../../shared/utils';

const MAX_TX_RETRIES = 5;

const toJson = (value: unknown): string => JSON.stringify(value);

const parseJson = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export type RateLimitConfig = {
  maxTokens: number;
  refillPerSecond: number;
};

export const consumeToken = async (
  hashKey: string,
  id: string,
  nowMs: number,
  config: RateLimitConfig
): Promise<boolean> => {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(hashKey);
    const raw = await redis.hGet(hashKey, id);
    const parsed = parseJson(raw ?? undefined);
    const current = isRecord(parsed)
      ? {
          tokens: Number(parsed.tokens ?? config.maxTokens),
          lastRefillMs: Number(parsed.lastRefillMs ?? nowMs),
        }
      : {
          tokens: config.maxTokens,
          lastRefillMs: nowMs,
        };

    const elapsed = Math.max(0, nowMs - current.lastRefillMs);
    const refill = (elapsed / 1000) * config.refillPerSecond;
    const tokens = Math.min(config.maxTokens, current.tokens + refill);
    const hasToken = tokens >= 1;
    const nextTokens = hasToken ? tokens - 1 : tokens;

    await tx.multi();
    await tx.hSet(hashKey, {
      [id]: toJson({
        tokens: nextTokens,
        lastRefillMs: nowMs,
      }),
    });
    const result = await tx.exec();
    if (result !== null) {
      return hasToken;
    }
  }
  return false;
};

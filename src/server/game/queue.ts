import { redis } from '@devvit/web/server';
import type { CommandEnvelope } from '../../shared/game-protocol';
import { MAX_COMMANDS_PER_BATCH, MAX_QUEUE_COMMANDS } from './config';
import { getGameRedisKeys } from './keys';
import { parseCommandEnvelope, parseJson, toJson } from './parsers';

const MAX_TX_RETRIES = 5;

export const enqueueCommand = async (
  nowMs: number,
  envelope: CommandEnvelope
): Promise<{ accepted: boolean; reason?: string }> => {
  const keys = getGameRedisKeys();
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(keys.queue);
    const queueSize = await redis.zCard(keys.queue);
    if (queueSize >= MAX_QUEUE_COMMANDS) {
      await tx.unwatch();
      return { accepted: false, reason: 'command queue is full' };
    }
    await tx.multi();
    await tx.zAdd(keys.queue, {
      member: toJson(envelope),
      score: nowMs,
    });
    const result = await tx.exec();
    if (result !== null) {
      return { accepted: true };
    }
  }
  return { accepted: false, reason: 'queue contention' };
};

export const popPendingCommands = async (
  upToMs: number
): Promise<CommandEnvelope[]> => {
  const keys = getGameRedisKeys();
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(keys.queue);
    const items = await redis.zRange(keys.queue, 0, upToMs, {
      by: 'score',
      limit: { offset: 0, count: MAX_COMMANDS_PER_BATCH },
    });
    if (items.length === 0) {
      await tx.unwatch();
      return [];
    }

    const envelopes: CommandEnvelope[] = [];
    const membersToRemove: string[] = [];
    for (const item of items) {
      const parsed = parseJson(item.member);
      const envelope = parseCommandEnvelope(parsed);
      if (envelope) {
        envelopes.push(envelope);
      }
      membersToRemove.push(item.member);
    }

    if (membersToRemove.length === 0) {
      await tx.unwatch();
      return [];
    }

    await tx.multi();
    await tx.zRem(keys.queue, membersToRemove);
    const result = await tx.exec();
    if (result !== null) {
      return envelopes;
    }
  }
  return [];
};

export const trimCommandQueue = async (): Promise<void> => {
  const keys = getGameRedisKeys();
  const count = await redis.zCard(keys.queue);
  if (count <= MAX_QUEUE_COMMANDS) return;
  const overflow = count - MAX_QUEUE_COMMANDS;
  await redis.zRemRangeByRank(keys.queue, 0, overflow - 1);
};

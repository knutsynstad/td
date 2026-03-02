import { redis } from '@devvit/web/server';
import type { CommandEnvelope } from '../../shared/game-protocol';
import { safeParseJson } from '../../shared/utils';
import {
  MAX_COMMANDS_PER_BATCH,
  MAX_QUEUE_COMMANDS,
  MAX_TX_RETRIES,
} from '../config';
import { KEYS } from '../core/keys';
import { parseCommandEnvelope } from '../game/parse';

export async function enqueueCommand(
  nowMs: number,
  envelope: CommandEnvelope
): Promise<{ accepted: boolean; reason?: string }> {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.QUEUE);
    const queueSize = await redis.zCard(KEYS.QUEUE);
    if (queueSize >= MAX_QUEUE_COMMANDS) {
      await tx.unwatch();
      console.log(
        `[Queue] enqueue rejected: queue full, size=${queueSize}`
      );
      return { accepted: false, reason: 'command queue is full' };
    }
    await tx.multi();
    await tx.zAdd(KEYS.QUEUE, {
      member: JSON.stringify(envelope),
      score: nowMs,
    });
    try {
      const result = await tx.exec();
      if (result !== null) {
        return { accepted: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('transaction failed') && !msg.includes('EXECABORT')) {
        throw err;
      }
      continue;
    }
  }
  console.log(
    `[Queue] enqueue rejected: contention after ${MAX_TX_RETRIES} retries`
  );
  return { accepted: false, reason: 'queue contention' };
}

export async function popPendingCommands(
  upToMs: number
): Promise<CommandEnvelope[]> {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.QUEUE);
    const items = await redis.zRange(KEYS.QUEUE, 0, upToMs, {
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
      const parsed = safeParseJson(item.member);
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
    await tx.zRem(KEYS.QUEUE, membersToRemove);
    try {
      const result = await tx.exec();
      if (result !== null) {
        return envelopes;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('transaction failed') && !msg.includes('EXECABORT')) {
        throw err;
      }
      continue;
    }
  }
  console.log(
    `[Queue] pop failed: contention after ${MAX_TX_RETRIES} retries, queue may be growing`
  );
  return [];
}

export async function trimCommandQueue(): Promise<void> {
  const count = await redis.zCard(KEYS.QUEUE);
  if (count <= MAX_QUEUE_COMMANDS) return;
  const overflow = count - MAX_QUEUE_COMMANDS;
  await redis.zRemRangeByRank(KEYS.QUEUE, 0, overflow - 1);
  console.log(`[Queue] trim: removed ${overflow} oldest, was ${count}`);
}

export async function getQueueSize(): Promise<number> {
  return redis.zCard(KEYS.QUEUE);
}

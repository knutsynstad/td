import { redis } from '@devvit/web/server';
import type { CommandEnvelope } from '../../shared/game-protocol';
import { parseVec2 } from '../../shared/game-state';
import { isRecord, safeParseJson } from '../../shared/utils';
import { MAX_COMMANDS_PER_BATCH, MAX_QUEUE_COMMANDS } from '../config';
import { KEYS } from '../core/redis';
import { parseIntent } from './players';
import { parseStructureType } from './world';

const MAX_TX_RETRIES = 5;

const parseCommandEnvelope = (value: unknown): CommandEnvelope | undefined => {
  if (!isRecord(value)) return undefined;
  const seq = Number(value.seq ?? -1);
  const sentAtMs = Number(value.sentAtMs ?? 0);
  if (!isRecord(value.command)) return undefined;
  const commandType = String(value.command.type ?? '');
  const playerId = String(value.command.playerId ?? '');
  if (commandType === 'moveIntent') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'moveIntent',
        playerId,
        intent: parseIntent(value.command.intent),
        clientPosition: value.command.clientPosition
          ? parseVec2(value.command.clientPosition)
          : undefined,
      },
    };
  }
  if (commandType === 'buildStructure') {
    const structure = isRecord(value.command.structure)
      ? value.command.structure
      : {};
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructure',
        playerId,
        structure: {
          structureId: String(structure.structureId ?? ''),
          type: parseStructureType(structure.type),
          center: parseVec2(structure.center),
        },
      },
    };
  }
  if (commandType === 'buildStructures') {
    const rawStructures = Array.isArray(value.command.structures)
      ? value.command.structures
      : [];
    const structures = rawStructures
      .filter(isRecord)
      .map((structure) => ({
        structureId: String(structure.structureId ?? ''),
        type: parseStructureType(structure.type),
        center: parseVec2(structure.center),
      }))
      .filter((structure) => structure.structureId.length > 0);
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructures',
        playerId,
        structures,
      },
    };
  }
  if (commandType === 'removeStructure') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'removeStructure',
        playerId,
        structureId: String(value.command.structureId ?? ''),
      },
    };
  }
  if (commandType === 'startWave') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'startWave',
        playerId,
      },
    };
  }
  if (commandType === 'shoot') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'shoot',
        playerId,
        target: parseVec2(value.command.target),
      },
    };
  }
  return undefined;
};

export const enqueueCommand = async (
  nowMs: number,
  envelope: CommandEnvelope
): Promise<{ accepted: boolean; reason?: string }> => {
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.queue);
    const queueSize = await redis.zCard(KEYS.queue);
    if (queueSize >= MAX_QUEUE_COMMANDS) {
      await tx.unwatch();
      return { accepted: false, reason: 'command queue is full' };
    }
    await tx.multi();
    await tx.zAdd(KEYS.queue, {
      member: JSON.stringify(envelope),
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
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    const tx = await redis.watch(KEYS.queue);
    const items = await redis.zRange(KEYS.queue, 0, upToMs, {
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
    await tx.zRem(KEYS.queue, membersToRemove);
    const result = await tx.exec();
    if (result !== null) {
      return envelopes;
    }
  }
  return [];
};

export const trimCommandQueue = async (): Promise<void> => {
  const count = await redis.zCard(KEYS.queue);
  if (count <= MAX_QUEUE_COMMANDS) return;
  const overflow = count - MAX_QUEUE_COMMANDS;
  await redis.zRemRangeByRank(KEYS.queue, 0, overflow - 1);
};

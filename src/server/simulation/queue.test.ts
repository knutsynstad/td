import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { enqueueCommand, getQueueSize, popPendingCommands } from './queue';

const test = createDevvitTest();

test('pop empty queue returns empty array', async () => {
  const result = await popPendingCommands();
  expect(result).toEqual([]);
  expect(await getQueueSize()).toBe(0);
});

test('enqueue and pop returns dealDamages command', async () => {
  const nowMs = Date.now();
  const envelope = {
    seq: 1,
    sentAtMs: nowMs,
    command: {
      type: 'dealDamages' as const,
      hits: [
        {
          mobId: '1',
          damage: 150,
          source: 'player' as const,
          playerId: 'player-a',
        },
      ],
    },
  };

  const enqueueResult = await enqueueCommand(nowMs, envelope);
  expect(enqueueResult.accepted).toBe(true);
  expect(await getQueueSize()).toBe(1);

  const commands = await popPendingCommands();
  expect(commands).toHaveLength(1);
  expect(commands[0]?.command.type).toBe('dealDamages');
  expect(commands[0]?.command).toMatchObject({
    type: 'dealDamages',
    hits: [
      {
        mobId: '1',
        damage: 150,
        source: 'player',
        playerId: 'player-a',
      },
    ],
  });

  expect(await getQueueSize()).toBe(0);
  const afterPop = await popPendingCommands();
  expect(afterPop).toEqual([]);
});

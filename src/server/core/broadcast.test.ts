import { createDevvitTest } from '@devvit/test/server/vitest';
import { realtime } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import type { GameDelta } from '../../shared/game-protocol';
import { MAX_BATCH_EVENTS } from '../config';
import { broadcast, CHANNELS } from './broadcast';

const test = createDevvitTest();

const mkDelta = (): GameDelta => ({ type: 'presenceDelta' });

test('empty events sends nothing', async ({ mocks }) => {
  await broadcast(1, 2, []);

  const msgs = mocks.realtime.getSentMessagesForChannel(CHANNELS.game);
  expect(msgs).toHaveLength(0);
});

test('single batch sends one message', async ({ mocks }) => {
  const events: GameDelta[] = [mkDelta(), mkDelta(), mkDelta()];
  await broadcast(1, 2, events);

  const msgs = mocks.realtime.getSentMessagesForChannel(CHANNELS.game);
  expect(msgs).toHaveLength(1);
  expect(msgs[0].data?.msg).toEqual({
    tickSeq: 2,
    worldVersion: 1,
    channelId: CHANNELS.game,
    events,
  });
});

test('splits into multiple batches', async ({ mocks }) => {
  const events: GameDelta[] = Array.from({ length: MAX_BATCH_EVENTS + 5 }, () =>
    mkDelta()
  );
  await broadcast(3, 4, events);

  const msgs = mocks.realtime.getSentMessagesForChannel(CHANNELS.game);
  expect(msgs).toHaveLength(2);
  expect(msgs[0].data?.msg).toEqual({
    tickSeq: 4,
    worldVersion: 3,
    channelId: CHANNELS.game,
    events: events.slice(0, MAX_BATCH_EVENTS),
  });
  expect(msgs[1].data?.msg).toEqual({
    tickSeq: 4,
    worldVersion: 3,
    channelId: CHANNELS.game,
    events: events.slice(MAX_BATCH_EVENTS),
  });
});

test('error in one batch does not stop subsequent batches', async ({
  mocks,
}) => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const sendSpy = vi.spyOn(realtime, 'send');
  sendSpy.mockRejectedValueOnce(new Error('network'));

  const events: GameDelta[] = Array.from({ length: MAX_BATCH_EVENTS + 5 }, () =>
    mkDelta()
  );
  await broadcast(3, 4, events);

  expect(sendSpy).toHaveBeenCalledTimes(2);
  expect(errorSpy).toHaveBeenCalledWith('Realtime broadcast failed', {
    channel: CHANNELS.game,
    error: expect.any(Error),
  });

  const msgs = mocks.realtime.getSentMessagesForChannel(CHANNELS.game);
  expect(msgs).toHaveLength(1);
  expect(msgs[0].data?.msg).toEqual({
    tickSeq: 4,
    worldVersion: 3,
    channelId: CHANNELS.game,
    events: events.slice(MAX_BATCH_EVENTS),
  });
});

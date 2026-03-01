import { createDevvitTest } from '@devvit/test/server/vitest';
import { realtime } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import { broadcast } from './broadcast';
import { MAX_BATCH_EVENTS } from '../config';

const test = createDevvitTest();

const identity = (batch: number[]) => batch;

test('empty events sends nothing', async ({ mocks }) => {
  await broadcast('ch', [], identity);

  const msgs = mocks.realtime.getSentMessagesForChannel('ch');
  expect(msgs).toHaveLength(0);
});

test('single batch sends one message', async ({ mocks }) => {
  const events = [1, 2, 3];
  await broadcast('ch', events, identity);

  const msgs = mocks.realtime.getSentMessagesForChannel('ch');
  expect(msgs).toHaveLength(1);
  expect(msgs[0].data?.msg).toEqual([1, 2, 3]);
});

test('splits into multiple batches', async ({ mocks }) => {
  const events = Array.from({ length: MAX_BATCH_EVENTS + 5 }, (_, i) => i);
  await broadcast('ch', events, identity);

  const msgs = mocks.realtime.getSentMessagesForChannel('ch');
  expect(msgs).toHaveLength(2);
  expect(msgs[0].data?.msg).toEqual(events.slice(0, MAX_BATCH_EVENTS));
  expect(msgs[1].data?.msg).toEqual(events.slice(MAX_BATCH_EVENTS));
});

test('error in one batch does not stop subsequent batches', async ({
  mocks,
}) => {
  const sendSpy = vi.spyOn(realtime, 'send');
  sendSpy.mockRejectedValueOnce(new Error('network'));

  const events = Array.from({ length: MAX_BATCH_EVENTS + 5 }, (_, i) => i);
  await broadcast('ch', events, identity);

  expect(sendSpy).toHaveBeenCalledTimes(2);

  const msgs = mocks.realtime.getSentMessagesForChannel('ch');
  expect(msgs).toHaveLength(1);
  expect(msgs[0].data?.msg).toEqual(events.slice(MAX_BATCH_EVENTS));
});

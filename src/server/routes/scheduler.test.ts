import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { Hono } from 'hono';
import { schedulerRoutes } from './scheduler';

const test = createDevvitTest();

const app = (): Hono => {
  const hono = new Hono();
  hono.route('/internal/scheduler', schedulerRoutes);
  return hono;
};

test('scheduler tick works without explicit postId body', async () => {
  const response = await app().request('/internal/scheduler/game-tick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('success');
});

test('scheduler maintenance returns success', async () => {
  const response = await app().request('/internal/scheduler/game-maintenance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(200);
});

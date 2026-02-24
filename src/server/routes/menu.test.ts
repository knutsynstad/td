import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { Hono } from 'hono';
import { menuRoutes } from './menu';

const test = createDevvitTest();

const app = (): Hono => {
  const hono = new Hono();
  hono.route('/internal/menu', menuRoutes);
  return hono;
};

test('menu reset-game endpoint returns a toast response', async () => {
  const response = await app().request('/internal/menu/reset-game', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.showToast).toContain('Game reset');
});

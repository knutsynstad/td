import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { Hono } from 'hono';
import { api } from './api';

const test = createDevvitTest();

const app = (): Hono => {
  const hono = new Hono();
  hono.route('/api', api);
  return hono;
};

test('join returns a snapshot payload', async () => {
  const response = await app().request('/api/game/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.type).toBe('join');
});

test('heartbeat rejects missing playerId', async () => {
  const response = await app().request('/api/game/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(400);
});

test('preview returns wave, mobsLeft, playerCount', async () => {
  const response = await app().request('/api/game/preview', {
    method: 'GET',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    wave: number;
    mobsLeft: number;
    playerCount: number;
  };
  expect(typeof body.wave).toBe('number');
  expect(typeof body.mobsLeft).toBe('number');
  expect(typeof body.playerCount).toBe('number');
});

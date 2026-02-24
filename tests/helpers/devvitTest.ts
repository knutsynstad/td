import { createDevvitTest } from '@devvit/test/server/vitest';
import { Hono } from 'hono';
import { api } from '../../src/server/routes/api';
import { schedulerRoutes } from '../../src/server/routes/scheduler';
import type { CommandRequest } from '../../src/shared/game-protocol';

export const devvitTest = createDevvitTest();

export const createTestApp = (): Hono => {
  const app = new Hono();
  const internal = new Hono();
  internal.route('/scheduler', schedulerRoutes);
  app.route('/api', api);
  app.route('/internal', internal);
  return app;
};

export const postJson = async (
  app: Hono,
  path: string,
  body: unknown
): Promise<Response> =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const getJson = async (app: Hono, path: string): Promise<Response> =>
  app.request(path, { method: 'GET' });

export const makeEnvelope = (
  seq: number,
  command: CommandRequest['envelope']['command']
): CommandRequest => ({
  envelope: {
    seq,
    sentAtMs: Date.now(),
    command,
  },
});

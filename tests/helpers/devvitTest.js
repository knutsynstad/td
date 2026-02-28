import { createDevvitTest } from '@devvit/test/server/vitest';
import { Hono } from 'hono';
import { api } from '../../src/server/routes/api';
import { schedulerRoutes } from '../../src/server/routes/scheduler';
export const devvitTest = createDevvitTest();
export const createTestApp = () => {
  const app = new Hono();
  const internal = new Hono();
  internal.route('/scheduler', schedulerRoutes);
  app.route('/api', api);
  app.route('/internal', internal);
  return app;
};
export const TEST_USER_ID = 'test-user';
export const postJson = async (app, path, body) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user-id': TEST_USER_ID,
    },
    body: JSON.stringify(body ?? {}),
  });
export const getJson = async (app, path) =>
  app.request(path, {
    method: 'GET',
    headers: { 'x-test-user-id': TEST_USER_ID },
  });
export const makeEnvelope = (seq, command) => ({
  envelope: {
    seq,
    sentAtMs: Date.now(),
    command,
  },
});
//# sourceMappingURL=devvitTest.js.map

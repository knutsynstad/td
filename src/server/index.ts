import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { Hono } from 'hono';
import { api } from './routes/api';
import { menuRoutes } from './routes/menu';
import { schedulerRoutes } from './routes/scheduler';

const app = new Hono();
const internal = new Hono();

internal.route('/scheduler', schedulerRoutes);
internal.route('/menu', menuRoutes);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});

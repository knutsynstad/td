import { Hono } from 'hono';
import { runLeaderLoop } from '../game';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/server-clock', async (c) => {
  try {
    const result = await runLeaderLoop();
    return c.json({
      status: 'ok',
      owner: result.ownerToken,
      durationMs: result.durationMs,
      ticksProcessed: result.ticksProcessed,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'leader loop failed',
      },
      500
    );
  }
});

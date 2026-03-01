import { Hono } from 'hono';
import { runGameLoop } from '../simulation/gameLoop';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/server-clock', async (c) => {
  try {
    const windowMs = c.req.query('windowMs')
      ? parseInt(c.req.query('windowMs')!, 10)
      : undefined;
    const result = await runGameLoop(windowMs);
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
        message: error instanceof Error ? error.message : 'game loop failed',
      },
      500
    );
  }
});

import { Hono } from 'hono';
import { runLeaderLoop, runMaintenance } from '../game/service';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/game-maintenance', async (c) => {
  try {
    const result = await runMaintenance();
    return c.json({
      status: 'success',
      stalePlayers: result.stalePlayers,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'maintenance failed',
      },
      500
    );
  }
});

schedulerRoutes.post('/game-tick', async (c) => {
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

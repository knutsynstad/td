import { Hono } from 'hono';
import { runMaintenance, runSchedulerTick } from '../game/service';

type TaskResponse = {
  status: 'success' | 'error';
  stalePlayers?: number;
  tickSeq?: number;
  worldVersion?: number;
  eventCount?: number;
  remainingSteps?: number;
  message?: string;
};

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/game-maintenance', async (c) => {
  try {
    const result = await runMaintenance();
    return c.json<TaskResponse>({
      status: 'success',
      stalePlayers: result.stalePlayers,
    });
  } catch (error) {
    return c.json<TaskResponse>(
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
    const result = await runSchedulerTick();
    return c.json<TaskResponse>({
      status: 'success',
      tickSeq: result.tickSeq,
      worldVersion: result.worldVersion,
      eventCount: result.eventCount,
      remainingSteps: result.remainingSteps,
    });
  } catch (error) {
    return c.json<TaskResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'tick failed',
      },
      500
    );
  }
});

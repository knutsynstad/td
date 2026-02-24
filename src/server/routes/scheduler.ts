import { context } from '@devvit/web/server';
import { Hono } from 'hono';
import { runMaintenance, runSchedulerTick } from '../game/service';

type TaskRequest<T> = {
  data?: T;
};

type GameMaintenanceData = {
  postId?: string;
};

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
const DEFAULT_GAME_ID = 'global';

schedulerRoutes.post('/game-maintenance', async (c) => {
  try {
    const body = await c.req
      .json<TaskRequest<GameMaintenanceData>>()
      .catch(() => ({}) as TaskRequest<GameMaintenanceData>);
    const postId = body.data?.postId ?? context.postId ?? DEFAULT_GAME_ID;
    const result = await runMaintenance(postId);
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
    const body = await c.req
      .json<TaskRequest<GameMaintenanceData>>()
      .catch(() => ({}) as TaskRequest<GameMaintenanceData>);
    const postId = body.data?.postId ?? context.postId ?? DEFAULT_GAME_ID;
    const result = await runSchedulerTick(postId);
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

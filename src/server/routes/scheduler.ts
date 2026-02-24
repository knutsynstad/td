import { context } from "@devvit/web/server";
import { Hono } from "hono";
import { runMaintenance } from "../game/service";

type TaskRequest<T> = {
  data?: T;
};

type GameMaintenanceData = {
  postId?: string;
};

type TaskResponse = {
  status: "success" | "error";
  stalePlayers?: number;
  message?: string;
};

export const schedulerRoutes = new Hono();

schedulerRoutes.post("/game-maintenance", async (c) => {
  try {
    const body = await c.req.json<TaskRequest<GameMaintenanceData>>();
    const postId = body.data?.postId ?? context.postId;
    if (!postId) {
      return c.json<TaskResponse>(
        {
          status: "error",
          message: "postId missing",
        },
        400,
      );
    }
    const result = await runMaintenance(postId);
    return c.json<TaskResponse>({
      status: "success",
      stalePlayers: result.stalePlayers,
    });
  } catch (error) {
    return c.json<TaskResponse>(
      {
        status: "error",
        message: error instanceof Error ? error.message : "maintenance failed",
      },
      500,
    );
  }
});

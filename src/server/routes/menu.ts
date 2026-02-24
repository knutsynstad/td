import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { resetGame } from '../game/service';

type MenuActionResponse = {
  showToast: string;
};

export const menuRoutes = new Hono();

menuRoutes.post('/create-post', async (c) => {
  try {
    await c.req.json().catch(() => undefined);
    const subredditName = context.subredditName;
    if (!subredditName) {
      return c.json<MenuActionResponse>(
        { showToast: 'Unable to resolve subreddit for new post' },
        400
      );
    }
    await reddit.submitCustomPost({
      subredditName,
      title: 'Tower Defense',
      entry: 'default',
    });
    return c.json<MenuActionResponse>({
      showToast: 'Created a new Tower Defense post',
    });
  } catch (error) {
    return c.json<MenuActionResponse>(
      {
        showToast:
          error instanceof Error ? error.message : 'Failed to create post',
      },
      500
    );
  }
});

menuRoutes.post('/reset-game', async (c) => {
  try {
    await c.req.json().catch(() => undefined);
    await resetGame();
    return c.json<MenuActionResponse>({
      showToast: 'Game reset. Wave 1 will start after the initial countdown.',
    });
  } catch (error) {
    return c.json<MenuActionResponse>(
      {
        showToast:
          error instanceof Error ? error.message : 'Failed to reset game',
      },
      500
    );
  }
});

import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { resetGame } from '../game/handlers';

function toT3PostId(raw: string): `t3_${string}` {
  return raw.startsWith('t3_') ? (raw as `t3_${string}`) : `t3_${raw}`;
}

type MenuActionResponse = {
  showToast: string;
  navigateTo?: { id: string; url?: string } | string;
};

export const menuRoutes = new Hono();

menuRoutes.post('/create-sandbox-post', async (c) => {
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
      title: 'Developer Sandbox',
      entry: 'sandbox-splash',
      splash: {
        backgroundUri: 'transparent.png',
        appDisplayName: 'Developer Sandbox',
      },
    });
    return c.json<MenuActionResponse>({
      showToast: 'Created a Sandbox post',
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
      splash: {
        backgroundUri: 'transparent.png',
        appDisplayName: 'Defend the Castle',
      },
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
    const body = (await c.req.json().catch(() => undefined)) as
      | { targetId?: string; postId?: string }
      | undefined;
    const rawPostId =
      body?.targetId ?? body?.postId ?? (context as { postId?: string }).postId;
    const postId =
      typeof rawPostId === 'string' && rawPostId ? toT3PostId(rawPostId) : undefined;

    await resetGame();

    let navigateTo: MenuActionResponse['navigateTo'] | undefined;
    if (postId) {
      try {
        const post = await reddit.getPostById(postId);
        navigateTo = post;
      } catch {
        // Fallback: build URL from postId and subreddit
        const baseId = postId.replace(/^t3_/, '');
        const subredditName = context.subredditName ?? '';
        if (baseId && subredditName) {
          navigateTo = `https://www.reddit.com/r/${subredditName}/comments/${baseId}/`;
        }
      }
    }

    return c.json<MenuActionResponse>({
      showToast: 'Game reset. Wave 1 will start after the initial countdown.',
      ...(navigateTo && { navigateTo }),
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

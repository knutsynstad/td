import { context } from '@devvit/web/server';
import { Hono } from 'hono';
import { createPost } from '../core/post';

type OnAppInstallRequest = {
  type: string;
};

type TriggerResponse = {
  status: 'success' | 'error';
  message: string;
};

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = (await c.req.json()) as OnAppInstallRequest;

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});

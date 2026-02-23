import { Hono } from 'hono';

type ExampleFormValues = {
  message?: string;
};

type UiResponse = {
  showToast: string;
};

export const forms = new Hono();

forms.post('/example-submit', async (c) => {
  const { message } = (await c.req.json()) as ExampleFormValues;
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  return c.json<UiResponse>(
    {
      showToast: trimmedMessage ? `Form says: ${trimmedMessage}` : 'Form submitted with no message',
    },
    200
  );
});

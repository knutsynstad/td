import { isRecord } from '../../../shared/utils';

export const postJson = async (url: string, body: unknown): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      if (isRecord(errBody) && typeof errBody.reason === 'string') {
        detail = `: ${errBody.reason}`;
      }
    } catch {
      /* ignore */
    }
    throw new Error(`request failed ${response.status}${detail}`);
  }
  return response.json();
};

export const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed ${response.status}`);
  }
  return response.json();
};

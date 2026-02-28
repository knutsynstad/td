import { Hono } from 'hono';
import type { CommandRequest } from '../../src/shared/game-protocol';
export declare const devvitTest: import('vitest').TestAPI<
  import('@devvit/test/server/vitest').DevvitFixtures
>;
export declare const createTestApp: () => Hono;
export declare const TEST_USER_ID = 'test-user';
export declare const postJson: (
  app: Hono,
  path: string,
  body: unknown
) => Promise<Response>;
export declare const getJson: (app: Hono, path: string) => Promise<Response>;
export declare const makeEnvelope: (
  seq: number,
  command: CommandRequest['envelope']['command']
) => CommandRequest;

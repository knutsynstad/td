import { expect } from 'vitest';
import {
  createTestApp,
  devvitTest,
  makeEnvelope,
  postJson,
} from '../helpers/devvitTest';

devvitTest(
  'realtime delta batch contains entityDelta and waveDelta after start wave and tick',
  async ({ mocks }) => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    expect(joinResponse.status).toBe(200);
    const joinBody = await joinResponse.json();
    const playerId = String(joinBody.playerId);
    const channel = String(joinBody.channel);

    const commandResponse = await postJson(
      app,
      '/api/game/command',
      makeEnvelope(1, { type: 'startWave', playerId })
    );
    expect(commandResponse.status).toBe(200);

    await postJson(app, '/internal/scheduler/server-clock?windowMs=2000', {});

    const messages = mocks.realtime.getSentMessagesForChannel(channel);
    expect(messages.length).toBeGreaterThan(0);

    const allEvents = messages.flatMap(
      (m) =>
        (
          m.data?.msg as {
            events?: Array<{
              type?: string;
              mobPool?: unknown;
              despawnedMobIds?: unknown;
            }>;
          }
        )?.events ?? []
    );

    const entityDelta = allEvents.find((e) => e.type === 'entityDelta');
    expect(entityDelta).toBeDefined();
    if (entityDelta && entityDelta.type === 'entityDelta') {
      expect(
        entityDelta.mobPool !== undefined ||
          entityDelta.despawnedMobIds !== undefined
      ).toBe(true);
    }

    const waveDelta = allEvents.find((e) => e.type === 'waveDelta') as
      | { type: 'waveDelta'; wave: unknown }
      | undefined;
    expect(waveDelta).toBeDefined();
    expect(waveDelta?.wave).toBeDefined();
  }
);

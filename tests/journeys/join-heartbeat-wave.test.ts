import { expect } from 'vitest';
import {
  createTestApp,
  devvitTest,
  makeEnvelope,
  postJson,
} from '../helpers/devvitTest';

devvitTest(
  'join -> heartbeat -> start wave -> mobs progress',
  async ({ mocks }) => {
    const app = createTestApp();

    const joinResponse = await postJson(app, '/api/game/join', {});
    expect(joinResponse.status).toBe(200);
    const joinBody = await joinResponse.json();
    expect(joinBody.type).toBe('join');
    const playerId = String(joinBody.playerId);
    const channel = String(joinBody.channel);

    const heartbeatResponse = await postJson(app, '/api/game/heartbeat', {
      playerId,
      position: { x: 10, z: 0 },
    });
    expect(heartbeatResponse.status).toBe(200);

    const commandResponse = await postJson(
      app,
      '/api/game/command',
      makeEnvelope(1, { type: 'startWave', playerId })
    );
    expect(commandResponse.status).toBe(200);

    await postJson(app, '/internal/scheduler/server-clock?windowMs=500', {});

    const resyncResponse = await postJson(app, '/api/game/resync', {
      tickSeq: 0,
      playerId,
    });
    expect(resyncResponse.status).toBe(200);
    const snapshotBody = await resyncResponse.json();
    expect(snapshotBody.type).toBe('snapshot');
    expect(snapshotBody.snapshot.wave.wave).toBeGreaterThan(0);

    const sentMessages = mocks.realtime.getSentMessagesForChannel(channel);
    expect(sentMessages.length).toBeGreaterThan(0);
  }
);

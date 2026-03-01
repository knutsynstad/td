import { expect } from 'vitest';
import {
  createTestApp,
  devvitTest,
  getJson,
  makeEnvelope,
  postJson,
} from '../helpers/devvitTest';

devvitTest('build command spends coins and updates structures', async () => {
  const app = createTestApp();

  const joinResponse = await postJson(app, '/api/game/join', {});
  const joinBody = await joinResponse.json();
  const playerId = String(joinBody.playerId);

  const beforeCoinsResponse = await getJson(app, '/api/game/coins');
  const beforeCoinsBody = await beforeCoinsResponse.json();
  const beforeCoins = Number(beforeCoinsBody.coins);

  const buildResponse = await postJson(
    app,
    '/api/game/command',
    makeEnvelope(1, {
      type: 'buildStructure',
      playerId,
      structure: {
        structureId: 'tower-1',
        type: 'tower',
        center: { x: 20, z: 20 },
      },
    })
  );
  expect(buildResponse.status).toBe(200);

  await postJson(app, '/internal/scheduler/server-clock?windowMs=500', {});

  const afterCoinsResponse = await getJson(app, '/api/game/coins');
  const afterCoinsBody = await afterCoinsResponse.json();
  expect(Number(afterCoinsBody.coins)).toBeLessThan(beforeCoins);

  const resyncResponse = await postJson(app, '/api/game/resync', {
    tickSeq: 0,
    playerId,
  });
  const resyncBody = await resyncResponse.json();
  expect(resyncBody.snapshot.structures['tower-1']).toBeDefined();
});

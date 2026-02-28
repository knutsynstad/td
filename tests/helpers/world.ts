import type { WorldState } from '../../src/shared/game-state';

export const createWorld = (nowMs = Date.now()): WorldState => ({
  meta: {
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: nowMs,
    seed: 1,
    coins: 100,
    lives: 1,
  },
  players: {},
  intents: {},
  structures: {},
  mobs: {},
  wave: {
    wave: 0,
    active: false,
    nextWaveAtMs: 0,
    spawners: [],
  },
});

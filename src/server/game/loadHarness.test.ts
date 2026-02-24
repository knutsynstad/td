import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../shared/game-state';
import { runLoadHarness } from './loadHarness';

const baseWorld = (): WorldState => ({
  meta: {
    postId: 't3_test',
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: Date.now(),
    seed: 1,
    energy: 500,
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

describe('runLoadHarness', () => {
  it('simulates 500 players with bounded output', () => {
    const result = runLoadHarness(baseWorld(), 500, 50);
    expect(result.players).toBe(500);
    expect(result.finalTickSeq).toBeGreaterThan(0);
    expect(result.deltasProduced).toBeGreaterThan(0);
  });
});

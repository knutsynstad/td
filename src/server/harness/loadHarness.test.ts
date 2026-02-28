import { describe, expect, it } from 'vitest';
import type { GameWorld } from '../../shared/game-state';
import { TrackedMap } from '../../shared/utils/trackedMap';
import { runLoadHarness } from './loadHarness';

const baseWorld = (): GameWorld => ({
  meta: {
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: Date.now(),
    seed: 1,
    energy: 500,
    lives: 1,
    nextMobSeq: 1,
  },
  players: new TrackedMap(),
  intents: new TrackedMap(),
  structures: new TrackedMap(),
  mobs: new TrackedMap(),
  wave: {
    wave: 0,
    active: false,
    nextWaveAtMs: 0,
    spawners: [],
  },
  waveDirty: false,
});

describe('runLoadHarness', () => {
  it('simulates 500 players with bounded output', () => {
    const result = runLoadHarness(baseWorld(), 500, 50);
    expect(result.players).toBe(500);
    expect(result.finalTickSeq).toBeGreaterThan(0);
    expect(result.deltasProduced).toBeGreaterThan(0);
  });
});

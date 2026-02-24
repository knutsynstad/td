import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../shared/game-state';
import { AUTO_WAVE_INITIAL_DELAY_MS } from './config';
import { runSimulation } from './simulation';

const world = (nowMs: number): WorldState => ({
  meta: {
    postId: 'global',
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: nowMs,
    seed: 1,
    energy: 100,
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

describe('runSimulation', () => {
  it('schedules initial wave when world is fresh', () => {
    const nowMs = Date.now();
    const result = runSimulation(world(nowMs), nowMs, [], 1);
    expect(result.world.wave.nextWaveAtMs).toBe(
      nowMs + AUTO_WAVE_INITIAL_DELAY_MS
    );
    expect(result.deltas.some((delta) => delta.type === 'waveDelta')).toBe(
      true
    );
  });

  it('activates scheduled wave once due', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.nextWaveAtMs = nowMs;
    const result = runSimulation(gameWorld, nowMs + 100, [], 5);
    expect(result.world.wave.active).toBe(true);
    expect(result.world.wave.wave).toBe(1);
    expect(result.world.wave.spawners.length).toBeGreaterThan(0);
  });
});

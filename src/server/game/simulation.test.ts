import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../shared/game-state';
import { AUTO_WAVE_INITIAL_DELAY_MS } from './config';
import { runSimulation } from './simulation';

const world = (nowMs: number): WorldState => ({
  meta: {
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

  it('builds routes without single-cell ABA kinks', () => {
    const nowMs = Date.now();
    const gameWorld = world(nowMs);
    gameWorld.wave.nextWaveAtMs = nowMs;
    const result = runSimulation(gameWorld, nowMs + 100, [], 5);
    for (const spawner of result.world.wave.spawners) {
      const runs: Array<{ dir: string; len: number }> = [];
      for (let i = 1; i < spawner.route.length; i += 1) {
        const prev = spawner.route[i - 1]!;
        const curr = spawner.route[i]!;
        const dx = Math.round(curr.x - prev.x);
        const dz = Math.round(curr.z - prev.z);
        const dir = `${dx},${dz}`;
        if (runs.length === 0 || runs[runs.length - 1]!.dir !== dir) {
          runs.push({ dir, len: 1 });
        } else {
          runs[runs.length - 1]!.len += 1;
        }
      }
      for (let i = 1; i < runs.length - 1; i += 1) {
        const before = runs[i - 1]!;
        const middle = runs[i]!;
        const after = runs[i + 1]!;
        const isSingleCellKink =
          middle.len === 1 &&
          before.dir === after.dir &&
          before.dir !== middle.dir;
        expect(isSingleCellKink).toBe(false);
      }
    }
  });
});

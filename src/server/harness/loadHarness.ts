import type { CommandEnvelope } from '../../shared/game-protocol';
import type { GameWorld } from '../../shared/game-state';
import { TrackedMap } from '../../shared/utils/trackedMap';
import { runSimulation } from '../../shared/simulation';

type HarnessResult = {
  players: number;
  ticks: number;
  finalTickSeq: number;
  finalWorldVersion: number;
  mobCount: number;
  deltasProduced: number;
};

const makeMoveCommand = (
  playerId: string,
  seq: number,
  sentAtMs: number
): CommandEnvelope => ({
  seq,
  sentAtMs,
  command: {
    type: 'moveIntent',
    playerId,
    intent: {
      updatedAtMs: sentAtMs,
      desiredDir: {
        x: Math.sin(seq * 0.17),
        z: Math.cos(seq * 0.17),
      },
    },
  },
});

const cloneGameWorld = (world: GameWorld): GameWorld => {
  const cloneMap = <V>(source: Map<string, V>, cloneValue: (v: V) => V): TrackedMap<V> => {
    const map = new TrackedMap<V>();
    for (const [key, value] of source) {
      Map.prototype.set.call(map, key, cloneValue(value));
    }
    return map;
  };
  return {
    meta: { ...world.meta },
    players: cloneMap(world.players, (p) => ({ ...p })),
    intents: cloneMap(world.intents, (i) => ({ ...i })),
    structures: cloneMap(world.structures, (s) => ({ ...s })),
    mobs: cloneMap(world.mobs, (m) => ({ ...m })),
    wave: {
      ...world.wave,
      spawners: world.wave.spawners.map((spawner) => ({ ...spawner })),
    },
    waveDirty: false,
  };
};

export const runLoadHarness = (
  baseWorld: GameWorld,
  targetPlayers = 500,
  ticks = 200
): HarnessResult => {
  const world = cloneGameWorld(baseWorld);
  for (let i = 0; i < targetPlayers; i += 1) {
    const playerId = `load-player-${i}`;
    world.players.set(playerId, {
      playerId,
      username: `u/load_${i}`,
      position: { x: (i % 20) - 10, z: Math.floor(i / 20) - 10 },
      velocity: { x: 0, z: 0 },
      speed: 8,
      lastSeenMs: world.meta.lastTickMs,
    });
  }

  let seq = 0;
  let totalDeltas = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const nowMs = world.meta.lastTickMs + 100;
    const commands: CommandEnvelope[] = [...world.players.keys()].map(
      (playerId) => {
        seq += 1;
        return makeMoveCommand(playerId, seq, nowMs);
      }
    );
    const result = runSimulation(world, nowMs, commands, 1);
    totalDeltas += result.deltas.length;
  }

  return {
    players: world.players.size,
    ticks,
    finalTickSeq: world.meta.tickSeq,
    finalWorldVersion: world.meta.worldVersion,
    mobCount: world.mobs.size,
    deltasProduced: totalDeltas,
  };
};

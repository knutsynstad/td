import type { CommandEnvelope } from '../../shared/game-protocol';
import type { WorldState } from '../../shared/game-state';
import { runSimulation } from './simulation';

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

const cloneWorld = (world: WorldState): WorldState => ({
  meta: { ...world.meta },
  players: Object.fromEntries(
    Object.entries(world.players).map(([id, player]) => [id, { ...player }])
  ),
  intents: Object.fromEntries(
    Object.entries(world.intents).map(([id, intent]) => [id, { ...intent }])
  ),
  structures: Object.fromEntries(
    Object.entries(world.structures).map(([id, structure]) => [
      id,
      { ...structure },
    ])
  ),
  mobs: Object.fromEntries(
    Object.entries(world.mobs).map(([id, mob]) => [id, { ...mob }])
  ),
  wave: {
    ...world.wave,
    spawners: world.wave.spawners.map((spawner) => ({ ...spawner })),
  },
});

export const runLoadHarness = (
  baseWorld: WorldState,
  targetPlayers = 500,
  ticks = 200
): HarnessResult => {
  const world = cloneWorld(baseWorld);
  for (let i = 0; i < targetPlayers; i += 1) {
    const playerId = `load-player-${i}`;
    world.players[playerId] = {
      playerId,
      username: `u/load_${i}`,
      position: { x: (i % 20) - 10, z: Math.floor(i / 20) - 10 },
      velocity: { x: 0, z: 0 },
      speed: 8,
      lastSeenMs: world.meta.lastTickMs,
    };
  }

  let seq = 0;
  let totalDeltas = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const nowMs = world.meta.lastTickMs + 100;
    const commands: CommandEnvelope[] = Object.keys(world.players).map(
      (playerId) => {
        seq += 1;
        return makeMoveCommand(playerId, seq, nowMs);
      }
    );
    const result = runSimulation(world, nowMs, commands, 1);
    totalDeltas += result.deltas.length;
  }

  return {
    players: Object.keys(world.players).length,
    ticks,
    finalTickSeq: world.meta.tickSeq,
    finalWorldVersion: world.meta.worldVersion,
    mobCount: Object.keys(world.mobs).length,
    deltasProduced: totalDeltas,
  };
};

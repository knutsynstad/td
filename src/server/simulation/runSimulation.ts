import type {
  CommandEnvelope,
  EntityDelta,
  GameDelta,
  StructureDelta,
  WaveDelta,
} from '../../shared/game-protocol';
import type { GameWorld, MobState } from '../../shared/game-state';
import {
  SIM_TICK_MS,
  MAX_DELTA_PLAYERS,
  MAX_STRUCTURE_DELTA_UPSERTS,
  MAX_STRUCTURE_DELTA_REMOVES,
  FULL_MOB_DELTA_INTERVAL_MS,
  FULL_MOB_DELTA_ON_STRUCTURE_CHANGE_WINDOW_MS,
  FULL_MOB_SNAPSHOT_CHUNK_SIZE,
} from '../config';
import { applyCommands } from './commands';
import {
  recomputeSpawnerRoutes,
  autoUnblockFullyBlockedPaths,
} from './pathfinding';
import { ensureInitialWaveSchedule, updateWave } from './waves';
import { updateMobs } from './mobs';
import {
  ENABLE_FULL_MOB_DELTAS,
  buildMobPoolFromList,
  buildUnifiedMobDelta,
} from './deltas';

export type SimulationPerfStats = {
  mobsSimulated: number;
  towersSimulated: number;
  towerMobChecks: number;
  waveSpawnedMobs: number;
  elapsedMs: number;
};

export type SimulationResult = {
  world: GameWorld;
  deltas: GameDelta[];
  perf: SimulationPerfStats;
};

const FULL_MOB_DELTA_INTERVAL_TICKS = Math.max(
  1,
  Math.round(FULL_MOB_DELTA_INTERVAL_MS / SIM_TICK_MS)
);
const FULL_MOB_AFTER_STRUCTURE_CHANGE_TICKS = Math.max(
  1,
  Math.round(FULL_MOB_DELTA_ON_STRUCTURE_CHANGE_WINDOW_MS / SIM_TICK_MS)
);

export const runSimulation = (
  world: GameWorld,
  nowMs: number,
  commands: CommandEnvelope[],
  maxSteps: number
): SimulationResult => {
  const startedAtMs = Date.now();
  const perf: SimulationPerfStats = {
    mobsSimulated: 0,
    towersSimulated: 0,
    towerMobChecks: 0,
    waveSpawnedMobs: 0,
    elapsedMs: 0,
  };
  const deltas: GameDelta[] = [];
  let waveChanged = ensureInitialWaveSchedule(world);
  let routesChanged = waveChanged;
  const commandChanges = applyCommands(world, commands, nowMs);
  const structureUpserts = commandChanges.structureUpserts.slice();
  const structureRemoves = commandChanges.structureRemoves.slice();
  waveChanged = waveChanged || commandChanges.waveChanged;
  if (world.wave.spawners.some((spawner) => spawner.route.length === 0)) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
    routesChanged = true;
  }
  const autoRemovedStructureIds = autoUnblockFullyBlockedPaths(world);
  if (autoRemovedStructureIds.length > 0) {
    for (const removedId of autoRemovedStructureIds) {
      if (!structureRemoves.includes(removedId))
        structureRemoves.push(removedId);
    }
    waveChanged = true;
    routesChanged = true;
  }
  if (structureUpserts.length > 0 || structureRemoves.length > 0) {
    world.meta.lastStructureChangeTickSeq = world.meta.tickSeq;
  }
  if (commandChanges.movedPlayers.length > 0) {
    deltas.push({
      type: 'entityDelta',
      serverTimeMs: nowMs,
      tickMs: SIM_TICK_MS,
      players: commandChanges.movedPlayers.slice(0, MAX_DELTA_PLAYERS),
      despawnedMobIds: [],
    });
  }
  if (structureUpserts.length > 0 || structureRemoves.length > 0) {
    recomputeSpawnerRoutes(world);
    waveChanged = true;
    routesChanged = true;
    world.meta.worldVersion += 1;
    const structureDelta: StructureDelta = {
      type: 'structureDelta',
      upserts: structureUpserts.slice(0, MAX_STRUCTURE_DELTA_UPSERTS),
      removes: structureRemoves.slice(0, MAX_STRUCTURE_DELTA_REMOVES),
      requiresPathRefresh: true,
    };
    deltas.push(structureDelta);
  }

  let steps = 0;
  let latestMobUpserts: MobState[] = [];
  const despawnedDuringRun = new Set<string>();
  let latestWaveDelta: WaveDelta | null = null;
  let totalCastleCaptures = 0;
  while (world.meta.lastTickMs + SIM_TICK_MS <= nowMs && steps < maxSteps) {
    world.meta.lastTickMs += SIM_TICK_MS;
    world.meta.tickSeq += 1;
    steps += 1;
    const deltaSeconds = SIM_TICK_MS / 1000;

    const waveResult = updateWave(world, deltaSeconds);
    perf.waveSpawnedMobs += waveResult.spawned;
    const mobResult = updateMobs(world, deltaSeconds, perf);
    totalCastleCaptures += mobResult.castleCaptures;
    latestMobUpserts = mobResult.upserts;
    for (const mobId of mobResult.despawnedIds) {
      despawnedDuringRun.add(mobId);
    }

    if (waveResult.changed) {
      latestWaveDelta = {
        type: 'waveDelta',
        wave: world.wave,
        routesIncluded: routesChanged,
      };
    }
  }

  if (totalCastleCaptures > 0) {
    waveChanged = true;
  }

  if (waveChanged && !latestWaveDelta) {
    latestWaveDelta = {
      type: 'waveDelta',
      wave: world.wave,
      routesIncluded: routesChanged,
    };
  }
  if (!latestWaveDelta && !world.wave.active && world.wave.nextWaveAtMs > 0) {
    latestWaveDelta = {
      type: 'waveDelta',
      wave: world.wave,
      routesIncluded: routesChanged,
    };
  }

  if (steps > 0) {
    const simulatedWindowMs = Math.max(SIM_TICK_MS, steps * SIM_TICK_MS);
    const lastStructureChangeTickSeq =
      world.meta.lastStructureChangeTickSeq ?? 0;
    const ticksSinceStructureChange = Math.max(
      0,
      world.meta.tickSeq - lastStructureChangeTickSeq
    );
    const structureChangeBurstActive =
      lastStructureChangeTickSeq > 0 &&
      ticksSinceStructureChange <= FULL_MOB_AFTER_STRUCTURE_CHANGE_TICKS;
    const includeFullMobList =
      ENABLE_FULL_MOB_DELTAS &&
      (world.meta.tickSeq % FULL_MOB_DELTA_INTERVAL_TICKS === 0 ||
        structureChangeBurstActive);
    const despawnedIds = Array.from(despawnedDuringRun).map(Number);
    if (includeFullMobList) {
      const chunkSize = Math.max(1, FULL_MOB_SNAPSHOT_CHUNK_SIZE);
      const chunkCount = Math.max(
        1,
        Math.ceil(latestMobUpserts.length / chunkSize)
      );
      const snapshotId = world.meta.tickSeq;
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(latestMobUpserts.length, start + chunkSize);
        const isFinalChunk = chunkIndex === chunkCount - 1;
        const chunkMobs = latestMobUpserts.slice(start, end);
        const chunkDelta: EntityDelta = {
          type: 'entityDelta',
          serverTimeMs: world.meta.lastTickMs,
          tickMs: simulatedWindowMs,
          players: [],
          mobPool: buildMobPoolFromList(chunkMobs, true),
          fullMobList: true,
          fullMobSnapshotId: snapshotId,
          fullMobSnapshotChunkIndex: chunkIndex,
          fullMobSnapshotChunkCount: chunkCount,
          despawnedMobIds: isFinalChunk ? despawnedIds : [],
        };
        deltas.push(chunkDelta);
      }
    } else {
      const { pool, slices } = buildUnifiedMobDelta(latestMobUpserts, world);
      const entityDelta: EntityDelta = {
        type: 'entityDelta',
        serverTimeMs: world.meta.lastTickMs,
        tickMs: simulatedWindowMs,
        players: [],
        mobPool: pool,
        mobSlices: slices,
        fullMobList: false,
        despawnedMobIds: despawnedIds,
      };
      deltas.push(entityDelta);
    }
  }
  if (latestWaveDelta) {
    if (!latestWaveDelta.routesIncluded) {
      latestWaveDelta = {
        ...latestWaveDelta,
        wave: {
          ...latestWaveDelta.wave,
          spawners: latestWaveDelta.wave.spawners.map((s) => ({
            ...s,
            route: [],
          })),
        },
      };
    }
    if (totalCastleCaptures > 0) {
      latestWaveDelta = { ...latestWaveDelta, lives: world.meta.lives };
    }
    deltas.push(latestWaveDelta);
  }

  perf.elapsedMs = Date.now() - startedAtMs;
  return { world, deltas, perf };
};

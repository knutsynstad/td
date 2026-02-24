import type {
  CommandEnvelope,
  EntityDelta,
  GameDelta,
  StructureDelta,
  WaveDelta,
} from '../../shared/game-protocol';
import type {
  MobState,
  StructureState,
  WorldState,
} from '../../shared/game-state';
import {
  AUTO_WAVE_INITIAL_DELAY_MS,
  AUTO_WAVE_INTERMISSION_MS,
  MAX_DELTA_MOBS,
  MAX_DELTA_PLAYERS,
  MAX_MOBS,
  MAX_STRUCTURE_DELTA_REMOVES,
  MAX_STRUCTURE_DELTA_UPSERTS,
  MOB_SPEED_UNITS_PER_SECOND,
  SIM_TICK_MS,
  WAVE_SPAWN_BASE,
} from './config';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const distance = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(bx - ax, bz - az);

const normalize = (x: number, z: number): { x: number; z: number } => {
  const len = Math.hypot(x, z);
  if (len <= 0.0001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
};

const makeMob = (tickSeq: number, spawnerId: string): MobState => ({
  mobId: `${spawnerId}-mob-${tickSeq}-${Math.floor(Math.random() * 10_000)}`,
  position: { x: 40, z: 40 },
  velocity: { x: 0, z: 0 },
  hp: 100,
  maxHp: 100,
  spawnerId,
});

const activateWave = (world: WorldState): boolean => {
  if (world.wave.active) return false;
  world.wave.wave += 1;
  world.wave.active = true;
  world.wave.spawners = [
    {
      spawnerId: `wave-${world.wave.wave}-east`,
      totalCount: (5 + world.wave.wave * 2) * 8,
      spawnedCount: 0,
      aliveCount: 0,
      spawnRatePerSecond: WAVE_SPAWN_BASE + world.wave.wave * 0.2,
      spawnAccumulator: 0,
      gateOpen: false,
    },
  ];
  world.wave.nextWaveAtMs = 0;
  return true;
};

const ensureInitialWaveSchedule = (world: WorldState): boolean => {
  if (world.wave.wave > 0 || world.wave.active || world.wave.nextWaveAtMs > 0) {
    return false;
  }
  world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INITIAL_DELAY_MS;
  return true;
};

const maybeActivateScheduledWave = (world: WorldState): boolean => {
  if (world.wave.active || world.wave.nextWaveAtMs <= 0) return false;
  if (world.meta.lastTickMs < world.wave.nextWaveAtMs) return false;
  return activateWave(world);
};

const updateMobs = (
  world: WorldState,
  deltaSeconds: number
): { upserts: MobState[]; despawnedIds: string[] } => {
  const upserts: MobState[] = [];
  const despawnedIds: string[] = [];

  const towerList = Object.values(world.structures).filter(
    (structure) => structure.type === 'tower'
  );
  for (const mob of Object.values(world.mobs)) {
    const toCenter = normalize(-mob.position.x, -mob.position.z);
    mob.velocity.x = toCenter.x * MOB_SPEED_UNITS_PER_SECOND;
    mob.velocity.z = toCenter.z * MOB_SPEED_UNITS_PER_SECOND;
    mob.position.x += mob.velocity.x * deltaSeconds;
    mob.position.z += mob.velocity.z * deltaSeconds;

    for (const tower of towerList) {
      if (
        distance(
          tower.center.x,
          tower.center.z,
          mob.position.x,
          mob.position.z
        ) < 12
      ) {
        mob.hp -= 12;
      }
    }

    if (mob.hp <= 0 || distance(0, 0, mob.position.x, mob.position.z) < 2) {
      despawnedIds.push(mob.mobId);
      delete world.mobs[mob.mobId];
      continue;
    }
    upserts.push({ ...mob });
  }
  return { upserts, despawnedIds };
};

const updateWave = (world: WorldState, deltaSeconds: number): boolean => {
  let changed = false;
  if (maybeActivateScheduledWave(world)) {
    changed = true;
  }
  if (!world.wave.active) return false;
  for (const spawner of world.wave.spawners) {
    if (!spawner.gateOpen) spawner.gateOpen = true;
    spawner.spawnAccumulator += spawner.spawnRatePerSecond * deltaSeconds;
    const toSpawn = Math.floor(spawner.spawnAccumulator);
    if (toSpawn <= 0) continue;
    const roomLeft = Math.max(0, MAX_MOBS - Object.keys(world.mobs).length);
    const spawnCount = Math.min(
      roomLeft,
      toSpawn,
      spawner.totalCount - spawner.spawnedCount
    );
    for (let i = 0; i < spawnCount; i += 1) {
      const mob = makeMob(world.meta.tickSeq, spawner.spawnerId);
      world.mobs[mob.mobId] = mob;
      spawner.spawnedCount += 1;
      spawner.aliveCount += 1;
      spawner.spawnAccumulator -= 1;
      changed = true;
    }
  }

  const allSpawned = world.wave.spawners.every(
    (spawner) => spawner.spawnedCount >= spawner.totalCount
  );
  const aliveMobs = Object.keys(world.mobs).length;
  if (allSpawned && aliveMobs === 0) {
    world.wave.active = false;
    world.wave.nextWaveAtMs = world.meta.lastTickMs + AUTO_WAVE_INTERMISSION_MS;
    changed = true;
  }
  return changed;
};

type CommandApplyResult = {
  structureUpserts: StructureState[];
  structureRemoves: string[];
  waveChanged: boolean;
  movedPlayers: EntityDelta['players'];
};

const applyCommands = (
  world: WorldState,
  commands: CommandEnvelope[],
  nowMs: number
): CommandApplyResult => {
  const structureUpserts: StructureState[] = [];
  const structureRemoves: string[] = [];
  const movedPlayers: EntityDelta['players'] = [];
  let waveChanged = false;

  for (const envelope of commands) {
    const { command } = envelope;
    if (command.type === 'moveIntent') {
      world.intents[command.playerId] = command.intent;
      const player = world.players[command.playerId];
      if (!player) continue;
      const from = { x: player.position.x, z: player.position.z };
      const nextPosition = command.clientPosition
        ? {
            x: clamp(command.clientPosition.x, -120, 120),
            z: clamp(command.clientPosition.z, -120, 120),
          }
        : command.intent.target
          ? {
              x: clamp(command.intent.target.x, -120, 120),
              z: clamp(command.intent.target.z, -120, 120),
            }
          : from;
      player.position = nextPosition;
      player.lastSeenMs = nowMs;
      movedPlayers.push({
        playerId: player.playerId,
        username: player.username,
        interpolation: {
          from,
          to: nextPosition,
          t0: nowMs - SIM_TICK_MS,
          t1: nowMs,
        },
      });
      continue;
    }
    if (command.type === 'buildStructure') {
      const structure: StructureState = {
        structureId: command.structure.structureId,
        ownerId: command.playerId,
        type: command.structure.type,
        center: command.structure.center,
        hp: 100,
        maxHp: 100,
        createdAtMs: world.meta.lastTickMs,
      };
      world.structures[structure.structureId] = structure;
      structureUpserts.push(structure);
      continue;
    }
    if (command.type === 'removeStructure') {
      delete world.structures[command.structureId];
      structureRemoves.push(command.structureId);
      continue;
    }
    if (command.type === 'startWave') {
      waveChanged = activateWave(world) || waveChanged;
      continue;
    }
  }

  return { structureUpserts, structureRemoves, waveChanged, movedPlayers };
};

export type SimulationResult = {
  world: WorldState;
  deltas: GameDelta[];
};

export const runSimulation = (
  world: WorldState,
  nowMs: number,
  commands: CommandEnvelope[],
  maxSteps: number
): SimulationResult => {
  const deltas: GameDelta[] = [];
  let waveChanged = ensureInitialWaveSchedule(world);
  const commandChanges = applyCommands(world, commands, nowMs);
  waveChanged = waveChanged || commandChanges.waveChanged;
  if (commandChanges.movedPlayers.length > 0) {
    deltas.push({
      type: 'entityDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      players: commandChanges.movedPlayers.slice(0, MAX_DELTA_PLAYERS),
      mobs: [],
      despawnedMobIds: [],
    });
  }
  if (
    commandChanges.structureUpserts.length > 0 ||
    commandChanges.structureRemoves.length > 0
  ) {
    const structureDelta: StructureDelta = {
      type: 'structureDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion + 1,
      upserts: commandChanges.structureUpserts.slice(
        0,
        MAX_STRUCTURE_DELTA_UPSERTS
      ),
      removes: commandChanges.structureRemoves.slice(
        0,
        MAX_STRUCTURE_DELTA_REMOVES
      ),
      requiresPathRefresh: true,
    };
    world.meta.worldVersion += 1;
    deltas.push(structureDelta);
  }

  let steps = 0;
  let latestEntityDelta: EntityDelta | null = null;
  let latestWaveDelta: WaveDelta | null = null;
  while (world.meta.lastTickMs + SIM_TICK_MS <= nowMs && steps < maxSteps) {
    const fromMs = world.meta.lastTickMs;
    world.meta.lastTickMs += SIM_TICK_MS;
    world.meta.tickSeq += 1;
    steps += 1;
    const deltaSeconds = SIM_TICK_MS / 1000;

    const waveChanged = updateWave(world, deltaSeconds);
    const mobResult = updateMobs(world, deltaSeconds);
    const entityDelta: EntityDelta = {
      type: 'entityDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      players: [],
      mobs: mobResult.upserts.slice(0, MAX_DELTA_MOBS).map((mob) => ({
        mobId: mob.mobId,
        interpolation: {
          from: {
            x: mob.position.x - mob.velocity.x * deltaSeconds,
            z: mob.position.z - mob.velocity.z * deltaSeconds,
          },
          to: { x: mob.position.x, z: mob.position.z },
          t0: fromMs,
          t1: world.meta.lastTickMs,
        },
        hp: mob.hp,
        maxHp: mob.maxHp,
      })),
      despawnedMobIds: mobResult.despawnedIds,
    };
    latestEntityDelta = entityDelta;

    if (waveChanged) {
      latestWaveDelta = {
        type: 'waveDelta',
        tickSeq: world.meta.tickSeq,
        worldVersion: world.meta.worldVersion,
        wave: world.wave,
      };
    }
  }

  if (waveChanged && !latestWaveDelta) {
    latestWaveDelta = {
      type: 'waveDelta',
      tickSeq: world.meta.tickSeq,
      worldVersion: world.meta.worldVersion,
      wave: world.wave,
    };
  }

  if (latestEntityDelta) {
    deltas.push(latestEntityDelta);
  }
  if (latestWaveDelta) {
    deltas.push(latestWaveDelta);
  }

  return { world, deltas };
};

export const buildPresenceLeaveDelta = (
  tickSeq: number,
  worldVersion: number,
  playerId: string
): GameDelta => ({
  type: 'presenceDelta',
  tickSeq,
  worldVersion,
  left: {
    playerId,
    reason: 'timeout',
  },
});

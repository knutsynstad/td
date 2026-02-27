import type { CommandEnvelope } from '../../shared/game-protocol';
import type {
  MobState,
  PlayerIntent,
  PlayerState,
  StructureMetadata,
  StructureState,
  WaveState,
  WorldMeta,
} from '../../shared/game-state';
import { PLAYER_SPEED } from '../../shared/content';
import { isRecord } from '../../shared/utils';
import { clampCoins } from '../economy';

export const toJson = (value: unknown): string => JSON.stringify(value);

export const parseJson = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const parseVec2 = (value: unknown) => {
  if (!isRecord(value)) return { x: 0, z: 0 };
  return {
    x: Number(value.x ?? 0),
    z: Number(value.z ?? 0),
  };
};

export const parseStructureType = (
  value: unknown
): StructureState['type'] =>
  value === 'tower' || value === 'tree' || value === 'rock' || value === 'bank'
    ? value
    : 'wall';

export const parsePlayerState = (value: unknown): PlayerState => {
  if (!isRecord(value)) {
    return {
      playerId: '',
      username: 'anonymous',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      speed: PLAYER_SPEED,
      lastSeenMs: 0,
    };
  }
  return {
    playerId: String(value.playerId ?? ''),
    username: String(value.username ?? 'anonymous'),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    speed: Number(value.speed ?? PLAYER_SPEED),
    lastSeenMs: Number(value.lastSeenMs ?? 0),
  };
};

export const parseIntent = (value: unknown): PlayerIntent => {
  if (!isRecord(value)) {
    return { updatedAtMs: 0 };
  }
  const parsed: PlayerIntent = {
    updatedAtMs: Number(value.updatedAtMs ?? 0),
  };
  if (value.desiredDir) parsed.desiredDir = parseVec2(value.desiredDir);
  if (value.target) parsed.target = parseVec2(value.target);
  return parsed;
};

const parseStructureMetadata = (
  raw: unknown
): StructureMetadata | undefined => {
  if (!isRecord(raw)) return undefined;
  const out: StructureMetadata = {};
  const treeFootprint = Number(raw.treeFootprint ?? 0);
  if (treeFootprint >= 1 && treeFootprint < 2) out.treeFootprint = 1;
  else if (treeFootprint >= 2 && treeFootprint < 3) out.treeFootprint = 2;
  else if (treeFootprint >= 3 && treeFootprint < 4) out.treeFootprint = 3;
  else if (treeFootprint >= 4) out.treeFootprint = 4;
  const rockRaw = raw.rock;
  if (isRecord(rockRaw)) {
    const yawQuarterTurns = Number(rockRaw.yawQuarterTurns ?? 0);
    const modelIndex = Number(rockRaw.modelIndex ?? 0);
    const parsedYaw =
      yawQuarterTurns >= 0 && yawQuarterTurns < 1
        ? 0
        : yawQuarterTurns >= 1 && yawQuarterTurns < 2
          ? 1
          : yawQuarterTurns >= 2 && yawQuarterTurns < 3
            ? 2
            : 3;
    out.rock = {
      footprintX: Math.max(1, Number(rockRaw.footprintX ?? 1)),
      footprintZ: Math.max(1, Number(rockRaw.footprintZ ?? 1)),
      yawQuarterTurns: parsedYaw,
      modelIndex: modelIndex === 1 ? 1 : 0,
      mirrorX: Boolean(rockRaw.mirrorX ?? false),
      mirrorZ: Boolean(rockRaw.mirrorZ ?? false),
      verticalScale: Math.max(0.1, Number(rockRaw.verticalScale ?? 1)),
    };
  }
  if (!out.treeFootprint && !out.rock) return undefined;
  return out;
};

export const parseStructure = (value: unknown): StructureState => {
  if (!isRecord(value)) {
    return {
      structureId: '',
      ownerId: '',
      type: 'wall',
      center: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      createdAtMs: 0,
    };
  }
  return {
    structureId: String(value.structureId ?? ''),
    ownerId: String(value.ownerId ?? ''),
    type:
      value.type === 'tower' ||
      value.type === 'tree' ||
      value.type === 'rock' ||
      value.type === 'bank'
        ? value.type
        : 'wall',
    center: parseVec2(value.center),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    createdAtMs: Number(value.createdAtMs ?? 0),
    metadata: parseStructureMetadata(value.metadata),
  };
};

export const parseMob = (value: unknown): MobState => {
  if (!isRecord(value)) {
    return {
      mobId: '',
      position: { x: 0, z: 0 },
      velocity: { x: 0, z: 0 },
      hp: 1,
      maxHp: 1,
      spawnerId: '',
      routeIndex: 0,
      stuckMs: 0,
      lastProgressDistanceToGoal: Number.POSITIVE_INFINITY,
    };
  }
  return {
    mobId: String(value.mobId ?? ''),
    position: parseVec2(value.position),
    velocity: parseVec2(value.velocity),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    spawnerId: String(value.spawnerId ?? ''),
    routeIndex: Number(value.routeIndex ?? 0),
    stuckMs: Number(value.stuckMs ?? 0),
    lastProgressDistanceToGoal: Number(
      value.lastProgressDistanceToGoal ?? Number.POSITIVE_INFINITY
    ),
  };
};

export const parseMapFromHash = <T>(
  value: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): Record<string, T> => {
  const out: Record<string, T> = {};
  if (!value) return out;
  for (const [field, encoded] of Object.entries(value)) {
    out[field] = parser(parseJson(encoded));
  }
  return out;
};

export const parseCommandEnvelope = (
  value: unknown
): CommandEnvelope | undefined => {
  if (!isRecord(value)) return undefined;
  const seq = Number(value.seq ?? -1);
  const sentAtMs = Number(value.sentAtMs ?? 0);
  if (!isRecord(value.command)) return undefined;
  const commandType = String(value.command.type ?? '');
  const playerId = String(value.command.playerId ?? '');
  if (commandType === 'moveIntent') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'moveIntent',
        playerId,
        intent: parseIntent(value.command.intent),
        clientPosition: value.command.clientPosition
          ? parseVec2(value.command.clientPosition)
          : undefined,
      },
    };
  }
  if (commandType === 'buildStructure') {
    const structure = isRecord(value.command.structure)
      ? value.command.structure
      : {};
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructure',
        playerId,
        structure: {
          structureId: String(structure.structureId ?? ''),
          type: parseStructureType(structure.type),
          center: parseVec2(structure.center),
        },
      },
    };
  }
  if (commandType === 'buildStructures') {
    const rawStructures = Array.isArray(value.command.structures)
      ? value.command.structures
      : [];
    const structures = rawStructures
      .filter(isRecord)
      .map((structure) => ({
        structureId: String(structure.structureId ?? ''),
        type: parseStructureType(structure.type),
        center: parseVec2(structure.center),
      }))
      .filter((structure) => structure.structureId.length > 0);
    return {
      seq,
      sentAtMs,
      command: {
        type: 'buildStructures',
        playerId,
        structures,
      },
    };
  }
  if (commandType === 'removeStructure') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'removeStructure',
        playerId,
        structureId: String(value.command.structureId ?? ''),
      },
    };
  }
  if (commandType === 'startWave') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'startWave',
        playerId,
      },
    };
  }
  if (commandType === 'shoot') {
    return {
      seq,
      sentAtMs,
      command: {
        type: 'shoot',
        playerId,
        target: parseVec2(value.command.target),
      },
    };
  }
  return undefined;
};

export const defaultWave = (): WaveState => ({
  wave: 0,
  active: false,
  nextWaveAtMs: 0,
  spawners: [],
});

export const defaultMeta = (nowMs: number, energy: number): WorldMeta => ({
  tickSeq: 0,
  worldVersion: 0,
  lastTickMs: nowMs,
  lastStructureChangeTickSeq: 0,
  seed: nowMs,
  energy: clampCoins(energy),
  lives: 1,
  nextMobSeq: 1,
});

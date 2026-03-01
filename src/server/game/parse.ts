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
import { parseVec2 } from '../../shared/game-state';
import { COINS_CAP, PLAYER_SPEED } from '../../shared/content';
import { clamp, isRecord, safeParseJson } from '../../shared/utils';
import { TrackedMap } from '../../shared/utils/trackedMap';

// ---------------------------------------------------------------------------
// Player parsers
// ---------------------------------------------------------------------------

export function parsePlayerState(value: unknown): PlayerState {
  if (!isRecord(value)) {
    return {
      playerId: '',
      username: 'anonymous',
      position: { x: 0, z: 0 },
      speed: PLAYER_SPEED,
      lastSeenMs: 0,
    };
  }
  return {
    playerId: String(value.playerId ?? ''),
    username: String(value.username ?? 'anonymous'),
    position: parseVec2(value.position),
    target: value.target ? parseVec2(value.target) : undefined,
    speed: Number(value.speed ?? PLAYER_SPEED),
    lastSeenMs: Number(value.lastSeenMs ?? 0),
  };
}

export function parseIntent(value: unknown): PlayerIntent {
  if (!isRecord(value)) {
    return { updatedAtMs: 0 };
  }
  const parsed: PlayerIntent = {
    updatedAtMs: Number(value.updatedAtMs ?? 0),
  };
  if (value.desiredDir) parsed.desiredDir = parseVec2(value.desiredDir);
  if (value.target) parsed.target = parseVec2(value.target);
  return parsed;
}

// ---------------------------------------------------------------------------
// Structure parsers
// ---------------------------------------------------------------------------

export function parseStructureType(value: unknown): StructureState['type'] {
  return value === 'tower' || value === 'tree' || value === 'rock'
    ? value
    : 'wall';
}

function parseStructureMetadata(raw: unknown): StructureMetadata | undefined {
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
}

export function parseStructure(value: unknown): StructureState {
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
      value.type === 'tower' || value.type === 'tree' || value.type === 'rock'
        ? value.type
        : 'wall',
    center: parseVec2(value.center),
    hp: Number(value.hp ?? 1),
    maxHp: Number(value.maxHp ?? 1),
    createdAtMs: Number(value.createdAtMs ?? 0),
    metadata: parseStructureMetadata(value.metadata),
  };
}

// ---------------------------------------------------------------------------
// Mob parser
// ---------------------------------------------------------------------------

export function parseMob(value: unknown): MobState {
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
}

// ---------------------------------------------------------------------------
// Wave parser (single source of truth — was duplicated in world.ts and gameWorld.ts)
// ---------------------------------------------------------------------------

function makeDefaultSpawner(): WaveState['spawners'][number] {
  return {
    spawnerId: '',
    totalCount: 0,
    spawnedCount: 0,
    aliveCount: 0,
    spawnRatePerSecond: 0,
    spawnAccumulator: 0,
    gateOpen: false,
    routeState: 'blocked',
    route: [],
  };
}

export function defaultWave(): WaveState {
  return {
    wave: 0,
    active: false,
    nextWaveAtMs: 0,
    spawners: [],
  };
}

export function parseWaveState(raw: string | undefined): WaveState {
  const parsed = safeParseJson(raw);
  if (!isRecord(parsed)) return defaultWave();
  return {
    wave: Number(parsed.wave ?? 0),
    active: Boolean(parsed.active ?? false),
    nextWaveAtMs: Number(parsed.nextWaveAtMs ?? 0),
    spawners: Array.isArray(parsed.spawners)
      ? parsed.spawners.map((entry) => {
          if (!isRecord(entry)) return makeDefaultSpawner();
          const rawRoute = Array.isArray(entry.route) ? entry.route : [];
          const routeState: WaveState['spawners'][number]['routeState'] =
            entry.routeState === 'reachable' || entry.routeState === 'unstable'
              ? entry.routeState
              : 'blocked';
          return {
            spawnerId: String(entry.spawnerId ?? ''),
            totalCount: Number(entry.totalCount ?? 0),
            spawnedCount: Number(entry.spawnedCount ?? 0),
            aliveCount: Number(entry.aliveCount ?? 0),
            spawnRatePerSecond: Number(entry.spawnRatePerSecond ?? 0),
            spawnAccumulator: Number(entry.spawnAccumulator ?? 0),
            gateOpen: Boolean(entry.gateOpen ?? false),
            routeState,
            route: rawRoute.map((point) => parseVec2(point)),
          };
        })
      : [],
  };
}

// ---------------------------------------------------------------------------
// Meta defaults
// ---------------------------------------------------------------------------

export function defaultMeta(nowMs: number, coins: number): WorldMeta {
  return {
    tickSeq: 0,
    worldVersion: 0,
    lastTickMs: nowMs,
    lastStructureChangeTickSeq: 0,
    seed: nowMs,
    coins: clamp(coins, 0, COINS_CAP),
    lives: 1,
    nextMobSeq: 1,
  };
}

// ---------------------------------------------------------------------------
// Meta parser (shared by persistence.ts and trackedState.ts)
// ---------------------------------------------------------------------------

export function parseMeta(
  metaRaw: Record<string, string> | undefined
): WorldMeta {
  const now = Date.now();
  return {
    tickSeq: Number(metaRaw?.tickSeq ?? '0'),
    worldVersion: Number(metaRaw?.worldVersion ?? '0'),
    lastTickMs: Number(metaRaw?.lastTickMs ?? String(now)),
    lastStructureChangeTickSeq: Number(
      metaRaw?.lastStructureChangeTickSeq ?? '0'
    ),
    seed: Number(metaRaw?.seed ?? String(now)),
    coins: Math.max(
      0,
      Math.min(COINS_CAP, Number(metaRaw?.coins ?? String(COINS_CAP)))
    ),
    lives: Number(metaRaw?.lives ?? '1'),
    nextMobSeq: Number(metaRaw?.nextMobSeq ?? '1'),
  };
}

// ---------------------------------------------------------------------------
// Hash helpers (record-based and TrackedMap-based)
// ---------------------------------------------------------------------------

export function parseMapFromHash<T>(
  value: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!value) return out;
  for (const [field, encoded] of Object.entries(value)) {
    out[field] = parser(safeParseJson(encoded));
  }
  return out;
}

export function parseTrackedMapFromHash<T>(
  raw: Record<string, string> | undefined,
  parser: (entry: unknown) => T
): TrackedMap<T> {
  const map = new TrackedMap<T>();
  if (!raw) return map;
  for (const [key, encoded] of Object.entries(raw)) {
    Map.prototype.set.call(map, key, parser(safeParseJson(encoded)));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Command envelope parser
// ---------------------------------------------------------------------------

export function parseCommandEnvelope(
  value: unknown
): CommandEnvelope | undefined {
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
  return undefined;
}

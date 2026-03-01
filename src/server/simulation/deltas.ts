import type { GameDelta, MobPool, MobSlices } from '../../shared/game-protocol';
import type { GameWorld, MobState } from '../../shared/game-state';
import { distance2d } from '../../shared/utils';
import { MAX_DELTA_MOBS } from '../config';

export const ENABLE_FULL_MOB_DELTAS = true;
export const DELTA_NEAR_MOBS_BUDGET = 220;
export const DELTA_CASTLE_THREAT_MOBS_BUDGET = 160;
export const DELTA_RECENTLY_DAMAGED_MOBS_BUDGET = 120;
export const ENABLE_INTEREST_MANAGED_MOB_DELTAS = true;

const Q = 100;
const quantize = (v: number): number => Math.round(v * Q);

const nearestPlayerDistanceSq = (mob: MobState, world: GameWorld): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const player of world.players.values()) {
    const dx = mob.position.x - player.position.x;
    const dz = mob.position.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
};

type MobPoolBuilder = {
  poolMap: Map<string, number>;
  ids: number[];
  px: number[];
  pz: number[];
  vx: number[];
  vz: number[];
  hp: number[];
  maxHp: number[];
};

const createMobPoolBuilder = (): MobPoolBuilder => ({
  poolMap: new Map(),
  ids: [],
  px: [],
  pz: [],
  vx: [],
  vz: [],
  hp: [],
  maxHp: [],
});

const addMobToPool = (builder: MobPoolBuilder, mob: MobState): number => {
  const existing = builder.poolMap.get(mob.mobId);
  if (existing !== undefined) return existing;
  const idx = builder.ids.length;
  builder.poolMap.set(mob.mobId, idx);
  builder.ids.push(Number(mob.mobId));
  builder.px.push(quantize(mob.position.x));
  builder.pz.push(quantize(mob.position.z));
  builder.vx.push(quantize(mob.velocity.x));
  builder.vz.push(quantize(mob.velocity.z));
  builder.hp.push(mob.hp);
  builder.maxHp.push(mob.maxHp);
  return idx;
};

export const buildMobPoolFromList = (
  mobs: MobState[],
  includeMaxHp: boolean
): MobPool => {
  const ids: number[] = [];
  const px: number[] = [];
  const pz: number[] = [];
  const vx: number[] = [];
  const vz: number[] = [];
  const hp: number[] = [];
  const maxHp: number[] | undefined = includeMaxHp ? [] : undefined;
  for (const mob of mobs) {
    ids.push(Number(mob.mobId));
    px.push(quantize(mob.position.x));
    pz.push(quantize(mob.position.z));
    vx.push(quantize(mob.velocity.x));
    vz.push(quantize(mob.velocity.z));
    hp.push(mob.hp);
    maxHp?.push(mob.maxHp);
  }
  return { ids, px, pz, vx, vz, hp, maxHp };
};

export const buildUnifiedMobDelta = (
  allMobs: MobState[],
  world: GameWorld
): { pool: MobPool; slices: MobSlices } => {
  const builder = createMobPoolBuilder();

  const pageCount = Math.max(1, Math.ceil(allMobs.length / MAX_DELTA_MOBS));
  const pageIndex = world.meta.tickSeq % pageCount;
  const pageStart = pageIndex * MAX_DELTA_MOBS;
  const baseMobs = allMobs.slice(pageStart, pageStart + MAX_DELTA_MOBS);
  const baseIndices = baseMobs.map((m) => addMobToPool(builder, m));

  let nearPlayerIndices: number[] = [];
  let castleThreatIndices: number[] = [];
  let recentlyDamagedIndices: number[] = [];

  if (ENABLE_INTEREST_MANAGED_MOB_DELTAS) {
    const nearPlayers = allMobs
      .slice()
      .sort(
        (a, b) =>
          nearestPlayerDistanceSq(a, world) - nearestPlayerDistanceSq(b, world)
      )
      .slice(0, DELTA_NEAR_MOBS_BUDGET);
    const castleThreats = allMobs
      .slice()
      .sort(
        (a, b) =>
          distance2d(a.position.x, a.position.z, 0, 0) -
          distance2d(b.position.x, b.position.z, 0, 0)
      )
      .slice(0, DELTA_CASTLE_THREAT_MOBS_BUDGET);
    const recentlyDamaged = allMobs
      .filter((mob) => mob.hp < mob.maxHp)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, DELTA_RECENTLY_DAMAGED_MOBS_BUDGET);

    nearPlayerIndices = nearPlayers.map((m) => addMobToPool(builder, m));
    castleThreatIndices = castleThreats.map((m) => addMobToPool(builder, m));
    recentlyDamagedIndices = recentlyDamaged.map((m) =>
      addMobToPool(builder, m)
    );
  }

  const pool: MobPool = {
    ids: builder.ids,
    px: builder.px,
    pz: builder.pz,
    vx: builder.vx,
    vz: builder.vz,
    hp: builder.hp,
  };

  return {
    pool,
    slices: {
      base: baseIndices,
      nearPlayers: nearPlayerIndices,
      castleThreats: castleThreatIndices,
      recentlyDamaged: recentlyDamagedIndices,
    },
  };
};

export const buildPresenceLeaveDelta = (playerId: string): GameDelta => ({
  type: 'presenceDelta',
  left: {
    playerId,
    reason: 'timeout',
  },
});

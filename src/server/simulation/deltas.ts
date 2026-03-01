import type { GameDelta, MobPool } from '../../shared/game-protocol';
import type { MobState } from '../../shared/game-state';

export const ENABLE_FULL_MOB_DELTAS = true;

const Q = 100;
const quantize = (v: number): number => Math.round(v * Q);

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

type MobSnapshot = { px: number; pz: number; hp: number };
const lastBroadcastMobs = new Map<number, MobSnapshot>();

export const filterChangedMobs = (mobs: MobState[]): MobState[] => {
  const changed: MobState[] = [];
  for (const mob of mobs) {
    const id = Number(mob.mobId);
    const qpx = quantize(mob.position.x);
    const qpz = quantize(mob.position.z);
    const prev = lastBroadcastMobs.get(id);
    if (!prev || prev.px !== qpx || prev.pz !== qpz || prev.hp !== mob.hp) {
      changed.push(mob);
    }
  }
  return changed;
};

export const updateLastBroadcastMobs = (
  mobs: MobState[],
  despawnedIds: Set<string>
): void => {
  for (const mob of mobs) {
    const id = Number(mob.mobId);
    lastBroadcastMobs.set(id, {
      px: quantize(mob.position.x),
      pz: quantize(mob.position.z),
      hp: mob.hp,
    });
  }
  for (const mobId of despawnedIds) {
    lastBroadcastMobs.delete(Number(mobId));
  }
};

export const resetLastBroadcastMobs = (): void => {
  lastBroadcastMobs.clear();
};

export const buildPresenceLeaveDelta = (playerId: string): GameDelta => ({
  type: 'presenceDelta',
  left: {
    playerId,
    reason: 'timeout',
  },
});

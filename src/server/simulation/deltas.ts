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

export const buildPresenceLeaveDelta = (playerId: string): GameDelta => ({
  type: 'presenceDelta',
  left: {
    playerId,
    reason: 'timeout',
  },
});

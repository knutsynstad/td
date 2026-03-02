export type MobTypeId = 'basic';

export type MobDef = {
  id: MobTypeId;
  hp: number;
  maxHp: number;
  speed: number;
  width: number;
  height: number;
  siegeDamage: number;
  siegeCooldown: number;
};

export const MOB_DEFS: Record<MobTypeId, MobDef> = {
  basic: {
    id: 'basic',
    hp: 4,
    maxHp: 4,
    speed: 3.4,
    width: 0.65,
    height: 1.3,
    siegeDamage: 2,
    siegeCooldown: 0.8,
  },
};

export const getMobDef = (id: MobTypeId): MobDef => MOB_DEFS[id];

export const DEFAULT_MOB_TYPE: MobTypeId = 'basic';

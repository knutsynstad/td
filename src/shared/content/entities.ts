import type { TowerTypeId } from './towers';

export type TowerState = {
  typeId: TowerTypeId;
  range: number;
  damage: number;
  shootCadence: number;
  rangeLevel: number;
  damageLevel: number;
  speedLevel: number;
  killCount: number;
  builtBy: string;
  shootCooldown: number;
  level: number;
};

export type MobEntityState = {
  mobId?: string;
  hp: number;
  maxHp: number;
  staged: boolean;
  siegeAttackCooldown: number;
  unreachableTime: number;
  lastHitBy?: 'player' | 'tower';
  berserkMode: boolean;
  laneBlocked: boolean;
  spawnerId?: string;
  representedCount?: number;
};

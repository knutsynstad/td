export type TowerTypeId = 'base';

export type TowerDef = {
  id: TowerTypeId;
  label: string;
  range: number;
  damage: number;
  shootCadence: number;
};

export const TOWER_DEFS: Record<TowerTypeId, TowerDef> = {
  base: {
    id: 'base',
    label: 'Tower',
    range: 8,
    damage: 4,
    shootCadence: 0.25,
  },
};

export type TowerUpgradeId = 'range' | 'damage' | 'speed';

export type TowerUpgradeDef = {
  id: TowerUpgradeId;
  label: string;
  maxLevel: number;
  upgradeCost: number;
};

export const TOWER_UPGRADE_DEFS: Record<TowerUpgradeId, TowerUpgradeDef> = {
  range: {
    id: 'range',
    label: 'Range',
    maxLevel: 5,
    upgradeCost: 20,
  },
  damage: {
    id: 'damage',
    label: 'Damage',
    maxLevel: 5,
    upgradeCost: 20,
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    maxLevel: 5,
    upgradeCost: 20,
  },
};

export const getTowerDef = (id: TowerTypeId): TowerDef => TOWER_DEFS[id];

export const getTowerUpgradeDef = (id: TowerUpgradeId): TowerUpgradeDef =>
  TOWER_UPGRADE_DEFS[id];

export const getTowerDps = (def: TowerDef): number =>
  def.damage / def.shootCadence;

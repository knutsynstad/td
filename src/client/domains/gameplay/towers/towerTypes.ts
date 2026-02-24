import type { Tower } from '../types/entities';

export type TowerTypeId = 'base';

export type TowerTypeConfig = {
  id: TowerTypeId;
  label: string;
  level: number;
  color: number;
  range: number;
  damage: number;
  shootCadence: number;
};

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  base: {
    id: 'base',
    label: 'Tower',
    level: 1,
    color: 0x5aa4ff,
    range: 8,
    damage: 4,
    shootCadence: 0.25,
  },
};

export type TowerUpgradeId = 'range' | 'damage' | 'speed';

export type TowerUpgradeConfig = {
  id: TowerUpgradeId;
  label: string;
  requiredWorkers: number;
  upgradeDurationSec: number;
  maxLevel: number;
};

export const TOWER_UPGRADES: Record<TowerUpgradeId, TowerUpgradeConfig> = {
  range: {
    id: 'range',
    label: 'Range',
    requiredWorkers: 1,
    upgradeDurationSec: 8,
    maxLevel: 5,
  },
  damage: {
    id: 'damage',
    label: 'Damage',
    requiredWorkers: 1,
    upgradeDurationSec: 8,
    maxLevel: 5,
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    requiredWorkers: 2,
    upgradeDurationSec: 10,
    maxLevel: 5,
  },
};

export const getTowerType = (towerTypeId: TowerTypeId): TowerTypeConfig =>
  TOWER_TYPES[towerTypeId];
export const getTowerUpgrade = (
  upgradeId: TowerUpgradeId
): TowerUpgradeConfig => TOWER_UPGRADES[upgradeId];
export const getTowerUpgradeDeltaText = (upgradeId: TowerUpgradeId): string => {
  if (upgradeId === 'range') return '+1';
  if (upgradeId === 'damage') return '+1';
  return '+2/s';
};
export const getTowerUpgradeOptions = (tower: Tower): TowerUpgradeConfig[] => {
  const options: TowerUpgradeConfig[] = [];
  if (tower.rangeLevel < TOWER_UPGRADES.range.maxLevel)
    options.push(TOWER_UPGRADES.range);
  if (tower.damageLevel < TOWER_UPGRADES.damage.maxLevel)
    options.push(TOWER_UPGRADES.damage);
  if (tower.speedLevel < TOWER_UPGRADES.speed.maxLevel)
    options.push(TOWER_UPGRADES.speed);
  return options;
};

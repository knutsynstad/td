export type TowerTypeId = 'base' | 'sniper' | 'rapid' | 'splash'

export type TowerTypeConfig = {
  id: TowerTypeId
  label: string
  level: number
  color: number
  range: number
  damage: number
  shootCadence: number
  requiredWorkers: number
  upgradeDurationSec: number
  upgrades: TowerTypeId[]
}

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  base: {
    id: 'base',
    label: 'Base Tower',
    level: 1,
    color: 0x5aa4ff,
    range: 8,
    damage: 5,
    shootCadence: 0.25,
    requiredWorkers: 1,
    upgradeDurationSec: 8,
    upgrades: ['sniper', 'rapid']
  },
  sniper: {
    id: 'sniper',
    label: 'Sniper',
    level: 2,
    color: 0xb48cff,
    range: 11,
    damage: 12,
    shootCadence: 1.2,
    requiredWorkers: 2,
    upgradeDurationSec: 14,
    upgrades: ['splash']
  },
  rapid: {
    id: 'rapid',
    label: 'Rapid',
    range: 7,
    damage: 3,
    shootCadence: 0.11,
    level: 2,
    color: 0x57e39d,
    requiredWorkers: 2,
    upgradeDurationSec: 12,
    upgrades: ['splash']
  },
  splash: {
    id: 'splash',
    label: 'Splash',
    range: 9,
    damage: 8,
    shootCadence: 0.45,
    level: 3,
    color: 0xffb86a,
    requiredWorkers: 3,
    upgradeDurationSec: 20,
    upgrades: []
  }
}

export const getTowerType = (towerTypeId: TowerTypeId): TowerTypeConfig => TOWER_TYPES[towerTypeId]
export const getUpgradeOptions = (towerTypeId: TowerTypeId): TowerTypeConfig[] =>
  TOWER_TYPES[towerTypeId].upgrades.map(id => TOWER_TYPES[id])

import {
  ENERGY_COST_UPGRADE_DAMAGE,
  ENERGY_COST_UPGRADE_RANGE,
  ENERGY_COST_UPGRADE_SPEED,
  REPAIR_CRITICAL_HP_RATIO,
  REPAIR_DISCOUNT_RATE,
  REPAIR_WARNING_HP_RATIO,
} from './constants';
import type { TowerUpgradeId } from './towers/towerTypes';
import { clamp } from '../world/collision';

export const getUpgradeEnergyCost = (upgradeId: TowerUpgradeId): number => {
  if (upgradeId === 'range') return ENERGY_COST_UPGRADE_RANGE;
  if (upgradeId === 'damage') return ENERGY_COST_UPGRADE_DAMAGE;
  return ENERGY_COST_UPGRADE_SPEED;
};

export const getRepairCost = (state: {
  hp: number;
  maxHp: number;
  cumulativeBuildCost?: number;
}) => {
  if (state.maxHp <= 0 || state.hp >= state.maxHp) return 0;
  const missingRatio = clamp((state.maxHp - state.hp) / state.maxHp, 0, 1);
  const cumulativeBuildCost = Math.max(0, state.cumulativeBuildCost ?? 0);
  return Math.max(
    1,
    Math.ceil(cumulativeBuildCost * REPAIR_DISCOUNT_RATE * missingRatio)
  );
};

export const getRepairStatus = (
  hp: number,
  maxHp: number
): 'healthy' | 'needs_repair' | 'critical' => {
  if (maxHp <= 0) return 'healthy';
  const hpRatio = hp / maxHp;
  if (hpRatio <= REPAIR_CRITICAL_HP_RATIO) return 'critical';
  if (hpRatio < REPAIR_WARNING_HP_RATIO) return 'needs_repair';
  return 'healthy';
};

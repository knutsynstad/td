import type { TowerUpgradeId } from '../domains/gameplay/towers/towerTypes';
import { buildCoinCostMarkup, getCoinIconUrl } from './components/coinCost';

const formatStatNumber = (value: number, maxDecimals = 2): string => {
  const rounded = Number(value.toFixed(maxDecimals));
  return String(rounded);
};

export const buildInfoListMarkup = (items: Array<{ label: string; value: string }>) =>
  items.length > 0
    ? `<ul class="selection-dialog__info-list">
        ${items
          .map(
            (item) =>
              `<li class="selection-dialog__info-item">${item.label}: ${item.value}</li>`
          )
          .join('')}
      </ul>`
    : '';

export const buildStatsMarkup = (
  towerDetails: {
    range: number;
    damage: number;
    speed: number;
  },
  upgradeOptions: Array<{
    id: TowerUpgradeId;
    cost: number;
    canAfford: boolean;
  }>,
  upgradesDisabled: boolean
) => {
  const upgradesById = new Map(
    upgradeOptions.map((option) => [option.id, option])
  );
  const renderStatCol = (
    upgradeId: TowerUpgradeId,
    label: string,
    value: string
  ) => {
    const upgrade = upgradesById.get(upgradeId);
    const disabled =
      !upgrade || upgradesDisabled || !upgrade.canAfford;
    const upgradeContent = upgrade
      ? `<span class="selection-dialog__stat-upgrade-line">Upgrade</span><span class="selection-dialog__stat-upgrade-cost">${buildCoinCostMarkup(upgrade.cost, 'Coin cost')}</span>`
      : '<span class="selection-dialog__stat-upgrade-line">Max</span>';
    return `
      <div class="selection-dialog__stat-col">
        <div class="selection-dialog__stat-col-body">
          <span class="selection-dialog__stat-value">${value}</span>
          <span class="selection-dialog__stat-label">${label}</span>
        </div>
        <button class="selection-dialog__stat-upgrade-btn" data-upgrade="${upgradeId}" ${disabled ? 'disabled' : ''}>${upgradeContent}</button>
      </div>
    `;
  };
  return `<div class="selection-dialog__stats-row">
    ${renderStatCol('range', 'Range', `${formatStatNumber(towerDetails.range, 2)}m`)}
    ${renderStatCol('damage', 'Damage', String(towerDetails.damage))}
    ${renderStatCol('speed', 'Speed', `${formatStatNumber(towerDetails.speed, 2)}/s`)}
  </div>`;
};

export const buildBankActionsMarkup = (
  canBankAdd1: boolean,
  canBankAdd10: boolean,
  canBankRemove1: boolean,
  canBankRemove10: boolean
) => {
  const coinIcon = `<img class="coin-cost__icon selection-dialog__bank-coin-icon" src="${getCoinIconUrl()}" alt="" aria-hidden="true" />`;
  return `<div class="selection-dialog__bank-adjust-grid">
    <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--withdraw" data-bank-remove-1 ${canBankRemove1 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Take</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>1</span></span></button>
    <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--deposit" data-bank-add-1 ${canBankAdd1 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Add</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>1</span></span></button>
    <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--withdraw" data-bank-remove-10 ${canBankRemove10 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Take</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>10</span></span></button>
    <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--deposit" data-bank-add-10 ${canBankAdd10 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Add</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>10</span></span></button>
  </div>`;
};

export const buildRepairMarkup = (
  canRepair: boolean,
  repairCost: number | null
) =>
  `<div class="selection-dialog__action-bar">
    <button class="selection-dialog__action" data-repair ${canRepair ? '' : 'disabled'}>
      ${canRepair && repairCost !== null ? `Repair ${buildCoinCostMarkup(repairCost, 'Coin cost')}` : 'Repair'}
    </button>
  </div>`;

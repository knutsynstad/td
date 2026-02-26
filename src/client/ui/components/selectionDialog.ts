import { getTowerType } from '../../domains/gameplay/towers/towerTypes';
import type {
  TowerTypeId,
  TowerUpgradeId,
} from '../../domains/gameplay/towers/towerTypes';
import { buildCoinCostMarkup, getCoinIconUrl } from './coinCost';

type SelectionDialogState = {
  selectedCount: number;
  inRangeCount: number;
  isBankSelected: boolean;
  selectedTowerTypeId: TowerTypeId | null;
  selectedStructureLabel: string;
  bankTotal: number | null;
  canBankAdd1: boolean;
  canBankAdd10: boolean;
  canBankRemove1: boolean;
  canBankRemove10: boolean;
  showRepair: boolean;
  buildingCoords: { x: number; z: number } | null;
  buildingHealth: {
    hp: number;
    maxHp: number;
  } | null;
  upgradeOptions: Array<{
    id: TowerUpgradeId;
    label: string;
    deltaText: string;
    cost: number;
    canAfford: boolean;
  }>;
  towerDetails: {
    builtBy: string;
    killCount: number;
    range: number;
    damage: number;
    speed: number;
    dps: number;
    rangeLevel: number;
    damageLevel: number;
    speedLevel: number;
  } | null;
  canRepair: boolean;
  canDelete: boolean;
  repairCost: number | null;
  repairStatus: 'healthy' | 'needs_repair' | 'critical' | null;
};

type SelectionDialogActions = {
  onUpgrade: (upgradeId: TowerUpgradeId) => void;
  onRepair: () => void;
  onDelete: () => void;
  onBankAdd1: () => void;
  onBankAdd10: () => void;
  onBankRemove1: () => void;
  onBankRemove10: () => void;
};

export class SelectionDialog {
  private root: HTMLDivElement;
  private formSlot: HTMLDivElement;
  private state: SelectionDialogState;
  private actions: SelectionDialogActions;
  private lastRenderKey = '';
  private lastRenderAt = Number.NEGATIVE_INFINITY;
  private isHidden = false;
  private static readonly MIN_RENDER_INTERVAL_MS = 100;

  constructor(
    parent: HTMLElement,
    state: SelectionDialogState,
    actions: SelectionDialogActions
  ) {
    this.state = state;
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.className = 'selection-dialog';
    const tapeTop = document.createElement('div');
    tapeTop.className = 'selection-dialog__tape selection-dialog__tape--top';
    tapeTop.setAttribute('aria-hidden', 'true');
    const tapeBottom = document.createElement('div');
    tapeBottom.className =
      'selection-dialog__tape selection-dialog__tape--bottom';
    tapeBottom.setAttribute('aria-hidden', 'true');
    this.formSlot = document.createElement('div');
    this.formSlot.className = 'selection-dialog__form';
    this.root.append(tapeTop, this.formSlot, tapeBottom);
    this.root.addEventListener('click', this.handleClick);
    parent.appendChild(this.root);
    this.render();
  }

  private isTowerUpgradeId(value: string): value is TowerUpgradeId {
    return value === 'range' || value === 'damage' || value === 'speed';
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button || !this.root.contains(button)) return;

    const upgradeId = button.getAttribute('data-upgrade');
    if (upgradeId !== null && this.isTowerUpgradeId(upgradeId)) {
      this.actions.onUpgrade(upgradeId);
      return;
    }

    if (button.hasAttribute('data-repair')) {
      this.actions.onRepair();
      return;
    }
    if (button.hasAttribute('data-delete')) {
      this.actions.onDelete();
      return;
    }
    if (button.hasAttribute('data-bank-add-1')) {
      this.actions.onBankAdd1();
      return;
    }
    if (button.hasAttribute('data-bank-add-10')) {
      this.actions.onBankAdd10();
      return;
    }
    if (button.hasAttribute('data-bank-remove-1')) {
      this.actions.onBankRemove1();
      return;
    }
    if (button.hasAttribute('data-bank-remove-10')) {
      this.actions.onBankRemove10();
    }
  };

  update(state: SelectionDialogState) {
    const shouldHide = state.selectedCount === 0 || state.inRangeCount === 0;
    if (shouldHide) {
      this.state = state;
      this.lastRenderKey = '';
      if (!this.isHidden) {
        this.isHidden = true;
        this.root.classList.remove('is-visible');
        this.formSlot.innerHTML = '';
      }
      return;
    }
    const now = performance.now();
    if (now - this.lastRenderAt < SelectionDialog.MIN_RENDER_INTERVAL_MS) {
      this.state = state;
      return;
    }
    this.state = state;
    const nextKey = JSON.stringify(this.state);
    if (nextKey === this.lastRenderKey) return;
    this.lastRenderKey = nextKey;
    this.lastRenderAt = now;
    this.render();
  }

  private render() {
    const {
      selectedCount,
      inRangeCount,
      isBankSelected,
      selectedTowerTypeId,
      selectedStructureLabel,
      bankTotal,
      canBankAdd1,
      canBankAdd10,
      canBankRemove1,
      canBankRemove10,
      showRepair,
      buildingCoords,
      buildingHealth,
      upgradeOptions,
      towerDetails,
      canDelete,
      canRepair,
      repairCost,
    } = this.state;
    if (selectedCount === 0 || inRangeCount === 0) {
      this.isHidden = true;
      this.root.classList.remove('is-visible');
      this.formSlot.innerHTML = '';
      return;
    }
    this.isHidden = false;
    this.root.classList.add('is-visible');
    const typeLabel = selectedTowerTypeId
      ? getTowerType(selectedTowerTypeId).label
      : selectedStructureLabel;
    const upgradesById = new Map(
      upgradeOptions.map((option) => [option.id, option])
    );
    const upgradesDisabled = inRangeCount === 0;
    const formatStatNumber = (value: number, maxDecimals = 2): string => {
      const rounded = Number(value.toFixed(maxDecimals));
      return String(rounded);
    };
    const infoItems: Array<{ label: string; value: string }> = [];
    if (buildingCoords) {
      infoItems.push({
        label: 'Coords',
        value: `${buildingCoords.x},${buildingCoords.z}`,
      });
    }
    if (isBankSelected && bankTotal !== null) {
      infoItems.push({
        label: 'Coin Balance',
        value: `${Math.floor(bankTotal)}`,
      });
    }
    if (buildingHealth) {
      const hp = Math.max(0, Math.ceil(buildingHealth.hp));
      const pct =
        buildingHealth.maxHp > 0
          ? Math.round((buildingHealth.hp / buildingHealth.maxHp) * 100)
          : 100;
      infoItems.push({
        label: 'Health',
        value: `${hp} (${pct}%)`,
      });
    }
    if (towerDetails) {
      infoItems.push({
        label: 'Damage per second',
        value: towerDetails.dps.toFixed(1),
      });
      infoItems.push({
        label: 'Kills',
        value: String(towerDetails.killCount),
      });
    }
    const infoListMarkup =
      infoItems.length > 0
        ? `<ul class="selection-dialog__info-list">
            ${infoItems
              .map(
                (item) =>
                  `<li class="selection-dialog__info-item">${item.label}: ${item.value}</li>`
              )
              .join('')}
          </ul>`
        : '';
    const statsMarkup =
      !isBankSelected && towerDetails
        ? (() => {
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
              ${renderStatCol(
                'range',
                'Range',
                `${formatStatNumber(towerDetails.range, 2)}m`
              )}
              ${renderStatCol('damage', 'Damage', String(towerDetails.damage))}
              ${renderStatCol(
                'speed',
                'Speed',
                `${formatStatNumber(towerDetails.speed, 2)}/s`
              )}
            </div>`;
          })()
        : '';
    const noUpgradesLeftMarkup =
      !isBankSelected && towerDetails && upgradeOptions.length === 0
        ? '<div class="selection-dialog__hint">All stats maxed</div>'
        : '';
    const statusMarkup = noUpgradesLeftMarkup
      ? `<div class="selection-dialog__group selection-dialog__group--status">${noUpgradesLeftMarkup}</div>`
      : '';
    const coinIcon = `<img class="coin-cost__icon selection-dialog__bank-coin-icon" src="${getCoinIconUrl()}" alt="" aria-hidden="true" />`;
    const bankActionsMarkup = isBankSelected
      ? `<div class="selection-dialog__bank-adjust-grid">
          <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--withdraw" data-bank-remove-1 ${canBankRemove1 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Take</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>1</span></span></button>
          <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--deposit" data-bank-add-1 ${canBankAdd1 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Add</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>1</span></span></button>
          <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--withdraw" data-bank-remove-10 ${canBankRemove10 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Take</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>10</span></span></button>
          <button class="selection-dialog__bank-adjust-btn selection-dialog__bank-adjust-btn--deposit" data-bank-add-10 ${canBankAdd10 ? '' : 'disabled'}><span class="selection-dialog__bank-adjust-label">Add</span><span class="selection-dialog__bank-coin-group">${coinIcon}<span>10</span></span></button>
        </div>`
      : '';

    const deleteBtnMarkup = !isBankSelected
      ? `<button class="selection-dialog__delete-btn" data-delete ${canDelete ? '' : 'disabled'} aria-label="Delete"><svg class="selection-dialog__delete-icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm80-160h80v-360h-80v360Zm160 0h80v-360h-80v360Z"/></svg></button>`
      : '';

    this.formSlot.innerHTML = `
      <div class="selection-dialog__header">
        <div class="selection-dialog__title">${typeLabel}</div>
        ${deleteBtnMarkup}
      </div>
      ${infoListMarkup}
      ${statsMarkup}
      ${statusMarkup}
      ${
        isBankSelected
          ? bankActionsMarkup
          : showRepair
            ? `<div class="selection-dialog__action-bar">
                 <button class="selection-dialog__action" data-repair ${canRepair ? '' : 'disabled'}>
                   ${canRepair && repairCost !== null ? `Repair ${buildCoinCostMarkup(repairCost, 'Coin cost')}` : 'Repair'}
                 </button>
               </div>`
            : ''
      }
    `;
  }
}

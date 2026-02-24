import {
  getTowerType,
  getTowerUpgrade,
} from '../../domains/gameplay/towers/towerTypes';
import type {
  TowerTypeId,
  TowerUpgradeId,
} from '../../domains/gameplay/towers/towerTypes';
import { buildCoinCostMarkup } from './coinCost';

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
        this.root.style.display = 'none';
        this.root.innerHTML = '';
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
      repairStatus,
    } = this.state;
    if (selectedCount === 0 || inRangeCount === 0) {
      this.isHidden = true;
      this.root.style.display = 'none';
      this.root.innerHTML = '';
      return;
    }
    this.isHidden = false;
    this.root.style.display = '';
    const typeLabel = selectedTowerTypeId
      ? getTowerType(selectedTowerTypeId).label
      : selectedStructureLabel;
    const titleMarkup = buildingCoords
      ? `<span class="selection-dialog__title-main">${typeLabel}</span> <span class="selection-dialog__coords">${buildingCoords.x},${buildingCoords.z}</span>`
      : `<span class="selection-dialog__title-main">${typeLabel}</span>`;
    const upgradesById = new Map(
      upgradeOptions.map((option) => [option.id, option])
    );
    const upgradesDisabled = inRangeCount === 0;
    const formatStatNumber = (value: number, maxDecimals = 2): string => {
      const rounded = Number(value.toFixed(maxDecimals));
      return String(rounded);
    };
    const summaryItems: Array<{ label: string; value: string }> = [];
    if (isBankSelected && bankTotal !== null) {
      summaryItems.push({
        label: 'Coin Balance',
        value: `${Math.floor(bankTotal)}`,
      });
    }
    if (buildingHealth) {
      summaryItems.push({
        label: 'Health',
        value: `${Math.max(0, Math.ceil(buildingHealth.hp))}/${buildingHealth.maxHp}`,
      });
    }
    if (towerDetails) {
      summaryItems.push({ label: 'DPS', value: towerDetails.dps.toFixed(1) });
      summaryItems.push({
        label: 'Kills',
        value: String(towerDetails.killCount),
      });
    }
    const summaryMarkup = summaryItems.length
      ? `<div class="selection-dialog__summary-row">
          ${summaryItems
            .map(
              (item) => `
            <div class="selection-dialog__summary-item">
              <div class="selection-dialog__summary-value">${item.value}</div>
              <div class="selection-dialog__summary-label">${item.label}</div>
            </div>
          `
            )
            .join('')}
        </div>`
      : '';
    const statsMarkup =
      !isBankSelected && towerDetails
        ? `<div class="selection-dialog__group selection-dialog__group--stats">
          <div class="selection-dialog__stats">
            ${(() => {
              const renderStatRow = (
                upgradeId: TowerUpgradeId,
                label: string,
                value: string,
                level: number
              ) => {
                const maxLevel = getTowerUpgrade(upgradeId).maxLevel;
                const safeLevel = Math.max(0, Math.min(level, maxLevel));
                const levelSegments = Array.from(
                  { length: maxLevel },
                  (_, idx) => `
                  <span class="selection-dialog__stat-level-segment ${idx < safeLevel ? 'is-active' : ''}"></span>
                `
                ).join('');
                const upgrade = upgradesById.get(upgradeId);
                const controlsMarkup = (() => {
                  if (!upgrade) return '';
                  const disabled = upgradesDisabled || !upgrade.canAfford;
                  const buttonLabel = `Upgrade ${buildCoinCostMarkup(upgrade.cost, 'Coin cost')}`;
                  return `<button class="selection-dialog__stat-upgrade" data-upgrade="${upgradeId}" ${disabled ? 'disabled' : ''}>${buttonLabel}</button>`;
                })();
                return `
                  <div class="selection-dialog__stat-item">
                    <div class="selection-dialog__stat-row">
                      <span class="selection-dialog__stat-label">${label}: ${value}</span>
                      <span class="selection-dialog__stat-controls">
                        ${controlsMarkup}
                      </span>
                    </div>
                    <div class="selection-dialog__stat-level-wrap" aria-label="${label} level progress">
                      <span class="selection-dialog__stat-level-bar">${levelSegments}</span>
                    </div>
                  </div>
                `;
              };
              return [
                renderStatRow(
                  'range',
                  'Range',
                  `${formatStatNumber(towerDetails.range, 2)}m`,
                  towerDetails.rangeLevel
                ),
                renderStatRow(
                  'damage',
                  'Damage',
                  String(towerDetails.damage),
                  towerDetails.damageLevel
                ),
                renderStatRow(
                  'speed',
                  'Speed',
                  `${formatStatNumber(towerDetails.speed, 2)}/s`,
                  towerDetails.speedLevel
                ),
              ].join('');
            })()}
          </div>
        </div>`
        : '';
    const noUpgradesLeftMarkup =
      !isBankSelected && towerDetails && upgradeOptions.length === 0
        ? '<div class="selection-dialog__hint">All stats maxed</div>'
        : '';
    const statusMarkup = noUpgradesLeftMarkup
      ? `<div class="selection-dialog__group selection-dialog__group--status">${noUpgradesLeftMarkup}</div>`
      : '';
    const repairStatusLabel =
      repairStatus === 'critical'
        ? 'Critical'
        : repairStatus === 'needs_repair'
          ? 'Needs Repair'
          : 'Healthy';
    const repairInfoMarkup =
      !isBankSelected && showRepair
        ? `<div class="selection-dialog__meta selection-dialog__repair-meta">
          <span class="selection-dialog__repair-status selection-dialog__repair-status--${repairStatus ?? 'healthy'}">${repairStatusLabel}</span>
          ${repairCost !== null ? `<span class="selection-dialog__repair-cost">Repair ${buildCoinCostMarkup(repairCost, 'Coin cost')}</span>` : ''}
        </div>`
        : '';
    const bankActionsMarkup = isBankSelected
      ? `<div class="selection-dialog__bank-adjust-grid">
          <button class="selection-dialog__bank-adjust-btn" data-bank-remove-10 ${canBankRemove10 ? '' : 'disabled'}>-10</button>
          <button class="selection-dialog__bank-adjust-btn" data-bank-remove-1 ${canBankRemove1 ? '' : 'disabled'}>-1</button>
          <button class="selection-dialog__bank-adjust-btn" data-bank-add-1 ${canBankAdd1 ? '' : 'disabled'}>+1</button>
          <button class="selection-dialog__bank-adjust-btn" data-bank-add-10 ${canBankAdd10 ? '' : 'disabled'}>+10</button>
        </div>`
      : '';

    this.root.innerHTML = `
      <div class="selection-dialog__title">${titleMarkup}</div>
      ${summaryMarkup}
      ${repairInfoMarkup}
      ${statsMarkup}
      ${statusMarkup}
      ${
        isBankSelected
          ? bankActionsMarkup
          : `<div class="selection-dialog__action-bar">
             <button class="selection-dialog__action selection-dialog__danger" data-delete ${canDelete ? '' : 'disabled'}>
               Delete
             </button>
             ${
               showRepair
                 ? `<button class="selection-dialog__action" data-repair ${canRepair ? '' : 'disabled'}>
                    ${repairCost !== null ? `Repair ${buildCoinCostMarkup(repairCost, 'Coin cost')}` : 'Repair'}
                  </button>`
                 : ''
             }
           </div>`
      }
    `;
  }
}

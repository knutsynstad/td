import { getTowerType } from '../../domains/gameplay/towers/towerTypes';
import type {
  TowerTypeId,
  TowerUpgradeId,
} from '../../domains/gameplay/towers/towerTypes';
import {
  buildInfoListMarkup,
  buildStatsMarkup,
  buildCastleCoinsActionsMarkup,
  buildRepairMarkup,
} from '../selectionDialogMarkup';

type SelectionDialogState = {
  selectedCount: number;
  inRangeCount: number;
  isCastleSelected: boolean;
  selectedTowerTypeId: TowerTypeId | null;
  selectedStructureLabel: string;
  castleTotal: number | null;
  canCastleAdd1: boolean;
  canCastleAdd10: boolean;
  canCastleRemove1: boolean;
  canCastleRemove10: boolean;
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
  onCastleAdd1: () => void;
  onCastleAdd10: () => void;
  onCastleRemove1: () => void;
  onCastleRemove10: () => void;
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
    if (button.hasAttribute('data-castle-add-1')) {
      this.actions.onCastleAdd1();
      return;
    }
    if (button.hasAttribute('data-castle-add-10')) {
      this.actions.onCastleAdd10();
      return;
    }
    if (button.hasAttribute('data-castle-remove-1')) {
      this.actions.onCastleRemove1();
      return;
    }
    if (button.hasAttribute('data-castle-remove-10')) {
      this.actions.onCastleRemove10();
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
      isCastleSelected,
      selectedTowerTypeId,
      selectedStructureLabel,
      castleTotal,
      canCastleAdd1,
      canCastleAdd10,
      canCastleRemove1,
      canCastleRemove10,
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
    const upgradesDisabled = inRangeCount === 0;
    const infoItems: Array<{ label: string; value: string }> = [];
    if (buildingCoords) {
      infoItems.push({
        label: 'Coords',
        value: `${buildingCoords.x},${buildingCoords.z}`,
      });
    }
    if (isCastleSelected && castleTotal !== null) {
      infoItems.push({
        label: 'Coin Balance',
        value: `${Math.floor(castleTotal)}`,
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
    const infoListMarkup = buildInfoListMarkup(infoItems);
    const statsMarkup =
      !isCastleSelected && towerDetails
        ? buildStatsMarkup(towerDetails, upgradeOptions, upgradesDisabled)
        : '';
    const noUpgradesLeftMarkup =
      !isCastleSelected && towerDetails && upgradeOptions.length === 0
        ? '<div class="selection-dialog__hint">All stats maxed</div>'
        : '';
    const statusMarkup = noUpgradesLeftMarkup
      ? `<div class="selection-dialog__group selection-dialog__group--status">${noUpgradesLeftMarkup}</div>`
      : '';
    const castleCoinsActionsMarkup = isCastleSelected
      ? buildCastleCoinsActionsMarkup(
          canCastleAdd1,
          canCastleAdd10,
          canCastleRemove1,
          canCastleRemove10
        )
      : '';

    const deleteBtnMarkup = !isCastleSelected
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
        isCastleSelected
          ? castleCoinsActionsMarkup
          : showRepair
            ? buildRepairMarkup(canRepair, repairCost)
            : ''
      }
    `;
  }
}

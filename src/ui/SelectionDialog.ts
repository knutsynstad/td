import { getTowerType, getTowerUpgrade } from '../game/TowerTypes'
import type { TowerTypeId, TowerUpgradeId } from '../game/TowerTypes'
import { ENERGY_SYMBOL } from '../game/constants'

type SelectionDialogState = {
  selectedCount: number
  inRangeCount: number
  selectedTowerTypeId: TowerTypeId | null
  selectedStructureLabel: string
  showRepair: boolean
  buildingCoords: { x: number, z: number } | null
  buildingHealth: {
    hp: number
    maxHp: number
  } | null
  upgradeOptions: Array<{
    id: TowerUpgradeId
    label: string
    deltaText: string
    cost: number
    canAfford: boolean
  }>
  towerDetails: {
    builtBy: string
    killCount: number
    range: number
    damage: number
    speed: number
    dps: number
    rangeLevel: number
    damageLevel: number
    speedLevel: number
  } | null
  canRepair: boolean
  canDelete: boolean
  repairCost: number | null
  repairStatus: 'healthy' | 'needs_repair' | 'critical' | null
}

type SelectionDialogActions = {
  onUpgrade: (upgradeId: TowerUpgradeId) => void
  onRepair: () => void
  onDelete: () => void
}

export class SelectionDialog {
  private root: HTMLDivElement
  private state: SelectionDialogState
  private actions: SelectionDialogActions
  private lastRenderKey = ''

  constructor(parent: HTMLElement, state: SelectionDialogState, actions: SelectionDialogActions) {
    this.state = state
    this.actions = actions
    this.root = document.createElement('div')
    this.root.className = 'selection-dialog'
    parent.appendChild(this.root)
    this.render()
  }

  update(state: SelectionDialogState) {
    const nextKey = JSON.stringify(state)
    if (nextKey === this.lastRenderKey) return
    this.state = state
    this.lastRenderKey = nextKey
    this.render()
  }

  private render() {
    const {
      selectedCount,
      inRangeCount,
      selectedTowerTypeId,
      selectedStructureLabel,
      showRepair,
      buildingCoords,
      buildingHealth,
      upgradeOptions,
      towerDetails,
      canDelete,
      canRepair,
      repairCost,
      repairStatus
    } = this.state
    if (selectedCount === 0 || inRangeCount === 0) {
      this.root.style.display = 'none'
      this.root.innerHTML = ''
      return
    }
    this.root.style.display = ''
    const typeLabel = selectedTowerTypeId ? getTowerType(selectedTowerTypeId).label : selectedStructureLabel
    const titleMarkup = buildingCoords
      ? `<span class="selection-dialog__title-main">${typeLabel}</span> <span class="selection-dialog__coords">${buildingCoords.x},${buildingCoords.z}</span>`
      : `<span class="selection-dialog__title-main">${typeLabel}</span>`
    const upgradesById = new Map(upgradeOptions.map(option => [option.id, option]))
    const upgradesDisabled = inRangeCount === 0
    const formatStatNumber = (value: number, maxDecimals = 2): string => {
      const rounded = Number(value.toFixed(maxDecimals))
      return String(rounded)
    }
    const summaryItems: Array<{ label: string, value: string }> = []
    if (buildingHealth) {
      summaryItems.push({
        label: 'Health',
        value: `${Math.max(0, Math.ceil(buildingHealth.hp))}/${buildingHealth.maxHp}`
      })
    }
    if (towerDetails) {
      summaryItems.push({ label: 'DPS', value: towerDetails.dps.toFixed(1) })
      summaryItems.push({ label: 'Kills', value: String(towerDetails.killCount) })
    }
    const summaryMarkup = summaryItems.length
      ? `<div class="selection-dialog__summary-row">
          ${summaryItems.map(item => `
            <div class="selection-dialog__summary-item">
              <div class="selection-dialog__summary-value">${item.value}</div>
              <div class="selection-dialog__summary-label">${item.label}</div>
            </div>
          `).join('')}
        </div>`
      : ''
    const statsMarkup = towerDetails
      ? `<div class="selection-dialog__group selection-dialog__group--stats">
          <div class="selection-dialog__stats">
            ${(() => {
              const renderStatRow = (upgradeId: TowerUpgradeId, label: string, value: string, level: number) => {
                const maxLevel = getTowerUpgrade(upgradeId).maxLevel
                const safeLevel = Math.max(0, Math.min(level, maxLevel))
                const levelSegments = Array.from({ length: maxLevel }, (_, idx) => `
                  <span class="selection-dialog__stat-level-segment ${idx < safeLevel ? 'is-active' : ''}"></span>
                `).join('')
                const upgrade = upgradesById.get(upgradeId)
                const controlsMarkup = (() => {
                  if (!upgrade) return ''
                  const disabled = upgradesDisabled || !upgrade.canAfford
                  const buttonLabel = `Upgrade ${ENERGY_SYMBOL}${upgrade.cost}`
                  return `<button class="selection-dialog__stat-upgrade" data-upgrade="${upgradeId}" ${disabled ? 'disabled' : ''}>${buttonLabel}</button>`
                })()
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
                `
              }
              return [
                renderStatRow('range', 'Range', `${formatStatNumber(towerDetails.range, 2)}m`, towerDetails.rangeLevel),
                renderStatRow('damage', 'Damage', String(towerDetails.damage), towerDetails.damageLevel),
                renderStatRow('speed', 'Speed', `${formatStatNumber(towerDetails.speed, 2)}/s`, towerDetails.speedLevel)
              ].join('')
            })()}
          </div>
        </div>`
      : ''
    const noUpgradesLeftMarkup = towerDetails && upgradeOptions.length === 0
      ? '<div class="selection-dialog__hint">All stats maxed</div>'
      : ''
    const statusMarkup = noUpgradesLeftMarkup
      ? `<div class="selection-dialog__group selection-dialog__group--status">${noUpgradesLeftMarkup}</div>`
      : ''
    const repairStatusLabel = repairStatus === 'critical'
      ? 'Critical'
      : repairStatus === 'needs_repair'
        ? 'Needs Repair'
        : 'Healthy'
    const repairInfoMarkup = showRepair
      ? `<div class="selection-dialog__meta selection-dialog__repair-meta">
          <span class="selection-dialog__repair-status selection-dialog__repair-status--${repairStatus ?? 'healthy'}">${repairStatusLabel}</span>
          ${repairCost !== null ? `<span class="selection-dialog__repair-cost">Repair ${ENERGY_SYMBOL}${repairCost}</span>` : ''}
        </div>`
      : ''

    this.root.innerHTML = `
      <div class="selection-dialog__title">${titleMarkup}</div>
      ${summaryMarkup}
      ${repairInfoMarkup}
      ${statsMarkup}
      ${statusMarkup}
      <div class="selection-dialog__action-bar">
        <button class="selection-dialog__action selection-dialog__danger" data-delete ${canDelete ? '' : 'disabled'}>
          Delete
        </button>
        ${showRepair
          ? `<button class="selection-dialog__action" data-repair ${canRepair ? '' : 'disabled'}>
               ${repairCost !== null ? `Repair ${ENERGY_SYMBOL}${repairCost}` : 'Repair'}
             </button>`
          : ''}
      </div>
    `

    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]'))) {
      const id = btn.dataset.upgrade as TowerUpgradeId
      btn.addEventListener('click', () => this.actions.onUpgrade(id))
    }
    const repairBtn = this.root.querySelector<HTMLButtonElement>('button[data-repair]')
    repairBtn?.addEventListener('click', () => this.actions.onRepair())
    const deleteBtn = this.root.querySelector<HTMLButtonElement>('button[data-delete]')
    deleteBtn?.addEventListener('click', () => this.actions.onDelete())
  }
}

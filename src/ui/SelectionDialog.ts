import { getTowerType } from '../game/TowerTypes'
import type { TowerTypeId, TowerUpgradeId } from '../game/TowerTypes'

type SelectionDialogState = {
  selectedCount: number
  inRangeCount: number
  selectedTowerTypeId: TowerTypeId | null
  buildingHealth: {
    hp: number
    maxHp: number
  } | null
  upgradeOptions: Array<{ id: TowerUpgradeId, label: string, deltaText: string }>
  towerDetails: {
    builtBy: string
    killCount: number
    range: number
    damage: number
    speed: number
    dps: number
  } | null
  upgradeBlockedReason: string | null
  canRepair: boolean
  canDelete: boolean
  activeUpgradeText: string | null
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
      buildingHealth,
      upgradeOptions,
      towerDetails,
      canDelete,
      canRepair,
      upgradeBlockedReason,
      activeUpgradeText
    } = this.state
    if (selectedCount === 0) {
      this.root.style.display = 'none'
      this.root.innerHTML = ''
      return
    }
    this.root.style.display = ''
    const typeLabel = selectedTowerTypeId ? getTowerType(selectedTowerTypeId).label : 'Wall'
    const upgradesById = new Map(upgradeOptions.map(option => [option.id, option]))
    const upgradesDisabled = Boolean(upgradeBlockedReason) || inRangeCount === 0
    const healthText = buildingHealth
      ? `Health ${Math.max(0, Math.ceil(buildingHealth.hp))}/${buildingHealth.maxHp}`
      : ''
    const dpsText = towerDetails ? `DPS ${towerDetails.dps.toFixed(1)}` : ''
    const summaryRows: string[] = []
    if (healthText) summaryRows.push(healthText)
    if (dpsText) summaryRows.push(dpsText)
    if (towerDetails) summaryRows.push(`Kills ${towerDetails.killCount}`)
    const summaryMarkup = summaryRows.length
      ? `<div class="selection-dialog__group selection-dialog__group--summary">
          ${summaryRows.map(row => `<div class="selection-dialog__meta selection-dialog__summary-line">${row}</div>`).join('')}
        </div>`
      : ''
    const statsMarkup = towerDetails
      ? `<div class="selection-dialog__group selection-dialog__group--stats">
          <div class="selection-dialog__section-title">Stats</div>
          <div class="selection-dialog__stats">
            <div class="selection-dialog__stat-row">
              <span>Range ${towerDetails.range.toFixed(1)}</span>
              ${(() => {
                const upgrade = upgradesById.get('range')
                const disabled = upgradesDisabled || !upgrade
                const text = upgrade?.deltaText ?? 'Max'
                return `<button class="selection-dialog__stat-upgrade" data-upgrade="range" ${disabled ? 'disabled' : ''}>${text}</button>`
              })()}
            </div>
            <div class="selection-dialog__stat-row">
              <span>Damage ${towerDetails.damage}</span>
              ${(() => {
                const upgrade = upgradesById.get('damage')
                const disabled = upgradesDisabled || !upgrade
                const text = upgrade?.deltaText ?? 'Max'
                return `<button class="selection-dialog__stat-upgrade" data-upgrade="damage" ${disabled ? 'disabled' : ''}>${text}</button>`
              })()}
            </div>
            <div class="selection-dialog__stat-row">
              <span>Speed ${towerDetails.speed.toFixed(2)}/s</span>
              ${(() => {
                const upgrade = upgradesById.get('speed')
                const disabled = upgradesDisabled || !upgrade
                const text = upgrade?.deltaText ?? 'Max'
                return `<button class="selection-dialog__stat-upgrade" data-upgrade="speed" ${disabled ? 'disabled' : ''}>${text}</button>`
              })()}
            </div>
          </div>
        </div>`
      : ''
    const noUpgradesLeftMarkup = towerDetails && upgradeOptions.length === 0
      ? '<div class="selection-dialog__hint">All stats maxed</div>'
      : ''
    const statusMarkup = (activeUpgradeText || upgradeBlockedReason || noUpgradesLeftMarkup)
      ? `<div class="selection-dialog__group selection-dialog__group--status">
          ${activeUpgradeText ? `<div class="selection-dialog__hint">${activeUpgradeText}</div>` : ''}
          ${upgradeBlockedReason ? `<div class="selection-dialog__hint">${upgradeBlockedReason}</div>` : ''}
          ${noUpgradesLeftMarkup}
        </div>`
      : ''

    this.root.innerHTML = `
      <div class="selection-dialog__title">${typeLabel}</div>
      ${summaryMarkup}
      ${statsMarkup}
      ${statusMarkup}
      <div class="selection-dialog__group selection-dialog__group--actions">
        <div class="selection-dialog__section-title">Building actions</div>
        <div class="selection-dialog__action-bar">
          <button class="selection-dialog__action" data-repair ${canRepair ? '' : 'disabled'}>
            Repair
          </button>
          <button class="selection-dialog__action selection-dialog__danger" data-delete ${canDelete ? '' : 'disabled'}>
            Delete
          </button>
        </div>
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

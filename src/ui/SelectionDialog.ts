import { getTowerType, getUpgradeOptions } from '../game/TowerTypes'
import type { TowerTypeId } from '../game/TowerTypes'

type SelectionDialogState = {
  selectedCount: number
  inRangeCount: number
  selectedTowerTypeId: TowerTypeId | null
  upgradeBlockedReason: string | null
  canDelete: boolean
  activeUpgradeText: string | null
}

type SelectionDialogActions = {
  onUpgrade: (targetTypeId: TowerTypeId) => void
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
    const { selectedCount, inRangeCount, selectedTowerTypeId, canDelete, upgradeBlockedReason, activeUpgradeText } = this.state
    if (selectedCount === 0) {
      this.root.style.display = 'none'
      this.root.innerHTML = ''
      return
    }
    this.root.style.display = ''
    const typeLabel = selectedTowerTypeId ? getTowerType(selectedTowerTypeId).label : 'Mixed'
    const options = selectedTowerTypeId ? getUpgradeOptions(selectedTowerTypeId) : []
    const optionsMarkup = options.length
      ? options.map(option => {
        const disabled = Boolean(upgradeBlockedReason) || inRangeCount === 0
        return `<button class="selection-dialog__action" data-upgrade="${option.id}" ${disabled ? 'disabled' : ''}>
          Upgrade to ${option.label}
        </button>`
      }).join('')
      : '<div class="selection-dialog__hint">No further upgrades</div>'

    this.root.innerHTML = `
      <div class="selection-dialog__title">Selection (${inRangeCount}/${selectedCount} in range)</div>
      <div class="selection-dialog__meta">${typeLabel}</div>
      ${activeUpgradeText ? `<div class="selection-dialog__hint">${activeUpgradeText}</div>` : ''}
      ${upgradeBlockedReason ? `<div class="selection-dialog__hint">${upgradeBlockedReason}</div>` : ''}
      <div class="selection-dialog__actions">${optionsMarkup}</div>
      <button class="selection-dialog__action selection-dialog__danger" data-delete ${canDelete ? '' : 'disabled'}>
        Delete
      </button>
    `

    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]'))) {
      const id = btn.dataset.upgrade as TowerTypeId
      btn.addEventListener('click', () => this.actions.onUpgrade(id))
    }
    const deleteBtn = this.root.querySelector<HTMLButtonElement>('button[data-delete]')
    deleteBtn?.addEventListener('click', () => this.actions.onDelete())
  }
}

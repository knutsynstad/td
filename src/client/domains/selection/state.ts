import type { TowerTypeId } from '../gameplay/towers/towerTypes'
import type { DestructibleCollider, Tower } from '../gameplay/types/entities'
import type { StructureStore } from '../gameplay/structureStore'

type PlayerLike = {
  mesh: { position: { x: number, z: number } }
}

export type SelectionState = {
  selectedStructures: Set<DestructibleCollider>
  selectedTower: Tower | null
}

export const createSelectionState = (): SelectionState => ({
  selectedStructures: new Set<DestructibleCollider>(),
  selectedTower: null
})

export const setSelectedStructures = (
  selection: SelectionState,
  colliders: DestructibleCollider[],
  structureStore: StructureStore
) => {
  selection.selectedStructures.clear()
  for (const collider of colliders) {
    selection.selectedStructures.add(collider)
  }
  if (colliders.length !== 1) {
    selection.selectedTower = null
    return
  }
  const state = structureStore.structureStates.get(colliders[0]!)
  selection.selectedTower = state?.tower ?? null
}

export const clearSelectionState = (selection: SelectionState) => {
  selection.selectedStructures.clear()
  selection.selectedTower = null
}

export const isColliderInRange = (
  player: PlayerLike,
  collider: DestructibleCollider,
  range: number
) => {
  const dx = Math.abs(player.mesh.position.x - collider.center.x) - collider.halfSize.x
  const dz = Math.abs(player.mesh.position.z - collider.center.z) - collider.halfSize.z
  const clampedDx = Math.max(0, dx)
  const clampedDz = Math.max(0, dz)
  return Math.hypot(clampedDx, clampedDz) <= range
}

export const getSelectedInRange = (
  selection: SelectionState,
  player: PlayerLike,
  range: number
) => Array.from(selection.selectedStructures).filter(collider => isColliderInRange(player, collider, range))

export const getSingleSelectedTower = (selection: SelectionState, structureStore: StructureStore): Tower | null => {
  if (selection.selectedStructures.size !== 1) return null
  const [collider] = selection.selectedStructures.values()
  const state = structureStore.structureStates.get(collider)
  return state?.tower ?? null
}

export const getSelectionTowerTypeId = (
  selection: SelectionState,
  structureStore: StructureStore
): TowerTypeId | null => {
  const typeIds = new Set<TowerTypeId>()
  for (const collider of selection.selectedStructures) {
    const tower = structureStore.structureStates.get(collider)?.tower
    if (!tower) return null
    typeIds.add(tower.typeId as TowerTypeId)
  }
  if (typeIds.size !== 1) return null
  return Array.from(typeIds)[0] ?? null
}

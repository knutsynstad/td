import * as THREE from 'three'
import type { Entity } from '../gameplay/types/entities'

export class SpatialGrid {
  private readonly cells: Map<string, Entity[]>
  private readonly cellSize: number

  constructor(cellSize: number) {
    this.cells = new Map()
    this.cellSize = cellSize
  }

  private getCellKey(x: number, z: number): string {
    const gx = Math.floor(x / this.cellSize)
    const gz = Math.floor(z / this.cellSize)
    return `${gx},${gz}`
  }

  clear() {
    this.cells.clear()
  }

  insert(entity: Entity) {
    const key = this.getCellKey(entity.mesh.position.x, entity.mesh.position.z)
    if (!this.cells.has(key)) {
      this.cells.set(key, [])
    }
    this.cells.get(key)!.push(entity)
  }

  getNearbyInto(pos: THREE.Vector3, radius: number, out: Entity[]): Entity[] {
    out.length = 0
    const minGx = Math.floor((pos.x - radius) / this.cellSize)
    const maxGx = Math.floor((pos.x + radius) / this.cellSize)
    const minGz = Math.floor((pos.z - radius) / this.cellSize)
    const maxGz = Math.floor((pos.z + radius) / this.cellSize)

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gz = minGz; gz <= maxGz; gz++) {
        const key = `${gx},${gz}`
        const cell = this.cells.get(key)
        if (!cell) continue
        for (const entity of cell) {
          const dx = entity.mesh.position.x - pos.x
          const dz = entity.mesh.position.z - pos.z
          const distSq = dx * dx + dz * dz
          if (distSq <= radius * radius) {
            out.push(entity)
          }
        }
      }
    }
    return out
  }

  getNearby(pos: THREE.Vector3, radius: number): Entity[] {
    return this.getNearbyInto(pos, radius, [])
  }
}

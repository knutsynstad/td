import * as THREE from 'three';
import type { Entity } from '../gameplay/types/entities';

export class SpatialGrid {
  private readonly rows: Map<number, Map<number, Entity[]>>;
  private readonly cellSize: number;
  private readonly entityCells: WeakMap<Entity, { gx: number; gz: number }>;

  constructor(cellSize: number) {
    this.rows = new Map();
    this.cellSize = cellSize;
    this.entityCells = new WeakMap();
  }

  private toCellCoord(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private getCell(gx: number, gz: number): Entity[] | undefined {
    const row = this.rows.get(gx);
    if (!row) return undefined;
    return row.get(gz);
  }

  private ensureCell(gx: number, gz: number): Entity[] {
    let row = this.rows.get(gx);
    if (!row) {
      row = new Map();
      this.rows.set(gx, row);
    }
    const existing = row.get(gz);
    if (existing) return existing;
    const created: Entity[] = [];
    row.set(gz, created);
    return created;
  }

  clear() {
    this.rows.clear();
  }

  insert(entity: Entity) {
    const gx = this.toCellCoord(entity.mesh.position.x);
    const gz = this.toCellCoord(entity.mesh.position.z);
    this.ensureCell(gx, gz).push(entity);
    this.entityCells.set(entity, { gx, gz });
  }

  remove(entity: Entity) {
    const tracked = this.entityCells.get(entity);
    if (!tracked) return;
    const cell = this.getCell(tracked.gx, tracked.gz);
    if (!cell) {
      this.entityCells.delete(entity);
      return;
    }
    const idx = cell.indexOf(entity);
    if (idx >= 0) cell.splice(idx, 1);
    this.entityCells.delete(entity);
  }

  updateEntityCell(entity: Entity) {
    const nextGx = this.toCellCoord(entity.mesh.position.x);
    const nextGz = this.toCellCoord(entity.mesh.position.z);
    const current = this.entityCells.get(entity);
    if (current && current.gx === nextGx && current.gz === nextGz) return;
    if (current) {
      const oldCell = this.getCell(current.gx, current.gz);
      if (oldCell) {
        const idx = oldCell.indexOf(entity);
        if (idx >= 0) oldCell.splice(idx, 1);
      }
    }
    this.ensureCell(nextGx, nextGz).push(entity);
    this.entityCells.set(entity, { gx: nextGx, gz: nextGz });
  }

  getNearbyInto(pos: THREE.Vector3, radius: number, out: Entity[]): Entity[] {
    out.length = 0;
    const minGx = this.toCellCoord(pos.x - radius);
    const maxGx = this.toCellCoord(pos.x + radius);
    const minGz = this.toCellCoord(pos.z - radius);
    const maxGz = this.toCellCoord(pos.z + radius);

    for (let gx = minGx; gx <= maxGx; gx++) {
      const row = this.rows.get(gx);
      if (!row) continue;
      for (let gz = minGz; gz <= maxGz; gz++) {
        const cell = row.get(gz);
        if (!cell) continue;
        for (const entity of cell) {
          const dx = entity.mesh.position.x - pos.x;
          const dz = entity.mesh.position.z - pos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq <= radius * radius) {
            out.push(entity);
          }
        }
      }
    }
    return out;
  }

  getNearby(pos: THREE.Vector3, radius: number): Entity[] {
    return this.getNearbyInto(pos, radius, []);
  }
}

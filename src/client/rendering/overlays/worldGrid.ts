import * as THREE from 'three';
import type { GroundBounds } from '../../domains/world/coords';

export class WorldGrid {
  private group: THREE.Group;
  private lineMaterial: THREE.LineBasicMaterial;
  private lines: THREE.Line[] = [];
  private lastBounds: GroundBounds | null = null;
  private readonly halfGrid: number;
  private readonly scene: THREE.Scene;
  private readonly gridSize: number;
  private readonly worldBounds: number;

  constructor(scene: THREE.Scene, gridSize: number, worldBounds: number) {
    this.scene = scene;
    this.gridSize = gridSize;
    this.worldBounds = worldBounds;
    this.group = new THREE.Group();
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
    });
    this.halfGrid = gridSize * 0.5;
    scene.add(this.group);
  }

  update(bounds: GroundBounds) {
    if (
      this.lastBounds &&
      this.lastBounds.minX === bounds.minX &&
      this.lastBounds.maxX === bounds.maxX &&
      this.lastBounds.minZ === bounds.minZ &&
      this.lastBounds.maxZ === bounds.maxZ
    ) {
      return;
    }
    this.lastBounds = bounds;

    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines = [];

    const clampedMinX = Math.max(bounds.minX, -this.worldBounds);
    const clampedMaxX = Math.min(bounds.maxX, this.worldBounds);
    const clampedMinZ = Math.max(bounds.minZ, -this.worldBounds);
    const clampedMaxZ = Math.min(bounds.maxZ, this.worldBounds);
    if (clampedMinX > clampedMaxX || clampedMinZ > clampedMaxZ) {
      return;
    }

    const minX =
      Math.ceil((clampedMinX - this.halfGrid) / this.gridSize) * this.gridSize +
      this.halfGrid;
    const maxX =
      Math.floor((clampedMaxX - this.halfGrid) / this.gridSize) *
        this.gridSize +
      this.halfGrid;
    const minZ =
      Math.ceil((clampedMinZ - this.halfGrid) / this.gridSize) * this.gridSize +
      this.halfGrid;
    const maxZ =
      Math.floor((clampedMaxZ - this.halfGrid) / this.gridSize) *
        this.gridSize +
      this.halfGrid;

    for (let x = minX; x <= maxX; x += this.gridSize) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, clampedMinZ),
        new THREE.Vector3(x, 0.01, clampedMaxZ),
      ]);
      const line = new THREE.Line(geometry, this.lineMaterial);
      this.group.add(line);
      this.lines.push(line);
    }

    for (let z = minZ; z <= maxZ; z += this.gridSize) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(clampedMinX, 0.01, z),
        new THREE.Vector3(clampedMaxX, 0.01, z),
      ]);
      const line = new THREE.Line(geometry, this.lineMaterial);
      this.group.add(line);
      this.lines.push(line);
    }
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  setBuildMode(active: boolean) {
    this.lineMaterial.color.setHex(active ? 0xffffff : 0x000000);
    this.lineMaterial.opacity = active ? 0.18 : 0.15;
  }

  dispose() {
    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines = [];
    this.lineMaterial.dispose();
    this.scene.remove(this.group);
  }
}

import * as THREE from 'three';

export class SpawnContainerOverlay {
  private readonly lines = new Map<string, THREE.LineLoop>();
  private readonly material = new THREE.LineBasicMaterial({
    color: 0x6f8a9c,
    transparent: true,
    opacity: 0.8,
  });
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  upsert(spawnerId: string, corners: THREE.Vector3[]) {
    const existing = this.lines.get(spawnerId);
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      this.lines.delete(spawnerId);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const loop = new THREE.LineLoop(geometry, this.material);
    loop.position.y = 0.05;
    this.scene.add(loop);
    this.lines.set(spawnerId, loop);
  }

  clear() {
    for (const line of this.lines.values()) {
      this.scene.remove(line);
      line.geometry.dispose();
    }
    this.lines.clear();
  }

  dispose() {
    this.clear();
    this.material.dispose();
  }
}

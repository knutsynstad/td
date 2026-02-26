import * as THREE from 'three';

export class WorldBorder {
  private readonly line: THREE.LineLoop;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, worldBounds: number) {
    this.scene = scene;
    const points = [
      new THREE.Vector3(-worldBounds, 0.06, -worldBounds),
      new THREE.Vector3(worldBounds, 0.06, -worldBounds),
      new THREE.Vector3(worldBounds, 0.06, worldBounds),
      new THREE.Vector3(-worldBounds, 0.06, worldBounds),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xd96464,
      transparent: true,
      opacity: 0.95,
    });
    this.line = new THREE.LineLoop(geometry, material);
    scene.add(this.line);
  }

  dispose() {
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

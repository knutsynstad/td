import * as THREE from 'three';
import type { CorridorFlowField } from '../../domains/world/pathfinding/corridorFlowField';

export class FlowFieldDebugOverlay {
  private reachableMesh: THREE.InstancedMesh | null = null;
  private goalMesh: THREE.InstancedMesh | null = null;
  private readonly tileDummy = new THREE.Object3D();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  upsert(field: CorridorFlowField) {
    this.clear();
    let reachableCount = 0;
    let goalCount = 0;
    for (let idx = 0; idx < field.distance.length; idx += 1) {
      const distance = field.distance[idx]!;
      if (distance < 0) continue;
      if (distance === 0) {
        goalCount += 1;
      } else {
        reachableCount += 1;
      }
    }
    if (reachableCount + goalCount === 0) return;

    const tileSize = field.resolution * 0.92;
    const tileGeometry = new THREE.PlaneGeometry(tileSize, tileSize);
    tileGeometry.rotateX(-Math.PI / 2);
    const reachableMaterial = new THREE.MeshBasicMaterial({
      color: 0x2baeff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const goalMaterial = new THREE.MeshBasicMaterial({
      color: 0xffef33,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.reachableMesh = new THREE.InstancedMesh(
      tileGeometry,
      reachableMaterial,
      Math.max(1, reachableCount)
    );
    this.goalMesh = new THREE.InstancedMesh(
      tileGeometry.clone(),
      goalMaterial,
      Math.max(1, goalCount)
    );
    this.reachableMesh.count = 0;
    this.goalMesh.count = 0;
    this.reachableMesh.frustumCulled = false;
    this.goalMesh.frustumCulled = false;

    const y = 0.06;
    let reachableIdx = 0;
    let goalIdx = 0;
    for (let idx = 0; idx < field.distance.length; idx += 1) {
      const distance = field.distance[idx]!;
      if (distance < 0) continue;
      const x = idx % field.width;
      const z = Math.floor(idx / field.width);
      const wx = field.minWX + x * field.resolution;
      const wz = field.minWZ + z * field.resolution;
      if (distance === 0) {
        this.tileDummy.position.set(wx, y + 0.01, wz);
        this.tileDummy.updateMatrix();
        this.goalMesh.setMatrixAt(goalIdx, this.tileDummy.matrix);
        goalIdx += 1;
      } else {
        this.tileDummy.position.set(wx, y, wz);
        this.tileDummy.updateMatrix();
        this.reachableMesh.setMatrixAt(reachableIdx, this.tileDummy.matrix);
        reachableIdx += 1;
      }
    }
    this.reachableMesh.count = reachableIdx;
    this.goalMesh.count = goalIdx;
    this.reachableMesh.instanceMatrix.needsUpdate = true;
    this.goalMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.reachableMesh);
    this.scene.add(this.goalMesh);
  }

  clear() {
    if (this.reachableMesh) {
      this.scene.remove(this.reachableMesh);
      this.reachableMesh.geometry.dispose();
      (this.reachableMesh.material as THREE.Material).dispose();
      this.reachableMesh = null;
    }
    if (this.goalMesh) {
      this.scene.remove(this.goalMesh);
      this.goalMesh.geometry.dispose();
      (this.goalMesh.material as THREE.Material).dispose();
      this.goalMesh = null;
    }
  }
}

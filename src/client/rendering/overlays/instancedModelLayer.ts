import * as THREE from 'three';

export type InstancedLayerOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  yOffset?: number;
};

type InstancedLayerEntry = {
  mesh: THREE.InstancedMesh;
  baseMatrix: THREE.Matrix4;
};

export class InstancedModelLayer {
  private readonly root = new THREE.Group();
  private readonly entries: InstancedLayerEntry[] = [];
  private readonly transformScratch = new THREE.Matrix4();
  private readonly instanceMatrixScratch = new THREE.Matrix4();
  private readonly facingQuaternionScratch = new THREE.Quaternion();
  private readonly facingDirectionScratch = new THREE.Vector3();
  private readonly capacity: number;
  private readonly castShadow: boolean;
  private readonly receiveShadow: boolean;
  private readonly yOffset: number;
  private facingYaw = 0;

  constructor(
    scene: THREE.Scene,
    capacity: number,
    options: InstancedLayerOptions = {}
  ) {
    this.capacity = capacity;
    this.castShadow = options.castShadow ?? false;
    this.receiveShadow = options.receiveShadow ?? true;
    this.yOffset = options.yOffset ?? 0;
    scene.add(this.root);
  }

  setTemplate(source: THREE.Object3D | null) {
    this.clearEntries();
    this.facingYaw = 0;
    if (!source) return;
    source.updateMatrixWorld(true);
    this.facingYaw = this.computeFacingYaw(source);
    source.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = Array.isArray(node.material)
        ? node.material.map((mat: THREE.Material) => mat.clone())
        : node.material.clone();
      const instanced = new THREE.InstancedMesh(
        node.geometry,
        material,
        this.capacity
      );
      instanced.count = 0;
      instanced.frustumCulled = false;
      instanced.castShadow = this.castShadow;
      instanced.receiveShadow = this.receiveShadow;
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(instanced);
      this.entries.push({
        mesh: instanced,
        baseMatrix: node.matrixWorld.clone(),
      });
    });
  }

  setPositions(positions: readonly THREE.Vector3[]) {
    const count = Math.min(positions.length, this.capacity);
    for (const entry of this.entries) {
      entry.mesh.count = count;
      for (let i = 0; i < count; i += 1) {
        const pos = positions[i]!;
        this.transformScratch.makeTranslation(
          pos.x,
          pos.y + this.yOffset,
          pos.z
        );
        this.instanceMatrixScratch.multiplyMatrices(
          this.transformScratch,
          entry.baseMatrix
        );
        entry.mesh.setMatrixAt(i, this.instanceMatrixScratch);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setTransforms(transforms: readonly THREE.Matrix4[]) {
    const count = Math.min(transforms.length, this.capacity);
    for (const entry of this.entries) {
      entry.mesh.count = count;
      for (let i = 0; i < count; i += 1) {
        this.transformScratch.copy(transforms[i]!);
        if (this.yOffset !== 0) {
          this.transformScratch.elements[13] += this.yOffset;
        }
        this.instanceMatrixScratch.multiplyMatrices(
          this.transformScratch,
          entry.baseMatrix
        );
        entry.mesh.setMatrixAt(i, this.instanceMatrixScratch);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getFacingYaw() {
    return this.facingYaw;
  }

  clear() {
    for (const entry of this.entries) {
      entry.mesh.count = 0;
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.clearEntries();
    this.root.removeFromParent();
  }

  private clearEntries() {
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      this.root.remove(entry.mesh);
      if (Array.isArray(entry.mesh.material)) {
        for (const material of entry.mesh.material) {
          material.dispose();
        }
      } else {
        entry.mesh.material.dispose();
      }
    }
  }

  private computeFacingYaw(source: THREE.Object3D) {
    const facing = source.getObjectByName('Facing');
    if (!facing) return 0;
    facing.getWorldQuaternion(this.facingQuaternionScratch);
    this.facingDirectionScratch
      .set(0, -1, 0)
      .applyQuaternion(this.facingQuaternionScratch);
    this.facingDirectionScratch.y = 0;
    if (this.facingDirectionScratch.lengthSq() < 1e-9) return 0;
    this.facingDirectionScratch.normalize();
    return Math.atan2(
      this.facingDirectionScratch.x,
      this.facingDirectionScratch.z
    );
  }
}

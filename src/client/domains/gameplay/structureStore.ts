import * as THREE from 'three';
import type {
  ClientStructureState,
  DestructibleCollider,
  StaticCollider,
  Tower,
} from './types/entities';

type RemoveTowerCallback = (tower: Tower) => void;
type ObstacleDeltaCallback = (
  added: StaticCollider[],
  removed?: StaticCollider[]
) => void;
type BeforeRemoveStructureCallback = (
  pos: THREE.Vector3,
  type: DestructibleCollider['type']
) => void;
type StructureMetadata = Pick<
  ClientStructureState,
  | 'playerBuilt'
  | 'createdAtMs'
  | 'lastDecayTickMs'
  | 'graceUntilMs'
  | 'cumulativeBuildCost'
>;

export class StructureStore {
  readonly structureStates = new Map<StaticCollider, ClientStructureState>();
  readonly structureMeshToCollider = new Map<
    THREE.Mesh,
    DestructibleCollider
  >();
  readonly wallMeshes: THREE.Mesh[] = [];
  private readonly scene: THREE.Scene;
  private readonly staticColliders: StaticCollider[];
  private readonly towers: Tower[];
  private readonly onRemoveTower: RemoveTowerCallback;
  private readonly onObstacleDelta: ObstacleDeltaCallback;
  private readonly onBeforeRemoveStructure?: BeforeRemoveStructureCallback;

  constructor(
    scene: THREE.Scene,
    staticColliders: StaticCollider[],
    towers: Tower[],
    onRemoveTower: RemoveTowerCallback,
    onObstacleDelta: ObstacleDeltaCallback,
    onBeforeRemoveStructure?: BeforeRemoveStructureCallback
  ) {
    this.scene = scene;
    this.staticColliders = staticColliders;
    this.towers = towers;
    this.onRemoveTower = onRemoveTower;
    this.onObstacleDelta = onObstacleDelta;
    this.onBeforeRemoveStructure = onBeforeRemoveStructure;
  }

  addWallCollider(
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    mesh: THREE.Mesh,
    hp: number,
    metadata?: StructureMetadata
  ): DestructibleCollider {
    const collider: DestructibleCollider = {
      center: center.clone(),
      halfSize: halfSize.clone(),
      type: 'wall',
    };
    this.staticColliders.push(collider);
    this.wallMeshes.push(mesh);
    this.structureStates.set(collider, { mesh, hp, maxHp: hp, ...metadata });
    this.structureMeshToCollider.set(mesh, collider);
    return collider;
  }

  addTowerCollider(
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    mesh: THREE.Mesh,
    tower: Tower,
    hp: number,
    metadata?: StructureMetadata
  ): DestructibleCollider {
    const collider: DestructibleCollider = {
      center: center.clone(),
      halfSize: halfSize.clone(),
      type: 'tower',
    };
    this.staticColliders.push(collider);
    this.structureStates.set(collider, {
      mesh,
      hp,
      maxHp: hp,
      tower,
      ...metadata,
    });
    this.structureMeshToCollider.set(mesh, collider);
    return collider;
  }

  addTreeCollider(
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    mesh: THREE.Mesh,
    hp: number,
    metadata?: StructureMetadata
  ): DestructibleCollider {
    const collider: DestructibleCollider = {
      center: center.clone(),
      halfSize: halfSize.clone(),
      type: 'tree',
    };
    this.staticColliders.push(collider);
    this.structureStates.set(collider, { mesh, hp, maxHp: hp, ...metadata });
    this.structureMeshToCollider.set(mesh, collider);
    return collider;
  }

  addRockCollider(
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    mesh: THREE.Mesh,
    hp: number,
    metadata?: StructureMetadata
  ): DestructibleCollider {
    const collider: DestructibleCollider = {
      center: center.clone(),
      halfSize: halfSize.clone(),
      type: 'rock',
    };
    this.staticColliders.push(collider);
    this.structureStates.set(collider, { mesh, hp, maxHp: hp, ...metadata });
    this.structureMeshToCollider.set(mesh, collider);
    return collider;
  }

  addCastleCoinsCollider(
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    mesh: THREE.Mesh,
    hp: number,
    metadata?: StructureMetadata
  ): DestructibleCollider {
    const collider: DestructibleCollider = {
      center: center.clone(),
      halfSize: halfSize.clone(),
      type: 'castleCoins',
    };
    this.staticColliders.push(collider);
    this.structureStates.set(collider, { mesh, hp, maxHp: hp, ...metadata });
    this.structureMeshToCollider.set(mesh, collider);
    return collider;
  }

  removeStructureCollider(collider: DestructibleCollider) {
    const state = this.structureStates.get(collider);
    if (!state) return;

    if (this.onBeforeRemoveStructure) {
      const poofTypes: DestructibleCollider['type'][] = [
        'tree',
        'rock',
        'wall',
        'tower',
      ];
      if (poofTypes.includes(collider.type)) {
        this.onBeforeRemoveStructure(
          state.mesh.position.clone(),
          collider.type
        );
      }
    }

    const disposeMesh = (mesh: THREE.Mesh) => {
      mesh.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        if (Array.isArray(node.material)) {
          for (const material of node.material) material.dispose();
        } else {
          node.material.dispose();
        }
      });
    };

    const linkedVisual = state.mesh.userData.linkedVisual as
      | THREE.Object3D
      | undefined;
    if (linkedVisual) {
      linkedVisual.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        if (Array.isArray(node.material)) {
          for (const material of node.material) material.dispose();
        } else {
          node.material.dispose();
        }
      });
      this.scene.remove(linkedVisual);
      delete state.mesh.userData.linkedVisual;
      delete state.mesh.userData.outlineTarget;
    }

    disposeMesh(state.mesh);
    this.scene.remove(state.mesh);
    this.structureMeshToCollider.delete(state.mesh);
    if (collider.type === 'wall') {
      const wallIdx = this.wallMeshes.indexOf(state.mesh);
      if (wallIdx >= 0) this.wallMeshes.splice(wallIdx, 1);
    }

    if (state.tower) {
      this.scene.remove(state.tower.rangeRing);
      state.tower.rangeRing.geometry.dispose();
      const towerIdx = this.towers.indexOf(state.tower);
      if (towerIdx >= 0) this.towers.splice(towerIdx, 1);
      this.onRemoveTower(state.tower);
    }

    this.structureStates.delete(collider);
    const colliderIdx = this.staticColliders.indexOf(collider);
    if (colliderIdx >= 0) this.staticColliders.splice(colliderIdx, 1);
    this.onObstacleDelta([], [collider]);
  }

  damageStructure(
    collider: DestructibleCollider,
    damage: number,
    onDestroyed?: (collider: DestructibleCollider) => void
  ): boolean {
    const state = this.structureStates.get(collider);
    if (!state) return false;
    state.hp -= damage;
    if (state.hp > 0) return false;
    onDestroyed?.(collider);
    this.removeStructureCollider(collider);
    return true;
  }

  getDestructibleColliders(): DestructibleCollider[] {
    return this.staticColliders.filter(
      (collider): collider is DestructibleCollider =>
        collider.type === 'wall' ||
        collider.type === 'tower' ||
        collider.type === 'tree' ||
        collider.type === 'rock' ||
        collider.type === 'castleCoins'
    );
  }
}

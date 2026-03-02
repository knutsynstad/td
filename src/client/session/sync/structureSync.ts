import * as THREE from 'three';
import type { StructureDelta } from '../../../shared/game-protocol';
import type { StructureState as SharedStructureState } from '../../../shared/game-state';
import type {
  DestructibleCollider,
  StaticCollider,
} from '../../domains/gameplay/types/entities';
import type { StructureStore } from '../../domains/gameplay/structureStore';
import type { Tower } from '../../domains/gameplay/types/entities';
import type { TowerTypeId } from '../../domains/gameplay/towers/towerTypes';
import type { Vector3 } from 'three';

type TreeFootprint = 1 | 2 | 3 | 4;

type RockPlacement = {
  x: number;
  z: number;
  footprintX: number;
  footprintZ: number;
  yawQuarterTurns: 0 | 1 | 2 | 3;
  modelIndex: 0 | 1;
  mirrorX: boolean;
  mirrorZ: boolean;
  verticalScale: number;
};

type StructureSyncContext = {
  selectedStructures: Set<StaticCollider>;
  serverStructureById: Map<string, DestructibleCollider>;
  structureStore: StructureStore;
  scene: THREE.Scene;
  createTowerAt: (
    center: Vector3,
    typeId: TowerTypeId,
    ownerId: string
  ) => Tower;
  applyWallVisualToMesh: (mesh: THREE.Mesh) => void;
  applyTreeVisualToMesh: (mesh: THREE.Mesh) => void;
  applyRockVisualToMesh: (mesh: THREE.Mesh) => void;
  getBuildSizeForMode: (mode: 'wall' | 'tower') => THREE.Vector3;
  snapCenterToBuildGrid: (center: Vector3, size: Vector3) => Vector3;
  getTreeBuildSizeForFootprint: (fp: TreeFootprint) => Vector3;
  clampTreeFootprint: (value: number) => TreeFootprint;
  HITBOX_LAYER: number;
  ROCK_BASE_HEIGHT: number;
  getWallModelTemplate: () => THREE.Object3D | null;
  getTreeModelTemplate: () => THREE.Object3D | null;
  refreshAllSpawnerPathlines: () => void;
};

export const createStructureSync = (ctx: StructureSyncContext) => {
  const removeServerStructure = (structureId: string): void => {
    const collider = ctx.serverStructureById.get(structureId);
    if (!collider) return;
    ctx.selectedStructures.delete(collider);
    ctx.structureStore.removeStructureCollider(collider);
    ctx.serverStructureById.delete(structureId);
  };

  const upsertServerStructure = (entry: SharedStructureState): void => {
    const existingCollider = ctx.serverStructureById.get(entry.structureId);
    const targetCenter = new THREE.Vector3(entry.center.x, 0, entry.center.z);
    if (existingCollider) {
      const state = ctx.structureStore.structureStates.get(existingCollider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
        state.mesh.position.set(
          targetCenter.x,
          state.mesh.position.y,
          targetCenter.z
        );
        existingCollider.center.set(
          targetCenter.x,
          existingCollider.center.y,
          targetCenter.z
        );
      }
      return;
    }

    const wallModelTemplate = ctx.getWallModelTemplate();
    ctx.getTreeModelTemplate();

    if (entry.type === 'wall') {
      const size = ctx.getBuildSizeForMode('wall');
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x8b8b8b })
      );
      mesh.position.copy(center);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
      if (wallModelTemplate) {
        ctx.applyWallVisualToMesh(mesh);
      }
      const collider = ctx.structureStore.addWallCollider(
        center,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: true,
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'tower') {
      const size = ctx.getBuildSizeForMode('tower');
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const tower = ctx.createTowerAt(
        center,
        'base',
        entry.ownerId || 'Server'
      );
      const collider = ctx.structureStore.addTowerCollider(
        center,
        half,
        tower.mesh,
        tower,
        entry.maxHp,
        {
          playerBuilt: entry.ownerId !== 'Map',
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'tree') {
      const treeFootprint = ctx.clampTreeFootprint(
        entry.metadata?.treeFootprint ?? 2
      ) as TreeFootprint;
      const size = ctx.getTreeBuildSizeForFootprint(treeFootprint);
      const half = size.clone().multiplyScalar(0.5);
      const center = ctx.snapCenterToBuildGrid(targetCenter, size);
      const hitboxMaterial = new THREE.MeshStandardMaterial({
        color: 0x4f8f46,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      (hitboxMaterial as { colorWrite?: boolean }).colorWrite = false;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        hitboxMaterial
      );
      mesh.position.copy(center);
      mesh.userData.treeFootprint = treeFootprint;
      mesh.layers.set(ctx.HITBOX_LAYER);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const treeModelTemplate = ctx.getTreeModelTemplate();
      if (treeModelTemplate) {
        ctx.applyTreeVisualToMesh(mesh);
      }
      ctx.scene.add(mesh);
      const collider = ctx.structureStore.addTreeCollider(
        center,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: entry.ownerId !== 'Map',
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }

    if (entry.type === 'rock') {
      const rockMeta = entry.metadata?.rock;
      const placement: RockPlacement = {
        x: targetCenter.x,
        z: targetCenter.z,
        footprintX: Math.max(1, rockMeta?.footprintX ?? 1),
        footprintZ: Math.max(1, rockMeta?.footprintZ ?? 1),
        yawQuarterTurns: (rockMeta?.yawQuarterTurns ?? 0) as 0 | 1 | 2 | 3,
        modelIndex: (rockMeta?.modelIndex ?? 0) as 0 | 1,
        mirrorX: rockMeta?.mirrorX ?? false,
        mirrorZ: rockMeta?.mirrorZ ?? false,
        verticalScale: rockMeta?.verticalScale ?? 1,
      };
      const size = new THREE.Vector3(
        Math.max(1, placement.footprintX),
        ctx.ROCK_BASE_HEIGHT,
        Math.max(1, placement.footprintZ)
      );
      const half = size.clone().multiplyScalar(0.5);
      const snapped = ctx.snapCenterToBuildGrid(targetCenter, size);
      const colliderCenter = snapped.clone().setY(half.y);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x646d79 })
      );
      mesh.position.copy(colliderCenter);
      mesh.userData.rockModelIndex = placement.modelIndex;
      mesh.userData.rockYawQuarterTurns = placement.yawQuarterTurns;
      mesh.userData.rockFootprintX = placement.footprintX;
      mesh.userData.rockFootprintZ = placement.footprintZ;
      mesh.userData.rockMirrorX = placement.mirrorX;
      mesh.userData.rockMirrorZ = placement.mirrorZ;
      mesh.userData.rockVerticalScale = placement.verticalScale;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.applyRockVisualToMesh(mesh);
      ctx.scene.add(mesh);
      const collider = ctx.structureStore.addRockCollider(
        colliderCenter,
        half,
        mesh,
        entry.maxHp,
        {
          playerBuilt: entry.ownerId !== 'Map',
          createdAtMs: entry.createdAtMs,
          lastDecayTickMs: entry.createdAtMs,
        }
      );
      const state = ctx.structureStore.structureStates.get(collider);
      if (state) {
        state.hp = entry.hp;
        state.maxHp = entry.maxHp;
      }
      ctx.serverStructureById.set(entry.structureId, collider);
      return;
    }
  };

  const applyServerStructureDelta = (
    delta: StructureDelta,
    _batchTickSeq?: number
  ): void => {
    for (const structureId of delta.removes) {
      removeServerStructure(structureId);
    }
    for (const structure of delta.upserts) {
      upsertServerStructure(structure);
    }
    if (delta.requiresPathRefresh) {
      ctx.refreshAllSpawnerPathlines();
    }
  };

  const applyServerStructureSync = (
    structures: Record<string, SharedStructureState>
  ): void => {
    const syncedIds = new Set(Object.keys(structures));
    for (const structureId of Array.from(ctx.serverStructureById.keys())) {
      if (!syncedIds.has(structureId)) {
        removeServerStructure(structureId);
      }
    }
    for (const structure of Object.values(structures)) {
      upsertServerStructure(structure);
    }
    ctx.refreshAllSpawnerPathlines();
  };

  return {
    removeServerStructure,
    upsertServerStructure,
    applyServerStructureDelta,
    applyServerStructureSync,
  };
};

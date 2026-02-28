import * as THREE from 'three';
import { createBallistaVisualRig } from './presenters/ballistaRig';
import type { BallistaVisualRig } from './presenters/ballistaRig';
import type { Tower } from '../domains/gameplay/types/entities';

export type TreeFootprint = 1 | 2 | 3 | 4;

export type VisualApplicationContext = {
  scene: THREE.Scene;
  hitboxLayer: number;
  towerBuildSize: THREE.Vector3;
  treeBuildSize: THREE.Vector3;
  getTowerModelTemplate: () => THREE.Object3D | null;
  getTreeModelTemplate: () => THREE.Object3D | null;
  getWallModelTemplate: () => THREE.Object3D | null;
  getRockTemplateForPlacement: (modelIndex: number) => {
    template: THREE.Object3D;
  } | null;
  towerBallistaRigs: Map<Tower, BallistaVisualRig>;
  clampTreeFootprint: (value: number) => TreeFootprint;
  getTreeScaleForFootprint: (footprint: TreeFootprint) => number;
  defaultTreeFootprint: TreeFootprint;
};

export type VisualAppliers = {
  applyTowerVisualToMesh: (mesh: THREE.Mesh, tower?: Tower) => void;
  applyTreeVisualToMesh: (mesh: THREE.Mesh) => void;
  applyRockVisualToMesh: (mesh: THREE.Mesh, forceRefresh?: boolean) => void;
  applyWallVisualToMesh: (mesh: THREE.Mesh) => void;
  setStructureVisualScale: (mesh: THREE.Mesh, scale: number) => void;
};

const hideHitbox = (mesh: THREE.Mesh) => {
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

export const createVisualAppliers = (
  ctx: VisualApplicationContext
): VisualAppliers => {
  const applyTowerVisualToMesh = (mesh: THREE.Mesh, tower?: Tower) => {
    const towerModelTemplate = ctx.getTowerModelTemplate();
    if (!towerModelTemplate) return;
    if (mesh.userData.outlineTarget) return;
    const rig = createBallistaVisualRig(towerModelTemplate);
    const towerVisual = rig?.root ?? towerModelTemplate.clone(true);
    towerVisual.position.copy(mesh.position);
    towerVisual.position.y -= ctx.towerBuildSize.y * 0.5;
    towerVisual.userData.isTowerVisual = true;
    ctx.scene.add(towerVisual);
    mesh.userData.outlineTarget = towerVisual;
    mesh.userData.linkedVisual = towerVisual;
    mesh.layers.set(ctx.hitboxLayer);
    if (tower && rig) {
      ctx.towerBallistaRigs.set(tower, rig);
    }
    hideHitbox(mesh);
  };

  const applyTreeVisualToMesh = (mesh: THREE.Mesh) => {
    const treeModelTemplate = ctx.getTreeModelTemplate();
    if (!treeModelTemplate) return;
    if (mesh.userData.outlineTarget) return;
    const footprint = ctx.clampTreeFootprint(
      Number(mesh.userData.treeFootprint ?? ctx.defaultTreeFootprint)
    );
    const footprintScale = ctx.getTreeScaleForFootprint(footprint);
    const treeVisual = treeModelTemplate.clone(true);
    treeVisual.position.copy(mesh.position);
    treeVisual.position.y -= ctx.treeBuildSize.y * 0.5 * footprintScale;
    treeVisual.scale.setScalar(footprintScale);
    treeVisual.userData.isTreeVisual = true;
    ctx.scene.add(treeVisual);
    mesh.userData.outlineTarget = treeVisual;
    mesh.userData.linkedVisual = treeVisual;
    mesh.layers.set(ctx.hitboxLayer);
    hideHitbox(mesh);
  };

  const applyRockVisualToMesh = (mesh: THREE.Mesh, forceRefresh = false) => {
    const modelIndex =
      (mesh.userData.rockModelIndex as number | undefined) ?? 0;
    const rockEntry = ctx.getRockTemplateForPlacement(modelIndex);
    if (!rockEntry) return;
    const template = rockEntry.template;
    if (mesh.userData.outlineTarget && !forceRefresh) return;
    if (forceRefresh) {
      const existingVisual = mesh.userData.linkedVisual as
        | THREE.Object3D
        | undefined;
      if (existingVisual) {
        existingVisual.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.geometry.dispose();
          if (Array.isArray(node.material)) {
            for (const material of node.material) material.dispose();
          } else {
            node.material.dispose();
          }
        });
        ctx.scene.remove(existingVisual);
      }
      delete mesh.userData.linkedVisual;
      delete mesh.userData.outlineTarget;
    }
    const yawQuarterTurns =
      (mesh.userData.rockYawQuarterTurns as number | undefined) ?? 0;
    const yaw = yawQuarterTurns * (Math.PI * 0.5);
    const footprintX = Math.max(1, Number(mesh.userData.rockFootprintX ?? 1));
    const footprintZ = Math.max(1, Number(mesh.userData.rockFootprintZ ?? 1));
    const quarterTurns = ((Math.round(yawQuarterTurns) % 4) + 4) % 4;
    const isQuarterTurn = quarterTurns % 2 === 1;
    const visualScaleX = isQuarterTurn ? footprintZ : footprintX;
    const visualScaleZ = isQuarterTurn ? footprintX : footprintZ;
    const verticalScale = Math.max(
      0.65,
      Number(mesh.userData.rockVerticalScale ?? 1)
    );
    const mirrorX = mesh.userData.rockMirrorX === true;
    const mirrorZ = mesh.userData.rockMirrorZ === true;
    const rockVisual = template.clone(true);
    rockVisual.position.copy(mesh.position);
    rockVisual.position.y = 0;
    rockVisual.scale.set(
      visualScaleX * (mirrorX ? -1 : 1),
      verticalScale,
      visualScaleZ * (mirrorZ ? -1 : 1)
    );
    rockVisual.rotation.y = yaw;
    rockVisual.userData.isRockVisual = true;
    ctx.scene.add(rockVisual);
    mesh.userData.outlineTarget = rockVisual;
    mesh.userData.linkedVisual = rockVisual;
    mesh.layers.set(ctx.hitboxLayer);
    hideHitbox(mesh);
  };

  const applyWallVisualToMesh = (mesh: THREE.Mesh) => {
    const wallModelTemplate = ctx.getWallModelTemplate();
    if (!wallModelTemplate) return;
    if (mesh.userData.outlineTarget) return;
    const wallVisual = wallModelTemplate.clone(true);
    wallVisual.position.copy(mesh.position);
    wallVisual.position.y -= 0.5;
    wallVisual.userData.isWallVisual = true;
    ctx.scene.add(wallVisual);
    mesh.userData.outlineTarget = wallVisual;
    mesh.userData.linkedVisual = wallVisual;
    mesh.layers.set(ctx.hitboxLayer);
    hideHitbox(mesh);
  };

  const setStructureVisualScale = (mesh: THREE.Mesh, scale: number) => {
    mesh.scale.setScalar(scale);
    const linkedVisual = mesh.userData.linkedVisual as
      | THREE.Object3D
      | undefined;
    if (linkedVisual) {
      linkedVisual.scale.setScalar(scale);
    }
  };

  return {
    applyTowerVisualToMesh,
    applyTreeVisualToMesh,
    applyRockVisualToMesh,
    applyWallVisualToMesh,
    setStructureVisualScale,
  };
};

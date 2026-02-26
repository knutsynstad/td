import * as THREE from 'three';
import { createBallistaVisualRig } from '../../../rendering/presenters/ballistaRig';
import type { BallistaVisualRig } from '../../../rendering/presenters/ballistaRig';
import { getTowerType } from './towerTypes';
import type { TowerTypeId, TowerUpgradeId } from './towerTypes';
import type { Tower } from '../types/entities';

export type TowerFactoryContext = {
  scene: THREE.Scene;
  towerBuildSize: THREE.Vector3;
  rangeMaterial: THREE.Material;
  hitboxLayer: number;
  towerModelTemplate: THREE.Object3D | null;
  ballistaRigs: Map<Tower, BallistaVisualRig>;
  towers: Tower[];
};

export const applyTowerVisualToMesh = (
  ctx: TowerFactoryContext,
  mesh: THREE.Mesh,
  tower?: Tower
) => {
  if (!ctx.towerModelTemplate) return;
  if (mesh.userData.outlineTarget) return;
  const rig = createBallistaVisualRig(ctx.towerModelTemplate);
  const towerVisual = rig?.root ?? ctx.towerModelTemplate.clone(true);
  towerVisual.position.copy(mesh.position);
  towerVisual.position.y -= ctx.towerBuildSize.y * 0.5;
  towerVisual.userData.isTowerVisual = true;
  ctx.scene.add(towerVisual);
  mesh.userData.outlineTarget = towerVisual;
  mesh.userData.linkedVisual = towerVisual;
  mesh.layers.set(ctx.hitboxLayer);
  if (tower && rig) {
    ctx.ballistaRigs.set(tower, rig);
  }
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

export const applyTowerUpgrade = (tower: Tower, upgradeId: TowerUpgradeId) => {
  if (upgradeId === 'range') {
    tower.rangeLevel += 1;
    tower.range += 1;
  } else if (upgradeId === 'damage') {
    tower.damageLevel += 1;
    tower.damage += 1;
  } else if (upgradeId === 'speed') {
    tower.speedLevel += 1;
    const shotsPerSecond = 4 + tower.speedLevel * 2;
    tower.shootCadence = 1 / shotsPerSecond;
  }
  tower.rangeRing.geometry.dispose();
  tower.rangeRing.geometry = new THREE.RingGeometry(
    tower.range - 0.12,
    tower.range,
    32
  );
};

export const createTowerAt = (
  ctx: TowerFactoryContext,
  snapped: THREE.Vector3,
  typeId: TowerTypeId,
  builtBy: string
): Tower => {
  const typeConfig = getTowerType(typeId);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      ctx.towerBuildSize.x,
      ctx.towerBuildSize.y,
      ctx.towerBuildSize.z
    ),
    new THREE.MeshStandardMaterial({
      color: typeConfig.color,
      transparent: true,
      opacity: ctx.towerModelTemplate ? 0.01 : 1,
    })
  );
  mesh.position.copy(snapped);
  if (!ctx.towerModelTemplate) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  ctx.scene.add(mesh);

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(typeConfig.range - 0.12, typeConfig.range, 32),
    ctx.rangeMaterial
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.set(snapped.x, 0.02, snapped.z);
  rangeRing.visible = false;
  ctx.scene.add(rangeRing);

  const tower: Tower = {
    mesh,
    range: typeConfig.range,
    damage: typeConfig.damage,
    rangeLevel: 0,
    damageLevel: 0,
    speedLevel: 0,
    killCount: 0,
    builtBy,
    shootCooldown: 0,
    shootCadence: typeConfig.shootCadence,
    rangeRing,
    typeId,
    level: typeConfig.level,
  };
  if (ctx.towerModelTemplate) {
    applyTowerVisualToMesh(ctx, mesh, tower);
  }
  ctx.towers.push(tower);
  return tower;
};

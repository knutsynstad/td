import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { InstancedModelLayer } from './overlays/instancedModelLayer';
import type { WorldGrid } from './overlays/worldGrid';
import type { WorldBorder } from './overlays/worldBorder';
import type { ArrowProjectile } from '../domains/gameplay/types/entities';
import type { PlayerArrowProjectile } from '../gameContext';
import type { CoinTrail } from '../ui/hudUpdaters';

export type DisposeSceneContext = {
  authoritativeBridgeRef: {
    current: { disconnect: () => Promise<void> } | null;
  };
  serverStructureResyncInFlightRef: { current: boolean };
  particleSystem: { dispose: () => void };
  spawnContainerOverlay: { dispose: () => void };
  stagingIslandsOverlay: {
    setTilesChangedListener: (f: (() => void) | null) => void;
    dispose: () => void;
  };
  spawnerRouteOverlay: { clear: () => void };
  pathCenterTileLayer: InstancedModelLayer;
  pathEdgeTileLayer: InstancedModelLayer;
  pathInnerCornerTileLayer: InstancedModelLayer;
  pathOuterCornerTileLayer: InstancedModelLayer;
  flowFieldDebugOverlay: { clear: () => void };
  worldGrid: WorldGrid;
  worldBorder: WorldBorder;
  shaftGeometry: THREE.BufferGeometry;
  shaftMaterial: THREE.Material;
  headGeometry: THREE.BufferGeometry;
  headMaterial: THREE.Material;
  scene: THREE.Scene;
  buildPreview: THREE.Mesh;
  mobInstanceMesh: THREE.InstancedMesh;
  mobHitFlashMesh: THREE.InstancedMesh;
  clearMobDeathVisuals: () => void;
  mobLogicGeometry: THREE.BufferGeometry;
  mobLogicMaterial: THREE.Material;
  activeArrowProjectiles: ArrowProjectile[];
  activePlayerArrowProjectiles: PlayerArrowProjectile[];
  playerShootRangeRing: THREE.Mesh;
  towerRangeMaterial: THREE.Material;
  ground: THREE.Mesh;
  groundMaterial: THREE.Material;
  waterMesh: THREE.Mesh;
  waterMaterial: THREE.Material;
  waterDistanceField: { texture: THREE.Texture };
  groundTileLayer: InstancedModelLayer;
  castle: THREE.Object3D;
  coinHudRoot: THREE.Group;
  coinHudRenderer: THREE.WebGLRenderer;
  activeCoinTrails: CoinTrail[];
  coinTrailScene: THREE.Scene;
  coinTrailRenderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderer: THREE.WebGLRenderer;
};

export const createDisposeScene = (
  ctx: DisposeSceneContext
): (() => void) => {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;

    if (ctx.authoritativeBridgeRef.current) {
      void ctx.authoritativeBridgeRef.current.disconnect();
      ctx.authoritativeBridgeRef.current = null;
    }
    ctx.serverStructureResyncInFlightRef.current = false;

    ctx.particleSystem.dispose();
    ctx.spawnContainerOverlay.dispose();
    ctx.stagingIslandsOverlay.setTilesChangedListener(null);
    ctx.stagingIslandsOverlay.dispose();
    ctx.spawnerRouteOverlay.clear();
    ctx.pathCenterTileLayer.dispose();
    ctx.pathEdgeTileLayer.dispose();
    ctx.pathInnerCornerTileLayer.dispose();
    ctx.pathOuterCornerTileLayer.dispose();
    ctx.flowFieldDebugOverlay.clear();
    ctx.worldGrid.dispose();
    ctx.worldBorder.dispose();

    ctx.shaftGeometry.dispose();
    ctx.shaftMaterial.dispose();
    ctx.headGeometry.dispose();
    ctx.headMaterial.dispose();

    ctx.scene.remove(ctx.buildPreview);
    ctx.buildPreview.geometry.dispose();
    (ctx.buildPreview.material as THREE.Material).dispose();

    ctx.scene.remove(ctx.mobInstanceMesh);
    ctx.scene.remove(ctx.mobHitFlashMesh);
    ctx.mobInstanceMesh.geometry.dispose();
    if (Array.isArray(ctx.mobInstanceMesh.material)) {
      for (const material of ctx.mobInstanceMesh.material) material.dispose();
    } else {
      ctx.mobInstanceMesh.material.dispose();
    }
    if (Array.isArray(ctx.mobHitFlashMesh.material)) {
      for (const material of ctx.mobHitFlashMesh.material) material.dispose();
    } else {
      ctx.mobHitFlashMesh.material.dispose();
    }
    ctx.clearMobDeathVisuals();
    ctx.mobLogicGeometry.dispose();
    ctx.mobLogicMaterial.dispose();
    for (const projectile of ctx.activeArrowProjectiles) {
      ctx.scene.remove(projectile.mesh);
    }
    ctx.activeArrowProjectiles.length = 0;
    for (const projectile of ctx.activePlayerArrowProjectiles) {
      ctx.scene.remove(projectile.mesh);
    }
    ctx.activePlayerArrowProjectiles.length = 0;
    ctx.scene.remove(ctx.playerShootRangeRing);
    ctx.playerShootRangeRing.geometry.dispose();
    ctx.towerRangeMaterial.dispose();

    ctx.scene.remove(ctx.ground);
    ctx.ground.geometry.dispose();
    ctx.groundMaterial.dispose();
    ctx.scene.remove(ctx.waterMesh);
    ctx.waterMesh.geometry.dispose();
    ctx.waterMaterial.dispose();
    ctx.waterDistanceField.texture.dispose();
    ctx.groundTileLayer.dispose();
    ctx.scene.remove(ctx.castle);
    ctx.castle.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      if (Array.isArray(node.material)) {
        for (const material of node.material) {
          material.dispose();
        }
        return;
      }
      node.material.dispose();
    });

    ctx.coinHudRoot.clear();
    ctx.coinHudRenderer.dispose();
    for (const trail of ctx.activeCoinTrails) {
      ctx.coinTrailScene.remove(trail.mesh);
      for (const material of trail.materials) {
        material.dispose();
      }
    }
    ctx.activeCoinTrails.length = 0;
    ctx.coinTrailRenderer.dispose();
    ctx.composer.dispose();
    ctx.renderer.dispose();
  };
};

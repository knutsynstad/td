import * as THREE from 'three';
import { clamp } from '../../domains/world/collision';
import { InstancedModelLayer } from './instancedModelLayer';
import {
  classifyPathTile,
  directionToYaw,
  edgeTileYawOffset,
  cornerTileYawOffset,
  snapYawToQuarterTurn,
  parseGridKey,
} from './pathTileClassification';

export type StagingIslandsConfig = {
  islandSize: number;
  islandHeight: number;
  platformY: number;
  bridgeWidth: number;
  bridgePathWidth: number;
  bridgeLength: number;
  worldBounds: number;
};

export class StagingIslandsOverlay {
  private readonly islands = new Map<
    string,
    {
      group: THREE.Group;
      gate: THREE.Mesh;
      gateClosedY: number;
      gateOpenY: number;
      gateProgress: number;
    }
  >();
  private readonly islandGroundPositionsBySpawner = new Map<
    string,
    THREE.Vector3[]
  >();
  private readonly bridgePathKeysBySpawner = new Map<string, Set<string>>();
  private readonly bridgePathCenterPositionsBySpawner = new Map<
    string,
    THREE.Vector3[]
  >();
  private readonly bridgePathEdgeTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly bridgePathInnerCornerTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly bridgePathOuterCornerTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly groundLayer: InstancedModelLayer;
  private readonly pathCenterLayer: InstancedModelLayer;
  private readonly pathEdgeLayer: InstancedModelLayer;
  private readonly pathInnerCornerLayer: InstancedModelLayer;
  private readonly pathOuterCornerLayer: InstancedModelLayer;
  private readonly gateClosedMaterial = new THREE.MeshStandardMaterial({
    color: 0xb64747,
    transparent: true,
    opacity: 0.95,
  });
  private readonly gateOpenMaterial = new THREE.MeshStandardMaterial({
    color: 0x4bb46a,
    transparent: true,
    opacity: 0.9,
  });
  private tilesChangedListener: (() => void) | null = null;
  private readonly scene: THREE.Scene;
  private readonly config: StagingIslandsConfig;

  constructor(scene: THREE.Scene, config: StagingIslandsConfig) {
    this.scene = scene;
    this.config = config;
    this.groundLayer = new InstancedModelLayer(scene, 2_500, {
      receiveShadow: true,
      castShadow: false,
    });
    this.pathCenterLayer = new InstancedModelLayer(scene, 1_500, {
      receiveShadow: true,
      castShadow: false,
      yOffset: 0.01,
    });
    this.pathEdgeLayer = new InstancedModelLayer(scene, 1_500, {
      receiveShadow: true,
      castShadow: false,
      yOffset: 0.01,
    });
    this.pathInnerCornerLayer = new InstancedModelLayer(scene, 600, {
      receiveShadow: true,
      castShadow: false,
      yOffset: 0.01,
    });
    this.pathOuterCornerLayer = new InstancedModelLayer(scene, 600, {
      receiveShadow: true,
      castShadow: false,
      yOffset: 0.01,
    });
  }

  setTilesChangedListener(listener: (() => void) | null) {
    this.tilesChangedListener = listener;
  }

  getLandTileKeys() {
    const keys = new Set<string>();
    for (const tiles of this.islandGroundPositionsBySpawner.values()) {
      for (const tile of tiles) {
        keys.add(`${tile.x},${tile.z}`);
      }
    }
    for (const bridgePathKeys of this.bridgePathKeysBySpawner.values()) {
      for (const key of bridgePathKeys) {
        keys.add(key);
      }
    }
    return keys;
  }

  setGroundTemplate(source: THREE.Object3D | null) {
    this.groundLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathTemplate(source: THREE.Object3D | null) {
    this.pathCenterLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathEdgeTemplate(source: THREE.Object3D | null) {
    this.pathEdgeLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathInnerCornerTemplate(source: THREE.Object3D | null) {
    this.pathInnerCornerLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathOuterCornerTemplate(source: THREE.Object3D | null) {
    this.pathOuterCornerLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  private rebuildTileLayers() {
    const groundTiles: THREE.Vector3[] = [];
    for (const tiles of this.islandGroundPositionsBySpawner.values()) {
      groundTiles.push(...tiles);
    }
    this.groundLayer.setPositions(groundTiles);

    const bridgePathCenterTiles: THREE.Vector3[] = [];
    for (const tiles of this.bridgePathCenterPositionsBySpawner.values()) {
      bridgePathCenterTiles.push(...tiles);
    }
    this.pathCenterLayer.setPositions(bridgePathCenterTiles);

    const bridgePathEdgeTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathEdgeTransformsBySpawner.values()) {
      bridgePathEdgeTransforms.push(...transforms);
    }
    this.pathEdgeLayer.setTransforms(bridgePathEdgeTransforms);

    const bridgePathInnerCornerTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathInnerCornerTransformsBySpawner.values()) {
      bridgePathInnerCornerTransforms.push(...transforms);
    }
    this.pathInnerCornerLayer.setTransforms(bridgePathInnerCornerTransforms);

    const bridgePathOuterCornerTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathOuterCornerTransformsBySpawner.values()) {
      bridgePathOuterCornerTransforms.push(...transforms);
    }
    this.pathOuterCornerLayer.setTransforms(bridgePathOuterCornerTransforms);
    this.tilesChangedListener?.();
  }

  hasBridgePathAt(x: number, z: number) {
    const key = `${x},${z}`;
    for (const keys of this.bridgePathKeysBySpawner.values()) {
      if (keys.has(key)) return true;
    }
    return false;
  }

  private buildIslandGroundTiles(center: THREE.Vector3) {
    const out: THREE.Vector3[] = [];
    const baseX = Math.round(center.x);
    const baseZ = Math.round(center.z);
    const minOffset = -Math.floor(this.config.islandSize * 0.5);
    for (let xStep = 0; xStep < this.config.islandSize; xStep += 1) {
      for (let zStep = 0; zStep < this.config.islandSize; zStep += 1) {
        out.push(
          new THREE.Vector3(
            baseX + minOffset + xStep,
            this.config.platformY,
            baseZ + minOffset + zStep
          )
        );
      }
    }
    return out;
  }

  private buildBridgeGroundTiles(
    center: THREE.Vector3,
    towardMap: THREE.Vector3,
    reservePathStrip = true
  ) {
    const out: THREE.Vector3[] = [];
    const unique = new Set<string>();
    const tangent = new THREE.Vector3(-towardMap.z, 0, towardMap.x);
    const islandHalf = this.config.islandSize * 0.5;
    const bridgeHalf = Math.max(
      0,
      Math.floor(this.config.bridgeWidth * 0.5)
    );
    const pathHalf = Math.max(
      0,
      Math.floor(this.config.bridgePathWidth * 0.5)
    );
    for (let along = 0; along < this.config.bridgeLength; along += 1) {
      const anchor = center
        .clone()
        .addScaledVector(towardMap, islandHalf + along);
      for (let lateral = 0; lateral < this.config.bridgeWidth; lateral += 1) {
        const lateralOffset = lateral - bridgeHalf;
        if (reservePathStrip && Math.abs(lateralOffset) <= pathHalf) continue;
        const tile = anchor.clone().addScaledVector(tangent, lateralOffset);
        const x = Math.round(tile.x);
        const z = Math.round(tile.z);
        if (
          Math.abs(x) <= this.config.worldBounds &&
          Math.abs(z) <= this.config.worldBounds
        )
          continue;
        const key = `${x},${z}`;
        if (unique.has(key)) continue;
        unique.add(key);
        out.push(new THREE.Vector3(x, this.config.platformY, z));
      }
    }
    return out;
  }

  private buildBridgePathTiles(
    center: THREE.Vector3,
    towardMap: THREE.Vector3
  ) {
    const centers: THREE.Vector3[] = [];
    const edgeTransforms: THREE.Matrix4[] = [];
    const innerCornerTransforms: THREE.Matrix4[] = [];
    const outerCornerTransforms: THREE.Matrix4[] = [];
    const unique = new Set<string>();
    const tangent = new THREE.Vector3(-towardMap.z, 0, towardMap.x);
    const islandHalf = this.config.islandSize * 0.5;
    const islandCenterRun = Math.floor(islandHalf);
    const pathHalf = Math.max(
      0,
      Math.floor(this.config.bridgePathWidth * 0.5)
    );
    const pathWidth = Math.max(1, this.config.bridgePathWidth);
    for (
      let along = -islandCenterRun;
      along < this.config.bridgeLength;
      along += 1
    ) {
      const anchor = center
        .clone()
        .addScaledVector(towardMap, islandHalf + along);
      for (let lateral = 0; lateral < pathWidth; lateral += 1) {
        const lateralOffset = lateral - pathHalf;
        const tile = anchor.clone().addScaledVector(tangent, lateralOffset);
        const x = Math.round(tile.x);
        const z = Math.round(tile.z);
        if (
          Math.abs(x) <= this.config.worldBounds &&
          Math.abs(z) <= this.config.worldBounds
        )
          continue;
        const key = `${x},${z}`;
        if (unique.has(key)) continue;
        unique.add(key);
      }
    }
    const seamTowardMapDx = Math.sign(towardMap.x);
    const seamTowardMapDz = Math.sign(towardMap.z);
    const hasPathAt = (x: number, z: number) => {
      const key = `${x},${z}`;
      if (unique.has(key)) return true;
      if (
        Math.abs(x) <= this.config.worldBounds &&
        Math.abs(z) <= this.config.worldBounds
      ) {
        const outsideNeighborX = x - seamTowardMapDx;
        const outsideNeighborZ = z - seamTowardMapDz;
        if (unique.has(`${outsideNeighborX},${outsideNeighborZ}`)) return true;
      }
      return false;
    };
    const transform = new THREE.Matrix4();
    for (const key of unique) {
      const { x, z } = parseGridKey(key);
      const classification = classifyPathTile(x, z, hasPathAt);
      const desiredYaw = directionToYaw(
        classification.directionDx,
        classification.directionDz
      );
      const targetFacing =
        classification.variant === 'edge'
          ? this.pathEdgeLayer.getFacingYaw()
          : classification.variant === 'inner-corner'
            ? this.pathInnerCornerLayer.getFacingYaw()
            : classification.variant === 'outer-corner'
              ? this.pathOuterCornerLayer.getFacingYaw()
              : 0;
      const yawOffset =
        classification.variant === 'edge'
          ? edgeTileYawOffset
          : classification.variant === 'inner-corner' ||
              classification.variant === 'outer-corner'
            ? cornerTileYawOffset
            : 0;
      const correctedYaw = desiredYaw - targetFacing + yawOffset;
      const finalYaw =
        classification.variant === 'center'
          ? correctedYaw
          : snapYawToQuarterTurn(correctedYaw);
      if (classification.variant === 'center') {
        centers.push(new THREE.Vector3(x, this.config.platformY, z));
      } else {
        transform.makeRotationY(finalYaw);
        transform.setPosition(x, this.config.platformY, z);
        if (classification.variant === 'edge')
          edgeTransforms.push(transform.clone());
        if (classification.variant === 'inner-corner')
          innerCornerTransforms.push(transform.clone());
        if (classification.variant === 'outer-corner')
          outerCornerTransforms.push(transform.clone());
      }
    }
    return {
      centers,
      edgeTransforms,
      innerCornerTransforms,
      outerCornerTransforms,
      keys: unique,
    };
  }

  upsert(
    spawnerId: string,
    center: THREE.Vector3,
    normal: THREE.Vector3,
    gateOpen: boolean,
    showPath = true
  ) {
    this.remove(spawnerId);
    const group = new THREE.Group();
    const towardMap = normal.clone().multiplyScalar(-1);
    const yaw = Math.atan2(towardMap.x, towardMap.z);
    const islandHalf = this.config.islandSize * 0.5;

    const bridgePath = showPath
      ? this.buildBridgePathTiles(center, towardMap)
      : {
          centers: [] as THREE.Vector3[],
          edgeTransforms: [] as THREE.Matrix4[],
          innerCornerTransforms: [] as THREE.Matrix4[],
          outerCornerTransforms: [] as THREE.Matrix4[],
          keys: new Set<string>(),
        };
    this.bridgePathKeysBySpawner.set(spawnerId, bridgePath.keys);
    const pathTileKeys = new Set<string>();
    for (const tile of bridgePath.centers) {
      pathTileKeys.add(`${tile.x},${tile.z}`);
    }
    for (const xform of bridgePath.edgeTransforms) {
      pathTileKeys.add(
        `${Math.round(xform.elements[12]!)},${Math.round(xform.elements[14]!)}`
      );
    }
    for (const xform of bridgePath.innerCornerTransforms) {
      pathTileKeys.add(
        `${Math.round(xform.elements[12]!)},${Math.round(xform.elements[14]!)}`
      );
    }
    for (const xform of bridgePath.outerCornerTransforms) {
      pathTileKeys.add(
        `${Math.round(xform.elements[12]!)},${Math.round(xform.elements[14]!)}`
      );
    }
    const groundTiles = [
      ...this.buildIslandGroundTiles(center),
      ...this.buildBridgeGroundTiles(center, towardMap, showPath),
    ].filter((tile) => !pathTileKeys.has(`${tile.x},${tile.z}`));
    this.islandGroundPositionsBySpawner.set(spawnerId, groundTiles);
    this.bridgePathCenterPositionsBySpawner.set(spawnerId, bridgePath.centers);
    this.bridgePathEdgeTransformsBySpawner.set(
      spawnerId,
      bridgePath.edgeTransforms
    );
    this.bridgePathInnerCornerTransformsBySpawner.set(
      spawnerId,
      bridgePath.innerCornerTransforms
    );
    this.bridgePathOuterCornerTransformsBySpawner.set(
      spawnerId,
      bridgePath.outerCornerTransforms
    );
    this.rebuildTileLayers();

    const gatePos = center
      .clone()
      .addScaledVector(towardMap, islandHalf - 0.35);
    const gateClosedY = this.config.islandHeight * 0.5 + 0.22;
    const gateOpenY = gateClosedY - (this.config.islandHeight + 0.55);
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(
        this.config.bridgeWidth + 0.3,
        this.config.islandHeight + 0.45,
        0.25
      ),
      gateOpen ? this.gateOpenMaterial : this.gateClosedMaterial
    );
    gate.position.copy(gatePos).setY(gateOpen ? gateOpenY : gateClosedY);
    gate.rotation.y = yaw;
    group.add(gate);

    this.scene.add(group);
    this.islands.set(spawnerId, {
      group,
      gate,
      gateClosedY,
      gateOpenY,
      gateProgress: gateOpen ? 1 : 0,
    });
  }

  setGateProgress(spawnerId: string, progress: number) {
    const entry = this.islands.get(spawnerId);
    if (!entry) return;
    const clamped = clamp(progress, 0, 1);
    entry.gateProgress = clamped;
    entry.gate.position.y = THREE.MathUtils.lerp(
      entry.gateClosedY,
      entry.gateOpenY,
      clamped
    );
    entry.gate.material =
      clamped >= 1 ? this.gateOpenMaterial : this.gateClosedMaterial;
  }

  remove(spawnerId: string) {
    const existing = this.islands.get(spawnerId);
    if (!existing) return;
    this.scene.remove(existing.group);
    for (const child of existing.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    this.islands.delete(spawnerId);
    this.islandGroundPositionsBySpawner.delete(spawnerId);
    this.bridgePathKeysBySpawner.delete(spawnerId);
    this.bridgePathCenterPositionsBySpawner.delete(spawnerId);
    this.bridgePathEdgeTransformsBySpawner.delete(spawnerId);
    this.bridgePathInnerCornerTransformsBySpawner.delete(spawnerId);
    this.bridgePathOuterCornerTransformsBySpawner.delete(spawnerId);
    this.rebuildTileLayers();
  }

  clear() {
    for (const spawnerId of this.islands.keys()) {
      this.remove(spawnerId);
    }
  }

  dispose() {
    this.clear();
    this.groundLayer.dispose();
    this.pathCenterLayer.dispose();
    this.pathEdgeLayer.dispose();
    this.pathInnerCornerLayer.dispose();
    this.pathOuterCornerLayer.dispose();
    this.gateClosedMaterial.dispose();
    this.gateOpenMaterial.dispose();
  }
}

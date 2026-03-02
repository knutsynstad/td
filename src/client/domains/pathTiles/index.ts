import * as THREE from 'three';
import {
  classifyPathTile,
  directionToYaw,
  edgeTileYawOffset,
  cornerTileYawOffset,
  snapYawToQuarterTurn,
  parseGridKey,
} from '../../rendering/overlays/pathTileClassification';
import type { PathTilePoint } from '../../../shared/world/pathTiles';
import { buildPathTilesFromPoints as buildPathTilesFromNavPoints } from '../../../shared/world/pathTiles';
import type { StaticCollider } from '../gameplay/types/entities';
import type { InstancedModelLayer } from '../../rendering/overlays/instancedModelLayer';
import type { StagingIslandsOverlay } from '../../rendering/overlays/stagingIslands';
import type { GroundBounds } from '../world/coords';
import { deltaProfiler } from '../../utils/deltaProfiler';

export const buildPathTilesFromPoints = (
  points: readonly THREE.Vector3[],
  colliders: readonly StaticCollider[],
  worldBounds: number,
  halfWidth: number
) => {
  const navResult = buildPathTilesFromNavPoints(
    points.map((point) => ({ x: point.x, z: point.z })),
    colliders.map((collider) => ({
      center: { x: collider.center.x, z: collider.center.z },
      halfSize: { x: collider.halfSize.x, z: collider.halfSize.z },
      type: collider.type,
    })),
    worldBounds,
    halfWidth
  );
  return {
    tiles: navResult.tiles.map(
      (tile: PathTilePoint) => new THREE.Vector3(tile.x, 0, tile.z)
    ),
    isComplete: navResult.isComplete,
    firstRejectedCell: navResult.firstRejectedCell,
    firstRejectedReason: navResult.firstRejectedReason,
  };
};

export type PathTileRebuildContext = {
  pathTilePositions: Map<string, THREE.Vector3[]>;
  pathTileKeys: Set<string>;
  pathCenterTileLayer: InstancedModelLayer;
  pathEdgeTileLayer: InstancedModelLayer;
  pathInnerCornerTileLayer: InstancedModelLayer;
  pathOuterCornerTileLayer: InstancedModelLayer;
  stagingIslandsOverlay: StagingIslandsOverlay;
  castleCollider: StaticCollider;
  updateGroundFromBounds: (bounds: GroundBounds) => void;
  lastGroundBoundsRef: { current: GroundBounds | null };
};

export const createRebuildPathTileLayer = (
  ctx: PathTileRebuildContext
): (() => void) => {
  let lastRebuildPathFingerprint: string | null = null;
  const tmpPathCenterTransforms: THREE.Matrix4[] = [];
  const tmpPathEdgeTransforms: THREE.Matrix4[] = [];
  const tmpPathInnerCornerTransforms: THREE.Matrix4[] = [];
  const tmpPathOuterCornerTransforms: THREE.Matrix4[] = [];
  const tmpPathTransformScratch = new THREE.Matrix4();

  return () => {
    const fingerprint = Array.from(ctx.pathTilePositions.entries())
      .map(
        ([id, pts]) =>
          `${id}:${pts
            .map((p) => `${p.x},${p.z}`)
            .sort()
            .join('|')}`
      )
      .sort()
      .join(';');
    if (fingerprint === lastRebuildPathFingerprint) return;
    lastRebuildPathFingerprint = fingerprint;

    deltaProfiler.mark('path-tile-rebuild-start');
    tmpPathCenterTransforms.length = 0;
    tmpPathEdgeTransforms.length = 0;
    tmpPathInnerCornerTransforms.length = 0;
    tmpPathOuterCornerTransforms.length = 0;
    ctx.pathTileKeys.clear();
    const uniqueKeys = new Set<string>();
    for (const points of ctx.pathTilePositions.values()) {
      for (const point of points) {
        const key = `${point.x},${point.z}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);
        ctx.pathTileKeys.add(key);
      }
    }
    const hasPathAt = (x: number, z: number) =>
      ctx.pathTileKeys.has(`${x},${z}`) ||
      ctx.stagingIslandsOverlay.hasBridgePathAt(x, z);
    for (const key of ctx.pathTileKeys) {
      const { x, z } = parseGridKey(key);
      const classification = classifyPathTile(x, z, hasPathAt);
      const targetLayer =
        classification.variant === 'edge'
          ? ctx.pathEdgeTileLayer
          : classification.variant === 'inner-corner'
            ? ctx.pathInnerCornerTileLayer
            : classification.variant === 'outer-corner'
              ? ctx.pathOuterCornerTileLayer
              : ctx.pathCenterTileLayer;
      const targetTransforms =
        classification.variant === 'edge'
          ? tmpPathEdgeTransforms
          : classification.variant === 'inner-corner'
            ? tmpPathInnerCornerTransforms
            : classification.variant === 'outer-corner'
              ? tmpPathOuterCornerTransforms
              : tmpPathCenterTransforms;
      const desiredYaw = directionToYaw(
        classification.directionDx,
        classification.directionDz
      );
      const variantYawOffset =
        classification.variant === 'edge'
          ? edgeTileYawOffset
          : classification.variant === 'inner-corner' ||
              classification.variant === 'outer-corner'
            ? cornerTileYawOffset
            : 0;
      const correctedYaw =
        desiredYaw - targetLayer.getFacingYaw() + variantYawOffset;
      const finalYaw =
        classification.variant === 'center'
          ? correctedYaw
          : snapYawToQuarterTurn(correctedYaw);
      tmpPathTransformScratch.makeRotationY(finalYaw);
      tmpPathTransformScratch.setPosition(x, 0, z);
      targetTransforms.push(tmpPathTransformScratch.clone());
    }
    ctx.pathCenterTileLayer.setTransforms(tmpPathCenterTransforms);
    ctx.pathEdgeTileLayer.setTransforms(tmpPathEdgeTransforms);
    ctx.pathInnerCornerTileLayer.setTransforms(tmpPathInnerCornerTransforms);
    ctx.pathOuterCornerTileLayer.setTransforms(tmpPathOuterCornerTransforms);
    if (ctx.lastGroundBoundsRef.current) {
      const bounds = ctx.lastGroundBoundsRef.current;
      ctx.lastGroundBoundsRef.current = null;
      ctx.updateGroundFromBounds(bounds);
    }
    deltaProfiler.mark('path-tile-rebuild-end');
    deltaProfiler.measure(
      'path-tile-rebuild',
      'path-tile-rebuild-start',
      'path-tile-rebuild-end'
    );
  };
};

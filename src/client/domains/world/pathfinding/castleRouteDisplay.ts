import * as THREE from 'three';
import { simplifyCollinear } from './pathSimplification';

type CastleRouteDisplayOptions = {
  castleCenter: THREE.Vector3;
  castleHalfSize: { x: number; z: number };
  gridSize: number;
  castleFrontDirection: THREE.Vector2;
};

const snapToGrid = (value: number, gridSize: number) =>
  Math.round(value / gridSize) * gridSize;

const isPointInsideCastle = (
  point: THREE.Vector3,
  center: THREE.Vector3,
  halfSize: { x: number; z: number }
) =>
  Math.abs(point.x - center.x) <= halfSize.x &&
  Math.abs(point.z - center.z) <= halfSize.z;

const getCastleBoundaryIntersection = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  center: THREE.Vector3,
  halfSize: { x: number; z: number }
) => {
  const minX = center.x - halfSize.x;
  const maxX = center.x + halfSize.x;
  const minZ = center.z - halfSize.z;
  const maxZ = center.z + halfSize.z;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const eps = 1e-6;
  const candidates: number[] = [];

  if (Math.abs(dx) > eps) {
    candidates.push((minX - from.x) / dx, (maxX - from.x) / dx);
  }
  if (Math.abs(dz) > eps) {
    candidates.push((minZ - from.z) / dz, (maxZ - from.z) / dz);
  }

  let bestT = Number.POSITIVE_INFINITY;
  for (const t of candidates) {
    if (t < 0 || t > 1) continue;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const onFaceX = x >= minX - eps && x <= maxX + eps;
    const onFaceZ = z >= minZ - eps && z <= maxZ + eps;
    if (!onFaceX || !onFaceZ) continue;
    if (t < bestT) bestT = t;
  }

  if (!Number.isFinite(bestT)) return to.clone();
  return new THREE.Vector3(from.x + dx * bestT, to.y, from.z + dz * bestT);
};

const trimPathToCastleBoundary = (
  points: readonly THREE.Vector3[],
  center: THREE.Vector3,
  halfSize: { x: number; z: number },
  gridSize: number
) => {
  if (points.length < 2) return points.map((point) => point.clone());

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (!isPointInsideCastle(prev, center, halfSize) && isPointInsideCastle(curr, center, halfSize)) {
      const clipped = points.slice(0, i).map((point) => point.clone());
      const boundaryRaw = getCastleBoundaryIntersection(prev, curr, center, halfSize);
      const boundary = new THREE.Vector3(
        snapToGrid(boundaryRaw.x, gridSize),
        boundaryRaw.y,
        snapToGrid(boundaryRaw.z, gridSize)
      );
      const lastClipped = clipped[clipped.length - 1];
      if (!lastClipped || lastClipped.distanceToSquared(boundary) > 1e-6) {
        clipped.push(boundary);
      }
      return clipped;
    }
  }

  return points.map((point) => point.clone());
};

const extendPathToCastleCenter = (
  points: readonly THREE.Vector3[],
  center: THREE.Vector3,
  gridSize: number,
  castleFrontDirection: THREE.Vector2
) => {
  const extended = points.map((point) => point.clone());
  if (extended.length === 0) return extended;
  const snappedCenter = new THREE.Vector3(
    snapToGrid(center.x, gridSize),
    0,
    snapToGrid(center.z, gridSize)
  );
  const last = extended[extended.length - 1]!;
  const dx = snappedCenter.x - last.x;
  const dz = snappedCenter.z - last.z;
  if (Math.abs(dx) <= 1e-6 && Math.abs(dz) <= 1e-6) return extended;

  // Keep the extension cardinal so path tile stamping never drops it as a diagonal.
  if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) {
    extended.push(new THREE.Vector3(snappedCenter.x, 0, last.z));
  }
  extended.push(snappedCenter);

  const frontAxisUsesX =
    Math.abs(castleFrontDirection.x) >= Math.abs(castleFrontDirection.y);
  const smoothed = extended.map((point) => point.clone());
  if (smoothed.length >= 4) {
    const a = smoothed[smoothed.length - 4]!;
    const b = smoothed[smoothed.length - 3]!;
    const c = smoothed[smoothed.length - 2]!;
    const d = smoothed[smoothed.length - 1]!;
    const nearCastle = [a, b, c, d].some(
      (point) =>
        Math.abs(point.x - snappedCenter.x) <= 12 &&
        Math.abs(point.z - snappedCenter.z) <= 12
    );
    if (nearCastle) {
      if (!frontAxisUsesX) {
        const onCenterAtC = Math.abs(c.x - snappedCenter.x) <= 1e-6;
        const onCenterAtD = Math.abs(d.x - snappedCenter.x) <= 1e-6;
        const oneCellLateralAtB =
          Math.abs(b.x - snappedCenter.x) <= gridSize + 1e-6;
        const bToCLateralOne =
          Math.abs(b.x - c.x) <= gridSize + 1e-6 &&
          Math.abs(b.z - c.z) <= 1e-6;
        const aToBFrontRun =
          Math.abs(a.x - b.x) <= 1e-6 &&
          Math.abs(a.z - b.z) >= 2 * gridSize - 1e-6;
        if (
          onCenterAtC &&
          onCenterAtD &&
          oneCellLateralAtB &&
          bToCLateralOne &&
          aToBFrontRun
        ) {
          b.x = snappedCenter.x;
          b.z = a.z;
        }
      } else {
        const onCenterAtC = Math.abs(c.z - snappedCenter.z) <= 1e-6;
        const onCenterAtD = Math.abs(d.z - snappedCenter.z) <= 1e-6;
        const oneCellLateralAtB =
          Math.abs(b.z - snappedCenter.z) <= gridSize + 1e-6;
        const bToCLateralOne =
          Math.abs(b.z - c.z) <= gridSize + 1e-6 &&
          Math.abs(b.x - c.x) <= 1e-6;
        const aToBFrontRun =
          Math.abs(a.z - b.z) <= 1e-6 &&
          Math.abs(a.x - b.x) >= 2 * gridSize - 1e-6;
        if (
          onCenterAtC &&
          onCenterAtD &&
          oneCellLateralAtB &&
          bToCLateralOne &&
          aToBFrontRun
        ) {
          b.z = snappedCenter.z;
          b.x = a.x;
        }
      }
    }
  }
  return simplifyCollinear(smoothed);
};

export const toCastleDisplayRoute = (
  points: readonly THREE.Vector3[],
  options: CastleRouteDisplayOptions
): THREE.Vector3[] => {
  const trimmed = trimPathToCastleBoundary(
    points,
    options.castleCenter,
    options.castleHalfSize,
    options.gridSize
  );
  return extendPathToCastleCenter(
    trimmed,
    options.castleCenter,
    options.gridSize,
    options.castleFrontDirection
  );
};

import * as THREE from 'three';
import type { GroundBounds } from '../domains/world/coords';
import { parseGridKey } from './overlays/pathTileClassification';

export const getVisibleGroundBounds = (
  camera: THREE.OrthographicCamera,
  gridSize: number
): GroundBounds => {
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const corners = [
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(1, 1, -1),
    new THREE.Vector3(-1, 1, -1),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const nearPoint = corner.clone().unproject(camera);
    const farPoint = corner.clone().setZ(1).unproject(camera);
    const direction = farPoint.sub(nearPoint).normalize();
    const ray = new THREE.Ray(nearPoint, direction);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(groundPlane, hit)) {
      minX = Math.min(minX, hit.x);
      maxX = Math.max(maxX, hit.x);
      minZ = Math.min(minZ, hit.z);
      maxZ = Math.max(maxZ, hit.z);
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxZ)
  ) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  }

  const padding = gridSize * 2;
  minX -= padding;
  maxX += padding;
  minZ -= padding;
  maxZ += padding;

  minX = Math.floor(minX / gridSize) * gridSize;
  maxX = Math.ceil(maxX / gridSize) * gridSize;
  minZ = Math.floor(minZ / gridSize) * gridSize;
  maxZ = Math.ceil(maxZ / gridSize) * gridSize;

  return { minX, maxX, minZ, maxZ };
};

export type WaterDistanceField = {
  texture: THREE.DataTexture;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
};

export const buildCoastlineLandKeys = (
  worldBounds: number,
  gridSize: number,
  stagingLandKeys: Set<string>
) => {
  const landKeys = new Set<string>();
  for (let x = -worldBounds; x <= worldBounds; x += gridSize) {
    for (let z = -worldBounds; z <= worldBounds; z += gridSize) {
      landKeys.add(`${x},${z}`);
    }
  }
  for (const key of stagingLandKeys) {
    landKeys.add(key);
  }
  return landKeys;
};

export const buildWaterDistanceField = (
  landTileKeys: Set<string>,
  waterOuterEdge: number,
  gridSize: number
): WaterDistanceField => {
  let minX = -waterOuterEdge;
  let maxX = waterOuterEdge;
  let minZ = -waterOuterEdge;
  let maxZ = waterOuterEdge;
  for (const key of landTileKeys) {
    const { x, z } = parseGridKey(key);
    minX = Math.min(minX, x - gridSize * 3);
    maxX = Math.max(maxX, x + gridSize * 3);
    minZ = Math.min(minZ, z - gridSize * 3);
    maxZ = Math.max(maxZ, z + gridSize * 3);
  }
  const sizeX = Math.max(gridSize * 2, maxX - minX);
  const sizeZ = Math.max(gridSize * 2, maxZ - minZ);
  const cellsX = Math.max(2, Math.floor(sizeX / gridSize) + 1);
  const cellsZ = Math.max(2, Math.floor(sizeZ / gridSize) + 1);
  const maxDistCells = 34;
  const dist = new Int16Array(cellsX * cellsZ);
  dist.fill(-1);
  const landMask = new Uint8Array(cellsX * cellsZ);
  const queue = new Int32Array(cellsX * cellsZ);
  let head = 0;
  let tail = 0;
  const indexOf = (tx: number, tz: number) => tz * cellsX + tx;
  const toCellX = (x: number) =>
    Math.max(0, Math.min(cellsX - 1, Math.round((x - minX) / gridSize)));
  const toCellZ = (z: number) =>
    Math.max(0, Math.min(cellsZ - 1, Math.round((z - minZ) / gridSize)));

  for (const key of landTileKeys) {
    const { x, z } = parseGridKey(key);
    const idx = indexOf(toCellX(x), toCellZ(z));
    if (landMask[idx] === 1) continue;
    landMask[idx] = 1;
  }

  for (let tz = 0; tz < cellsZ; tz += 1) {
    for (let tx = 0; tx < cellsX; tx += 1) {
      const idx = indexOf(tx, tz);
      if (landMask[idx] === 1) continue;
      let touchesLand = false;
      if (tx > 0 && landMask[idx - 1] === 1) touchesLand = true;
      if (tx + 1 < cellsX && landMask[idx + 1] === 1) touchesLand = true;
      if (tz > 0 && landMask[idx - cellsX] === 1) touchesLand = true;
      if (tz + 1 < cellsZ && landMask[idx + cellsX] === 1) touchesLand = true;
      if (!touchesLand) continue;
      dist[idx] = 0;
      queue[tail] = idx;
      tail += 1;
    }
  }

  while (head < tail) {
    const idx = queue[head]!;
    head += 1;
    const baseDist = dist[idx]!;
    if (baseDist >= maxDistCells) continue;
    const tx = idx % cellsX;
    const tz = (idx - tx) / cellsX;
    const nextDist = baseDist + 1;
    if (tx > 0) {
      const ni = idx - 1;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tx + 1 < cellsX) {
      const ni = idx + 1;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tz > 0) {
      const ni = idx - cellsX;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tz + 1 < cellsZ) {
      const ni = idx + cellsX;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
  }

  const data = new Uint8Array(cellsX * cellsZ * 4);
  for (let i = 0; i < dist.length; i += 1) {
    if (landMask[i] === 1) {
      const diLand = i * 4;
      data[diLand] = 0;
      data[diLand + 1] = 0;
      data[diLand + 2] = 0;
      data[diLand + 3] = 0;
      continue;
    }
    const raw = dist[i]!;
    const clamped = raw < 0 ? maxDistCells : Math.min(raw, maxDistCells);
    const normalized = clamped / maxDistCells;
    const byte = Math.round(normalized * 255);
    const di = i * 4;
    data[di] = byte;
    data[di + 1] = byte;
    data[di + 2] = byte;
    data[di + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, cellsX, cellsZ, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, minX, minZ, sizeX, sizeZ };
};

export const buildWaterSurfaceGeometry = (
  landTileKeys: Set<string>,
  field: WaterDistanceField,
  gridSize: number
) => {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const minX = field.minX;
  const maxX = field.minX + field.sizeX;
  const minZ = field.minZ;
  const maxZ = field.minZ + field.sizeZ;
  const startX = Math.ceil(minX / gridSize) * gridSize;
  const endX = Math.floor(maxX / gridSize) * gridSize;
  const startZ = Math.ceil(minZ / gridSize) * gridSize;
  const endZ = Math.floor(maxZ / gridSize) * gridSize;
  for (let x = startX; x <= endX; x += gridSize) {
    for (let z = startZ; z <= endZ; z += gridSize) {
      if (landTileKeys.has(`${x},${z}`)) continue;
      const x0 = x - gridSize * 0.5;
      const x1 = x + gridSize * 0.5;
      const z0 = z - gridSize * 0.5;
      const z1 = z + gridSize * 0.5;
      positions.push(
        x0,
        0,
        z0,
        x1,
        0,
        z1,
        x1,
        0,
        z0,
        x0,
        0,
        z0,
        x0,
        0,
        z1,
        x1,
        0,
        z1
      );
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

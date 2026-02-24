import * as THREE from 'three';

export type GroundBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const ndcFromClient = (clientX: number, clientY: number, rect: DOMRect) => {
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  return new THREE.Vector2(x, y);
};

const intersectGroundFromNdc = (
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  groundPlane: THREE.Plane
): THREE.Vector3 | null => {
  const nearPoint = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(camera);
  const farPoint = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(camera);
  const direction = farPoint.sub(nearPoint).normalize();
  const ray = new THREE.Ray(nearPoint, direction);
  const hit = new THREE.Vector3();
  return ray.intersectPlane(groundPlane, hit) ? hit : null;
};

export const screenToWorldOnGround = (
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  groundPlane: THREE.Plane
): THREE.Vector3 | null => {
  const ndc = ndcFromClient(clientX, clientY, rect);
  return intersectGroundFromNdc(ndc, camera, groundPlane);
};

export const screenRectToWorldBounds = (
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  groundPlane: THREE.Plane
): GroundBounds | null => {
  const minClientX = Math.min(startClientX, endClientX);
  const maxClientX = Math.max(startClientX, endClientX);
  const minClientY = Math.min(startClientY, endClientY);
  const maxClientY = Math.max(startClientY, endClientY);

  const corners = [
    screenToWorldOnGround(minClientX, minClientY, rect, camera, groundPlane),
    screenToWorldOnGround(maxClientX, minClientY, rect, camera, groundPlane),
    screenToWorldOnGround(maxClientX, maxClientY, rect, camera, groundPlane),
    screenToWorldOnGround(minClientX, maxClientY, rect, camera, groundPlane),
  ];

  const valid = corners.filter(
    (corner): corner is THREE.Vector3 => corner !== null
  );
  if (valid.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const corner of valid) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minZ = Math.min(minZ, corner.z);
    maxZ = Math.max(maxZ, corner.z);
  }
  return { minX, maxX, minZ, maxZ };
};

import * as THREE from 'three';
import type { Entity, StaticCollider } from '../gameplay/types/entities';
import { clamp } from '../../../shared/utils';

export { clamp };

export const aabbOverlap = (
  aCenter: THREE.Vector3,
  aHalf: THREE.Vector3,
  bCenter: THREE.Vector3,
  bHalf: THREE.Vector3,
  allowTouching = false
) => {
  const dx = Math.abs(aCenter.x - bCenter.x);
  const dz = Math.abs(aCenter.z - bCenter.z);
  const overlapX = allowTouching
    ? dx < aHalf.x + bHalf.x
    : dx <= aHalf.x + bHalf.x;
  const overlapZ = allowTouching
    ? dz < aHalf.z + bHalf.z
    : dz <= aHalf.z + bHalf.z;
  return overlapX && overlapZ;
};

export const resolveCircleAabb = (
  pos: THREE.Vector3,
  radius: number,
  collider: StaticCollider
) => {
  const minX = collider.center.x - collider.halfSize.x;
  const maxX = collider.center.x + collider.halfSize.x;
  const minZ = collider.center.z - collider.halfSize.z;
  const maxZ = collider.center.z + collider.halfSize.z;
  const closestX = clamp(pos.x, minX, maxX);
  const closestZ = clamp(pos.z, minZ, maxZ);
  const dx = pos.x - closestX;
  const dz = pos.z - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq < radius * radius) {
    const dist = Math.sqrt(distSq);
    if (dist > 0.0001) {
      const push = radius - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    } else {
      const left = Math.abs(pos.x - minX);
      const right = Math.abs(maxX - pos.x);
      const top = Math.abs(pos.z - minZ);
      const bottom = Math.abs(maxZ - pos.z);
      const smallest = Math.min(left, right, top, bottom);
      if (smallest === left) pos.x = minX - radius;
      else if (smallest === right) pos.x = maxX + radius;
      else if (smallest === top) pos.z = minZ - radius;
      else pos.z = maxZ + radius;
    }
  }
};

export const resolveCircleCircle = (a: Entity, b: Entity) => {
  const dx = a.mesh.position.x - b.mesh.position.x;
  const dz = a.mesh.position.z - b.mesh.position.z;
  const distSq = dx * dx + dz * dz;
  const minDist = a.radius + b.radius;
  if (distSq < minDist * minDist && distSq > 0.00001) {
    const dist = Math.sqrt(distSq);
    const overlap = minDist - dist;
    const nx = dx / dist;
    const nz = dz / dist;
    a.mesh.position.x += nx * (overlap * 0.5);
    a.mesh.position.z += nz * (overlap * 0.5);
    b.mesh.position.x -= nx * (overlap * 0.5);
    b.mesh.position.z -= nz * (overlap * 0.5);
  }
};

export const distanceToColliderSurface = (
  pos: THREE.Vector3,
  radius: number,
  collider: StaticCollider
): number => {
  const minX = collider.center.x - collider.halfSize.x;
  const maxX = collider.center.x + collider.halfSize.x;
  const minZ = collider.center.z - collider.halfSize.z;
  const maxZ = collider.center.z + collider.halfSize.z;
  const closestX = clamp(pos.x, minX, maxX);
  const closestZ = clamp(pos.z, minZ, maxZ);
  const dx = pos.x - closestX;
  const dz = pos.z - closestZ;
  return Math.sqrt(dx * dx + dz * dz) - radius;
};

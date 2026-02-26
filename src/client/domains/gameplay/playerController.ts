import * as THREE from 'three';
import { clamp } from '../world/collision';

export type PlayerState = {
  mesh: THREE.Object3D;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  baseY: number;
};

export const clampMoveTarget = (
  pos: THREE.Vector3,
  worldBounds: number
): THREE.Vector3 =>
  new THREE.Vector3(
    clamp(pos.x, -worldBounds, worldBounds),
    0,
    clamp(pos.z, -worldBounds, worldBounds)
  );

export type KeyboardMoveScratch = {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  moveDir: THREE.Vector3;
};

export const computeKeyboardMoveTarget = (
  player: PlayerState,
  keyboardDir: THREE.Vector3,
  gridSize: number
): THREE.Vector3 => {
  const keyboardMoveDistance = Math.max(gridSize, player.speed * 0.35);
  return player.mesh.position
    .clone()
    .addScaledVector(keyboardDir, keyboardMoveDistance);
};

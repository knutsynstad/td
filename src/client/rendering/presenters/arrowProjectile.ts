import * as THREE from 'three';

const getObjectByNameCaseInsensitive = (
  source: THREE.Object3D,
  targetName: string
) => {
  const direct = source.getObjectByName(targetName);
  if (direct) return direct;
  const lowered = targetName.toLowerCase();
  let match: THREE.Object3D | null = null;
  source.traverse((child) => {
    if (match) return;
    if ((child.name || '').toLowerCase() !== lowered) return;
    match = child;
  });
  return match;
};

const findFacingMarker = (source: THREE.Object3D) => {
  const exact = getObjectByNameCaseInsensitive(source, 'Facing');
  if (exact) return exact;
  let prefixMatch: THREE.Object3D | null = null;
  source.traverse((child) => {
    if (prefixMatch) return;
    const name = (child.name || '').toLowerCase();
    if (!name.startsWith('facing')) return;
    prefixMatch = child;
  });
  return prefixMatch;
};

export type ArrowFacing = {
  anchorLocalPos: THREE.Vector3;
  forwardLocal: THREE.Vector3;
};

const defaultFacing: ArrowFacing = {
  anchorLocalPos: new THREE.Vector3(0, 0, 0),
  forwardLocal: new THREE.Vector3(0, 1, 0),
};

export const computeArrowFacingFromTemplate = (
  source: THREE.Object3D
): ArrowFacing => {
  source.updateMatrixWorld(true);
  const facing = findFacingMarker(source);
  if (!facing) return defaultFacing;

  const anchorLocalPos = new THREE.Vector3();
  const forwardLocal = new THREE.Vector3(0, 1, 0);

  const sourceInverse = new THREE.Matrix4().copy(source.matrixWorld).invert();
  const facingLocalMatrix = new THREE.Matrix4().multiplyMatrices(
    sourceInverse,
    facing.matrixWorld
  );
  const facingLocalQuaternion = new THREE.Quaternion();
  const facingLocalScale = new THREE.Vector3();
  facingLocalMatrix.decompose(
    anchorLocalPos,
    facingLocalQuaternion,
    facingLocalScale
  );
  const directionFromPosition = anchorLocalPos.clone();
  const directionFromRotation = new THREE.Vector3(0, 1, 0).applyQuaternion(
    facingLocalQuaternion
  );
  if (directionFromPosition.lengthSq() > 1e-9) {
    forwardLocal.copy(directionFromPosition).normalize();
  } else if (directionFromRotation.lengthSq() > 1e-9) {
    forwardLocal.copy(directionFromRotation).normalize();
  }
  return { anchorLocalPos, forwardLocal };
};

const orientSourceAxisScratch = new THREE.Vector3();
const desiredDirScratch = new THREE.Vector3();
const desiredQuatScratch = new THREE.Quaternion();

export const orientArrowToVelocity = (
  object: THREE.Object3D,
  velocity: THREE.Vector3,
  forwardLocal: THREE.Vector3
) => {
  if (velocity.lengthSq() < 1e-8) return;
  desiredDirScratch.copy(velocity).normalize();
  orientSourceAxisScratch.copy(forwardLocal).multiplyScalar(-1);
  desiredQuatScratch.setFromUnitVectors(
    orientSourceAxisScratch,
    desiredDirScratch
  );
  object.quaternion.copy(desiredQuatScratch);
};

const anchorOffsetWorldScratch = new THREE.Vector3();

export const placeArrowMeshAtFacing = (
  object: THREE.Object3D,
  facingPosition: THREE.Vector3,
  anchorLocalPos: THREE.Vector3
) => {
  anchorOffsetWorldScratch
    .copy(anchorLocalPos)
    .applyQuaternion(object.quaternion);
  object.position.copy(facingPosition).sub(anchorOffsetWorldScratch);
};

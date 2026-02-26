import * as THREE from 'three';

export const placeCannonballAtPosition = (
  mesh: THREE.Object3D,
  pos: THREE.Vector3
) => {
  mesh.position.copy(pos);
};

import * as THREE from 'three';

export const disposeObjectMeshes = (object: THREE.Object3D): void => {
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    if (Array.isArray(node.material)) {
      for (const material of node.material) material.dispose();
      return;
    }
    node.material.dispose();
  });
};

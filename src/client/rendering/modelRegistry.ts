import * as THREE from 'three';

const enableShadows = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

export const prepareStaticModel = (source: THREE.Object3D): THREE.Object3D => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) {
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    model.position.set(-center.x, -bounds.min.y, -center.z);
  }
  enableShadows(model);
  return model;
};

export const prepareStaticModelPreserveScale = prepareStaticModel;

export const prepareCoinModel = (source: THREE.Object3D): THREE.Object3D => {
  const model = source.clone(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  if (initialBounds.isEmpty()) return model;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  initialBounds.getSize(size);
  initialBounds.getCenter(center);
  const largestAxis = Math.max(size.x, size.y, size.z, 0.001);
  const targetAxis = 1.2;
  const uniformScale = targetAxis / largestAxis;
  model.scale.multiplyScalar(uniformScale);
  model.position.set(
    -center.x * uniformScale,
    -center.y * uniformScale,
    -center.z * uniformScale
  );
  enableShadows(model);
  return model;
};

export const preparePlayerModel = (source: THREE.Object3D): THREE.Object3D => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) {
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    model.position.set(-center.x, -bounds.min.y, -center.z);
  }
  enableShadows(model);
  return model;
};

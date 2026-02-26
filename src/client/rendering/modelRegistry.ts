import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

export const disposeMesh = (obj: THREE.Object3D) => {
  if (obj instanceof THREE.Mesh && obj.geometry && obj.material) {
    obj.geometry.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat.dispose();
  }
};

export const loadModel = (
  loader: GLTFLoader,
  url: string,
  preparer: (source: THREE.Object3D) => THREE.Object3D = prepareStaticModel
): Promise<THREE.Object3D> =>
  new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(preparer(gltf.scene)),
      undefined,
      reject
    );
  });

export const loadModelRaw = (
  loader: GLTFLoader,
  url: string
): Promise<THREE.Object3D> =>
  new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });

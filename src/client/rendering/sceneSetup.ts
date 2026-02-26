import * as THREE from 'three';

export type IsometricSceneOptions = {
  background?: number;
  orthoSize?: number;
  isoAngle?: number;
  isoRot?: number;
  isoDistance?: number;
  shadowMapSize?: number;
  shadowCameraExtent?: number;
};

export type IsometricSceneResult = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  orthoSize: number;
  cameraOffset: THREE.Vector3;
  renderer: THREE.WebGLRenderer;
  hemisphereLight: THREE.HemisphereLight;
  directionalLight: THREE.DirectionalLight;
  dirShadowFollowOffset: THREE.Vector3;
};

const DEFAULT_BACKGROUND = 0x10151a;
const DEFAULT_ORTHO_SIZE = 10;
const DEFAULT_ISO_ANGLE = Math.PI / 6;
const DEFAULT_ISO_ROT = Math.PI / 4;
const DEFAULT_ISO_DISTANCE = 18;
const DEFAULT_SHADOW_MAP_SIZE = 2048;
const DEFAULT_SHADOW_EXTENT = 36;

export const createIsometricScene = (
  opts: IsometricSceneOptions = {}
): IsometricSceneResult => {
  const bg = opts.background ?? DEFAULT_BACKGROUND;
  const orthoSize = opts.orthoSize ?? DEFAULT_ORTHO_SIZE;
  const isoAngle = opts.isoAngle ?? DEFAULT_ISO_ANGLE;
  const isoRot = opts.isoRot ?? DEFAULT_ISO_ROT;
  const isoDistance = opts.isoDistance ?? DEFAULT_ISO_DISTANCE;
  const shadowMapSize = opts.shadowMapSize ?? DEFAULT_SHADOW_MAP_SIZE;
  const shadowExtent = opts.shadowCameraExtent ?? DEFAULT_SHADOW_EXTENT;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -orthoSize * aspect,
    orthoSize * aspect,
    orthoSize,
    -orthoSize,
    -50,
    200
  );
  const cameraOffset = new THREE.Vector3(
    Math.cos(isoRot) * Math.cos(isoAngle) * isoDistance,
    Math.sin(isoAngle) * isoDistance,
    Math.sin(isoRot) * Math.cos(isoAngle) * isoDistance
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  const dirShadowFollowOffset = new THREE.Vector3(18, 10, -14);
  const dir = new THREE.DirectionalLight(0xffffff, 1.25);
  dir.position.copy(dirShadowFollowOffset);
  dir.castShadow = true;
  dir.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 100;
  dir.shadow.camera.left = -shadowExtent;
  dir.shadow.camera.right = shadowExtent;
  dir.shadow.camera.top = shadowExtent;
  dir.shadow.camera.bottom = -shadowExtent;
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.02;
  dir.shadow.camera.updateProjectionMatrix();
  scene.add(dir);
  scene.add(dir.target);

  return {
    scene,
    camera,
    orthoSize,
    cameraOffset,
    renderer,
    hemisphereLight: hemi,
    directionalLight: dir,
    dirShadowFollowOffset,
  };
};

export type PerspectiveSceneOptions = {
  background?: number;
  fov?: number;
  isoAngle?: number;
  isoRot?: number;
  cameraDistance?: number;
  shadowMapSize?: number;
  shadowCameraExtent?: number;
};

export type PerspectiveSceneResult = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  directionalLight: THREE.DirectionalLight;
};

export const createPerspectiveScene = (
  opts: PerspectiveSceneOptions = {}
): PerspectiveSceneResult => {
  const bg = opts.background ?? DEFAULT_BACKGROUND;
  const fov = opts.fov ?? 45;
  const isoAngle = opts.isoAngle ?? DEFAULT_ISO_ANGLE;
  const isoRot = opts.isoRot ?? Math.PI / 8;
  const cameraDistance = opts.cameraDistance ?? 26;
  const shadowMapSize = opts.shadowMapSize ?? DEFAULT_SHADOW_MAP_SIZE;
  const shadowExtent = opts.shadowCameraExtent ?? DEFAULT_SHADOW_EXTENT;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);

  const camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(
    Math.cos(isoRot) * Math.cos(isoAngle) * cameraDistance,
    Math.sin(isoAngle) * cameraDistance,
    Math.sin(isoRot) * Math.cos(isoAngle) * cameraDistance
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1.25);
  dir.position.set(18, 10, -14);
  dir.castShadow = true;
  dir.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 100;
  dir.shadow.camera.left = -shadowExtent;
  dir.shadow.camera.right = shadowExtent;
  dir.shadow.camera.top = shadowExtent;
  dir.shadow.camera.bottom = -shadowExtent;
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.02;
  dir.shadow.camera.updateProjectionMatrix();
  scene.add(dir);
  scene.add(dir.target);

  return { scene, camera, renderer, directionalLight: dir };
};

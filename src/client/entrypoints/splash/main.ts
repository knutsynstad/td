import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { requestExpandedMode } from '@devvit/web/client';
import castleModelUrl from '../../assets/models/castle.glb?url';
import treeModelUrl from '../../assets/models/tree.glb?url';
import './splash.css';

type GamePreview = {
  wave: number;
  mobsLeft: number;
  playerCount: number;
};

const GROUND_SIZE = 400;
const CAMERA_DISTANCE = 26;
const ISO_ANGLE = Math.PI / 6;
const ISO_ROT = Math.PI / 8;

const fetchPreview = async (): Promise<GamePreview> => {
  const response = await fetch('/api/game/preview');
  if (!response.ok) throw new Error('Preview fetch failed');
  const data = (await response.json()) as GamePreview;
  return {
    wave: Math.max(0, Math.floor(Number(data.wave) || 0)),
    mobsLeft: Math.max(0, Math.floor(Number(data.mobsLeft) || 0)),
    playerCount: Math.max(0, Math.floor(Number(data.playerCount) || 0)),
  };
};

const POLL_INTERVAL_MS = 5000;

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('Missing #app');

// Canvas container (full bleed)
const canvasContainer = document.createElement('div');
canvasContainer.className = 'splash-canvas-container';
app.appendChild(canvasContainer);

// Three.js scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151a);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(
  Math.cos(ISO_ROT) * Math.cos(ISO_ANGLE) * CAMERA_DISTANCE,
  Math.sin(ISO_ANGLE) * CAMERA_DISTANCE,
  Math.sin(ISO_ROT) * Math.cos(ISO_ANGLE) * CAMERA_DISTANCE
);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasContainer.appendChild(renderer.domElement);

const vignette = document.createElement('div');
vignette.className = 'splash-vignette';
app.appendChild(vignette);

const loader = new GLTFLoader();

// Ground plane – same color as game's groundMaterial (0x52a384)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x5f926a })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Lights (match game scene)
const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 1.25);
dir.position.set(18, 10, -14);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 100;
dir.shadow.camera.left = -36;
dir.shadow.camera.right = 36;
dir.shadow.camera.top = 36;
dir.shadow.camera.bottom = -36;
dir.shadow.bias = -0.0005;
dir.shadow.normalBias = 0.02;
dir.shadow.camera.updateProjectionMatrix();
scene.add(dir);
scene.add(dir.target);

// Castle placeholder (replaced when model loads)
const castle = new THREE.Group();
castle.position.set(0, 0, 0);
scene.add(castle);

const treesGroup = new THREE.Group();
scene.add(treesGroup);

const prepareTreeModel = (source: THREE.Object3D): THREE.Object3D => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) {
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    model.position.set(-center.x, -bounds.min.y, -center.z);
  }
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
};

const TREE_POSITIONS = [
  { x: 0, z: 7 },
  { x: 0, z: -7 },
];

loader.load(
  castleModelUrl,
  (gltf) => {
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    castle.add(model);
  },
  undefined,
  () => {
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 4),
      new THREE.MeshStandardMaterial({ color: 0xc9a86c })
    );
    fallback.position.y = 2;
    fallback.castShadow = true;
    castle.add(fallback);
  }
);

loader.load(
  treeModelUrl,
  (gltf) => {
    const template = prepareTreeModel(gltf.scene);
    for (const pos of TREE_POSITIONS) {
      const tree = template.clone(true);
      tree.position.set(pos.x, 0, pos.z);
      tree.rotation.y = Math.PI * 0.25;
      tree.scale.setScalar(1.5);
      treesGroup.add(tree);
    }
  },
  undefined,
  () => {
    for (const pos of TREE_POSITIONS) {
      const tree = new THREE.Mesh(
        new THREE.ConeGeometry(0.8, 2.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x2d5a27 })
      );
      tree.position.set(pos.x, 1.875, pos.z);
      tree.rotation.y = Math.PI * 0.25;
      tree.castShadow = true;
      tree.receiveShadow = true;
      treesGroup.add(tree);
    }
  }
);

// Overlay (stats + Play)
const overlay = document.createElement('div');
overlay.className = 'splash-overlay';
overlay.innerHTML = `
  <div class="play-button-wrap">
    <div class="play-button-tape play-button-tape--top" aria-hidden="true"></div>
    <button id="playButton" class="play-button" type="button">
      <span class="play-button__label">Tap to Play</span>
      <span class="play-button__meta">
        Wave <span id="wave">–</span>
        <span class="play-button__meta-sep">•</span>
        <span id="playerCount">–</span> players online
      </span>
    </button>
    <div class="play-button-tape play-button-tape--bottom" aria-hidden="true"></div>
  </div>
`;
app.appendChild(overlay);

const waveEl = document.getElementById('wave');
const playersEl = document.getElementById('playerCount');

const updateStats = (preview: GamePreview) => {
  if (waveEl) waveEl.textContent = String(preview.wave);
  if (playersEl) playersEl.textContent = String(preview.playerCount);
};

const loadPreview = async () => {
  try {
    const preview = await fetchPreview();
    updateStats(preview);
  } catch {
    updateStats({ wave: 0, mobsLeft: 0, playerCount: 0 });
  }
};

void loadPreview();
const pollId = window.setInterval(loadPreview, POLL_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadPreview();
});

const playButton = overlay.querySelector<HTMLButtonElement>('#playButton');
if (playButton !== null) {
  playButton.addEventListener('click', (event) => {
    window.clearInterval(pollId);
    requestExpandedMode(event, 'game');
  });
}

// Resize
const onResize = () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
};
window.addEventListener('resize', onResize);

// Animation loop
const animate = () => {
  requestAnimationFrame(animate);
  const treeSway = Math.sin(performance.now() * 0.001) * 0.025;
  treesGroup.children.forEach((tree) => {
    tree.rotation.z = treeSway;
  });
  renderer.render(scene, camera);
};
animate();

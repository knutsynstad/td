import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import coinModelUrl from '../src/client/assets/models/coin.glb?url';
import towerModelUrl from '../src/client/assets/models/tower-ballista.glb?url';
import wallModelUrl from '../src/client/assets/models/wall.glb?url';
import treeModelUrl from '../src/client/assets/models/tree.glb?url';
import swordModelUrl from '../src/client/assets/models/sword.glb?url';
import arrowModelUrl from '../src/client/assets/models/arrow.glb?url';
import cannonModelUrl from '../src/client/assets/models/cannon.glb?url';
import bombModelUrl from '../src/client/assets/models/bomb.glb?url';
import signModelUrl from '../src/client/assets/models/sign.glb?url';

type Preset = {
  id: string;
  label: string;
  modelUrl: string;
  outputName: string;
  /** Scale multiplier for model size in frame (default 1) */
  scale?: number;
  /** Camera zoom multiplier - makes model appear larger (default 1) */
  zoom?: number;
  /** Rotation around X axis in radians */
  rotationX?: number;
  /** Rotation around Y axis in radians */
  rotationY?: number;
  /** Rotation around Z axis in radians (diagonal in screen plane) */
  rotationZ?: number;
};

const ICON_SIZE = 256;
/** Frame fill (1 = edge-to-edge). */
const FILL_RATIO = 1;

const presets: Preset[] = [
  {
    id: 'coin',
    label: 'Coin',
    modelUrl: coinModelUrl,
    outputName: 'coin-icon.png',
    scale: 1.2,
  },
  {
    id: 'tower',
    label: 'Tower',
    modelUrl: towerModelUrl,
    outputName: 'tower-icon.png',
    scale: 1.85,
  },
  {
    id: 'wall',
    label: 'Wall',
    modelUrl: wallModelUrl,
    outputName: 'wall-icon.png',
  },
  {
    id: 'tree',
    label: 'Tree',
    modelUrl: treeModelUrl,
    outputName: 'tree-icon.png',
    scale: 3.9,
  },
  {
    id: 'sword',
    label: 'Sword',
    modelUrl: swordModelUrl,
    outputName: 'sword-icon.png',
    zoom: 1.1,
    rotationZ: (80 * Math.PI) / 180,
  },
  {
    id: 'arrow',
    label: 'Arrow',
    modelUrl: arrowModelUrl,
    outputName: 'arrow-icon.png',
    zoom: 1.1,
    rotationZ: (-10 * Math.PI) / 180,
  },
  {
    id: 'cannon',
    label: 'Cannon',
    modelUrl: cannonModelUrl,
    outputName: 'cannon-icon.png',
  },
  {
    id: 'bomb',
    label: 'Bomb',
    modelUrl: bombModelUrl,
    outputName: 'bomb-icon.png',
  },
  {
    id: 'sign',
    label: 'Sign',
    modelUrl: signModelUrl,
    outputName: 'sign-icon.png',
    scale: 0.85,
    zoom: 1,
    rotationX: -Math.PI / 4,
    rotationY: -Math.PI / 2,
    rotationZ: -Math.PI / 4,
  },
];

const app = document.querySelector<HTMLDivElement>('#icon-generator-app');
if (!app) throw new Error('Missing icon generator root element.');

const presetSlotsHtml = presets
  .map(
    (p) => `
    <div class="icon-generator__item">
      <div class="icon-generator__slot" data-preset-id="${p.id}">
        <div class="icon-generator__spinner"></div>
        <canvas class="icon-generator__preview" width="256" height="256"></canvas>
      </div>
      <div class="icon-generator__label">${p.outputName}</div>
    </div>`
  )
  .join('');

app.innerHTML = `
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: Inter, system-ui, sans-serif;
      background: #11161b;
      color: #e8edf4;
    }
    .icon-generator {
      max-width: 820px;
      margin: 24px auto;
      padding: 20px;
    }
    .icon-generator__header h1 {
      margin: 0 0 2px 0;
      font-size: 1.5rem;
      font-weight: 600;
    }
    .icon-generator__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .icon-generator__header-right {
      flex-shrink: 0;
    }
    .icon-generator button {
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(13, 18, 24, 0.8);
      color: #e8edf4;
      height: 34px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
      font-weight: 600;
    }
    .icon-generator__grid {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 20px;
      margin-bottom: 12px;
    }
    .icon-generator__item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .icon-generator__label {
      font-size: 0.8rem;
      color: rgba(232, 237, 244, 0.65);
    }
    .icon-generator__slot {
      position: relative;
      width: 256px;
      height: 256px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-image:
        linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.06) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.06) 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0px;
    }
    .icon-generator__spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: #e8edf4;
      border-radius: 50%;
      animation: icon-generator-spin 0.8s linear infinite;
    }
    .icon-generator__preview {
      display: none;
    }
    .icon-generator__slot[data-loaded] .icon-generator__spinner {
      display: none;
    }
    .icon-generator__slot[data-loaded] .icon-generator__preview {
      display: block;
    }
    .icon-generator__preview {
      width: 256px;
      height: 256px;
      image-rendering: auto;
    }
    @keyframes icon-generator-spin {
      to { transform: rotate(360deg); }
    }
    .icon-generator__hint {
      font-size: 0.8rem;
      font-weight: 400;
      color: rgba(232, 237, 244, 0.65);
      margin-top: 2px;
    }
  </style>
  <section class="icon-generator">
    <div class="icon-generator__header">
      <div>
        <h1>Model Icon Generator</h1>
        <div class="icon-generator__hint">
          Saves go to <code>src/client/assets/ui/</code>
        </div>
      </div>
      <div class="icon-generator__header-right">
        <button id="saveAllBtn" type="button">Save Icons</button>
      </div>
    </div>
    <div class="icon-generator__grid">
      ${presetSlotsHtml}
    </div>
  </section>
`;

const saveAllBtn = document.querySelector<HTMLButtonElement>('#saveAllBtn');
if (!saveAllBtn) throw new Error('Save all button not found.');

const getSlot = (presetId: string) =>
  document.querySelector<HTMLElement>(
    `.icon-generator__slot[data-preset-id="${presetId}"]`
  );
const getCanvas = (presetId: string) =>
  getSlot(presetId)?.querySelector<HTMLCanvasElement>('.icon-generator__preview');

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
const rendererCanvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({
  canvas: rendererCanvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.setSize(ICON_SIZE, ICON_SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;

const ambient = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff8ed, 2.8);
keyLight.position.set(1.8, 2.2, 2.5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xf0f8ff, 1.4);
fillLight.position.set(-1.2, 0.8, 2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xe0eaff, 1.4);
rimLight.position.set(-0.8, 1.2, -2);
scene.add(rimLight);

const root = new THREE.Group();
scene.add(root);

const gltfLoader = new GLTFLoader();
const tmpBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpSize = new THREE.Vector3();
const isoAngle = Math.PI / 8;
const isoRot = Math.PI / 6;
const isoDirection = new THREE.Vector3(
  Math.cos(isoRot) * Math.cos(isoAngle),
  Math.sin(isoAngle),
  Math.sin(isoRot) * Math.cos(isoAngle)
).normalize();

const normalizeModel = (
  source: THREE.Object3D,
  scaleMultiplier = 1
) => {
  const model = source.clone(true);
  tmpBox.setFromObject(model);
  if (tmpBox.isEmpty()) return model;

  tmpBox.getCenter(tmpCenter);
  model.position.sub(tmpCenter);
  tmpBox.setFromObject(model);
  tmpBox.getSize(tmpSize);
  const maxAxis = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.001);
  const desiredAxis = 1;
  const uniformScale = (desiredAxis / maxAxis) * scaleMultiplier;
  model.scale.multiplyScalar(uniformScale);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.depthTest = true;
      material.colorWrite = true;
      material.needsUpdate = true;
    }
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return model;
};

const OUTLINE_THICKNESS = 8;

/** 2D screen-space outline: dilate silhouette, outline = dilated - original. */
const applyOutline2D = (pixels: Uint8Array, size: number) => {
  const alpha = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    alpha[i] = pixels[i * 4 + 3] > 127 ? 255 : 0;
  }
  const dilated = new Uint8Array(alpha);
  for (let r = 0; r < OUTLINE_THICKNESS; r += 1) {
    const prev = new Uint8Array(dilated);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        if (prev[i]) continue;
        const hasNeighbor = [
          [-1, 0], [1, 0], [0, -1], [0, 1],
          [-1, -1], [-1, 1], [1, -1], [1, 1],
        ].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && nx < size && ny >= 0 && ny < size && prev[ny * size + nx];
        });
        if (hasNeighbor) dilated[i] = 255;
      }
    }
  }
  for (let i = 0; i < size * size; i += 1) {
    if (dilated[i] && !alpha[i]) {
      pixels[i * 4] = 0;
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 127;
    }
  }
};

const createOutlinedModel = (source: THREE.Object3D) => source.clone(true);

const RENDER_SCALE = 8;

const renderToOutlinedPixels = () => {
  const w = ICON_SIZE * RENDER_SCALE;
  const h = ICON_SIZE * RENDER_SCALE;
  const renderTarget = new THREE.WebGLRenderTarget(w, h, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  renderer.setSize(w, h, false);
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(renderTarget);
  renderer.clear();
  renderer.render(scene, camera);
  const hiRes = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, w, h, hiRes);
  renderer.setRenderTarget(previousTarget);
  renderer.setSize(ICON_SIZE, ICON_SIZE, false);
  renderTarget.dispose();

  const pixels = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
  const n = RENDER_SCALE * RENDER_SCALE;
  for (let oy = 0; oy < ICON_SIZE; oy += 1) {
    for (let ox = 0; ox < ICON_SIZE; ox += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < RENDER_SCALE; dy += 1) {
        for (let dx = 0; dx < RENDER_SCALE; dx += 1) {
          const sx = ox * RENDER_SCALE + dx;
          const sy = oy * RENDER_SCALE + dy;
          const i = sy * w * 4 + sx * 4;
          r += hiRes[i];
          g += hiRes[i + 1];
          b += hiRes[i + 2];
          a += hiRes[i + 3];
        }
      }
      const o = oy * ICON_SIZE * 4 + ox * 4;
      pixels[o] = r / n;
      pixels[o + 1] = g / n;
      pixels[o + 2] = b / n;
      pixels[o + 3] = a / n;
    }
  }
  applyOutline2D(pixels, ICON_SIZE);
  return pixels;
};

const pixelsToDataUrl = (pixels: Uint8Array) => {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create 2D context');
  const imageData = ctx.createImageData(ICON_SIZE, ICON_SIZE);
  const out = imageData.data;
  for (let y = 0; y < ICON_SIZE; y += 1) {
    const srcY = ICON_SIZE - 1 - y;
    const srcRowOffset = srcY * ICON_SIZE * 4;
    const dstRowOffset = y * ICON_SIZE * 4;
    out.set(pixels.subarray(srcRowOffset, srcRowOffset + ICON_SIZE * 4), dstRowOffset);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const viewPoint = new THREE.Vector3();

const fitCameraToModel = (target: THREE.Object3D, zoomMultiplier = 1) => {
  tmpBox.setFromObject(target);
  if (tmpBox.isEmpty()) return;

  const radius = tmpBox.getBoundingSphere(new THREE.Sphere()).radius;
  camera.position.copy(isoDirection).multiplyScalar(Math.max(2.6, radius * 5));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // Use all mesh vertices for accurate extent (bbox corners can under-report for thin/curved shapes)
  let maxExtent = 0.001;
  target.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    const geo = obj.geometry;
    const posAttr = geo.getAttribute('position');
    if (!posAttr) return;
    const matrix = obj.matrixWorld;
    for (let i = 0; i < posAttr.count; i += 1) {
      viewPoint.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      viewPoint.applyMatrix4(camera.matrixWorldInverse);
      maxExtent = Math.max(
        maxExtent,
        Math.abs(viewPoint.x),
        Math.abs(viewPoint.y)
      );
    }
  });

  // Pad extent so outline (drawn in pixels) is never clipped
  const outlinePadding = (2 * OUTLINE_THICKNESS) / ICON_SIZE;
  camera.zoom =
    (FILL_RATIO / (maxExtent + outlinePadding)) * zoomMultiplier;
  camera.updateProjectionMatrix();
};

const renderedDataUrlByPreset = new Map<string, string>();

const renderPreset = async (preset: Preset) => {
  try {
    const gltf = await gltfLoader.loadAsync(preset.modelUrl);
    root.clear();
    const scaleMultiplier = preset.scale ?? 1;
    const model = normalizeModel(gltf.scene, scaleMultiplier);
    if (preset.rotationX != null) {
      model.rotation.x = preset.rotationX;
    }
    if (preset.rotationY != null) {
      model.rotation.y = preset.rotationY;
    }
    if (preset.rotationZ != null) {
      model.rotation.z = preset.rotationZ;
    }
    tmpBox.setFromObject(model);
    tmpBox.getCenter(tmpCenter);
    model.position.sub(tmpCenter);
    root.add(model);
    root.add(createOutlinedModel(model));
    fitCameraToModel(root, preset.zoom ?? 1);
    const pixels = renderToOutlinedPixels();
    const dataUrl = pixelsToDataUrl(pixels);
    renderedDataUrlByPreset.set(preset.id, dataUrl);

    const canvas = getCanvas(preset.id);
    const slot = getSlot(preset.id);
    if (canvas && slot && canvas.getContext('2d')) {
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(ICON_SIZE, ICON_SIZE);
      for (let y = 0; y < ICON_SIZE; y += 1) {
        const srcY = ICON_SIZE - 1 - y;
        imageData.data.set(
          pixels.subarray(srcY * ICON_SIZE * 4, (srcY + 1) * ICON_SIZE * 4),
          y * ICON_SIZE * 4
        );
      }
      ctx.putImageData(imageData, 0, 0);
      slot.setAttribute('data-loaded', '');
    }
  } catch {
    renderedDataUrlByPreset.delete(preset.id);
  }
};

const saveToProject = async (filename: string, dataUrl: string) => {
  const res = await fetch('/__save-icon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, dataUrl }),
  });
  const json = (await res.json()) as { path?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.path;
};

const saveAllPresetsToProject = async () => {
  const failed: string[] = [];
  let saved = 0;
  for (const preset of presets) {
    const dataUrl = renderedDataUrlByPreset.get(preset.id);
    if (!dataUrl) {
      failed.push(preset.outputName);
      continue;
    }
    try {
      await saveToProject(preset.outputName, dataUrl);
      saved += 1;
    } catch {
      failed.push(preset.outputName);
    }
  }
  if (failed.length === 0) {
    saveAllBtn.textContent = `Saved ${saved} icons`;
  } else {
    saveAllBtn.textContent = `Saved ${saved}. Failed: ${failed.join(', ')}`;
  }
};

saveAllBtn.addEventListener('click', () => void saveAllPresetsToProject());

const renderAllPresets = async () => {
  for (const preset of presets) {
    await renderPreset(preset);
  }
};
void renderAllPresets();

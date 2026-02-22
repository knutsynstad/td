import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import coinModelUrl from '../assets/models/coin.glb?url'
import towerModelUrl from '../assets/models/tower-ballista.glb?url'
import wallModelUrl from '../assets/models/wall.glb?url'
import treeModelUrl from '../assets/models/tree.glb?url'

type Preset = {
  id: string
  label: string
  modelUrl: string
  outputName: string
}

const ICON_SIZE = 128
const OUTLINE_PX = 8
const MARGIN_PX = 3
const FILL_RATIO = 1 - (OUTLINE_PX + MARGIN_PX) / (ICON_SIZE * 0.5)

const presets: Preset[] = [
  { id: 'coin', label: 'Coin', modelUrl: coinModelUrl, outputName: 'coin-icon.png' },
  { id: 'tower', label: 'Tower', modelUrl: towerModelUrl, outputName: 'tower-icon.png' },
  { id: 'wall', label: 'Wall', modelUrl: wallModelUrl, outputName: 'wall-icon.png' },
  { id: 'tree', label: 'Tree', modelUrl: treeModelUrl, outputName: 'tree-icon.png' }
]

const app = document.querySelector<HTMLDivElement>('#icon-generator-app')
if (!app) throw new Error('Missing icon generator root element.')

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
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .icon-generator__controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 14px;
    }
    .icon-generator__field {
      display: grid;
      gap: 6px;
      font-size: 0.86rem;
    }
    .icon-generator input,
    .icon-generator select,
    .icon-generator button {
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(13, 18, 24, 0.8);
      color: #e8edf4;
      height: 34px;
      padding: 0 10px;
      font: inherit;
    }
    .icon-generator button {
      cursor: pointer;
      font-weight: 600;
    }
    .icon-generator__actions {
      display: flex;
      gap: 10px;
      margin: 6px 0 12px;
    }
    .icon-generator__preview-wrap {
      display: inline-grid;
      place-items: center;
      width: 256px;
      height: 256px;
      background-image:
        linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.06) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.06) 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .icon-generator__preview {
      width: 128px;
      height: 128px;
      image-rendering: auto;
      display: block;
    }
    .icon-generator__status {
      margin-top: 10px;
      font-size: 0.85rem;
      opacity: 0.9;
      min-height: 1.2em;
    }
    .icon-generator__hint {
      font-size: 0.78rem;
      opacity: 0.7;
      margin-top: 8px;
    }
  </style>
  <section class="icon-generator">
    <h1>Model Icon Generator</h1>
    <div class="icon-generator__controls">
      <label class="icon-generator__field">
        Preset
        <select id="presetSelect"></select>
      </label>
      <label class="icon-generator__field">
        Output file name
        <input id="outputNameInput" type="text" />
      </label>
      <label class="icon-generator__field" style="grid-column: 1 / -1;">
        Model URL (override)
        <input id="modelUrlInput" type="text" />
      </label>
    </div>
    <div class="icon-generator__actions">
      <button id="renderBtn" type="button">Render</button>
      <button id="downloadBtn" type="button">Download PNG</button>
    </div>
    <div class="icon-generator__preview-wrap">
      <canvas id="previewCanvas" class="icon-generator__preview" width="128" height="128"></canvas>
    </div>
    <div id="statusText" class="icon-generator__status"></div>
    <div class="icon-generator__hint">
      This uses auto-fit with padding budget for thick outlines. Query support: <code>?preset=coin</code> or <code>?model=...&out=...</code>.
    </div>
  </section>
`

const presetSelect = document.querySelector<HTMLSelectElement>('#presetSelect')
const outputNameInput = document.querySelector<HTMLInputElement>('#outputNameInput')
const modelUrlInput = document.querySelector<HTMLInputElement>('#modelUrlInput')
const renderBtn = document.querySelector<HTMLButtonElement>('#renderBtn')
const downloadBtn = document.querySelector<HTMLButtonElement>('#downloadBtn')
const previewCanvas = document.querySelector<HTMLCanvasElement>('#previewCanvas')
const statusText = document.querySelector<HTMLDivElement>('#statusText')
if (!presetSelect || !outputNameInput || !modelUrlInput || !renderBtn || !downloadBtn || !previewCanvas || !statusText) {
  throw new Error('Icon generator controls were not created.')
}

for (const preset of presets) {
  const option = document.createElement('option')
  option.value = preset.id
  option.textContent = preset.label
  presetSelect.append(option)
}

const urlParams = new URLSearchParams(window.location.search)
const requestedPreset = urlParams.get('preset')
const presetById = new Map(presets.map((preset) => [preset.id, preset]))
const initialPreset = requestedPreset
  ? (presetById.get(requestedPreset) ?? presets[0])
  : presets[0]
presetSelect.value = initialPreset.id
modelUrlInput.value = urlParams.get('model') ?? initialPreset.modelUrl
outputNameInput.value = urlParams.get('out') ?? initialPreset.outputName

const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
const renderer = new THREE.WebGLRenderer({
  canvas: previewCanvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true
})
renderer.setPixelRatio(1)
renderer.setSize(ICON_SIZE, ICON_SIZE, false)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace

const ambient = new THREE.AmbientLight(0xffffff, 1.1)
scene.add(ambient)
const keyLight = new THREE.DirectionalLight(0xfff7e5, 1.35)
keyLight.position.set(1.9, 2.6, 1.8)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0xe8f0ff, 0.45)
rimLight.position.set(-1.5, 1.2, -2)
scene.add(rimLight)

const root = new THREE.Group()
scene.add(root)

const gltfLoader = new GLTFLoader()
const tmpBox = new THREE.Box3()
const tmpCenter = new THREE.Vector3()
const tmpSize = new THREE.Vector3()
const isoAngle = Math.PI / 6
const isoRot = Math.PI / 4
const isoDirection = new THREE.Vector3(
  Math.cos(isoRot) * Math.cos(isoAngle),
  Math.sin(isoAngle),
  Math.sin(isoRot) * Math.cos(isoAngle)
).normalize()

const normalizeModel = (source: THREE.Object3D) => {
  const model = source.clone(true)
  tmpBox.setFromObject(model)
  if (tmpBox.isEmpty()) return model

  tmpBox.getCenter(tmpCenter)
  model.position.sub(tmpCenter)
  tmpBox.setFromObject(model)
  tmpBox.getSize(tmpSize)
  const maxAxis = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.001)
  const desiredAxis = 1
  const uniformScale = desiredAxis / maxAxis
  model.scale.multiplyScalar(uniformScale)
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue
      material.transparent = false
      material.opacity = 1
      material.depthWrite = true
      material.depthTest = true
      material.colorWrite = true
      material.needsUpdate = true
    }
    node.castShadow = true
    node.receiveShadow = true
  })
  return model
}

const createOutlinedModel = (source: THREE.Object3D) => {
  const model = source.clone(true)
  const outline = source.clone(true)
  outline.scale.multiplyScalar(1.12)
  outline.renderOrder = 0
  outline.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: false,
      depthTest: true,
      depthWrite: true
    })
    node.material = outlineMaterial
    node.castShadow = false
    node.receiveShadow = false
  })
  model.renderOrder = 1
  const wrapped = new THREE.Group()
  wrapped.add(outline)
  wrapped.add(model)
  return wrapped
}

const fitCameraToModel = (target: THREE.Object3D) => {
  tmpBox.setFromObject(target)
  if (tmpBox.isEmpty()) return

  const corners: THREE.Vector3[] = []
  for (const x of [tmpBox.min.x, tmpBox.max.x]) {
    for (const y of [tmpBox.min.y, tmpBox.max.y]) {
      for (const z of [tmpBox.min.z, tmpBox.max.z]) {
        corners.push(new THREE.Vector3(x, y, z))
      }
    }
  }

  const radius = tmpBox.getBoundingSphere(new THREE.Sphere()).radius
  camera.position.copy(isoDirection).multiplyScalar(Math.max(2.6, radius * 5))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  let maxExtent = 0.001
  for (const corner of corners) {
    const viewCorner = corner.clone().applyMatrix4(camera.matrixWorldInverse)
    maxExtent = Math.max(maxExtent, Math.abs(viewCorner.x), Math.abs(viewCorner.y))
  }

  const safeFillRatio = Math.max(0.5, Math.min(FILL_RATIO, 0.92))
  camera.zoom = safeFillRatio / maxExtent
  camera.updateProjectionMatrix()
}

const collectDebug = () => {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  if (!box.isEmpty()) {
    box.getSize(size)
    box.getCenter(center)
  }
  let meshCount = 0
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) meshCount += 1
  })
  return {
    rootChildren: root.children.length,
    meshCount,
    cameraPos: camera.position.toArray(),
    cameraNear: camera.near,
    cameraFar: camera.far,
    cameraZoom: camera.zoom,
    boundsEmpty: box.isEmpty(),
    boundsSize: size.toArray(),
    boundsCenter: center.toArray()
  }
}

const exportIconDataUrl = () => {
  const renderTarget = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false
  })
  const previousTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(renderTarget)
  renderer.clear()
  renderer.render(scene, camera)
  const pixels = new Uint8Array(ICON_SIZE * ICON_SIZE * 4)
  renderer.readRenderTargetPixels(renderTarget, 0, 0, ICON_SIZE, ICON_SIZE, pixels)
  renderer.setRenderTarget(previousTarget)
  renderTarget.dispose()

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = ICON_SIZE
  exportCanvas.height = ICON_SIZE
  const exportCtx = exportCanvas.getContext('2d')
  if (!exportCtx) {
    throw new Error('Unable to create export canvas context.')
  }
  const imageData = exportCtx.createImageData(ICON_SIZE, ICON_SIZE)
  const out = imageData.data
  for (let y = 0; y < ICON_SIZE; y += 1) {
    const srcY = ICON_SIZE - 1 - y
    const srcRowOffset = srcY * ICON_SIZE * 4
    const dstRowOffset = y * ICON_SIZE * 4
    out.set(pixels.subarray(srcRowOffset, srcRowOffset + ICON_SIZE * 4), dstRowOffset)
  }
  exportCtx.putImageData(imageData, 0, 0)
  return exportCanvas.toDataURL('image/png')
}

// Expose a debug hook so automation can export with true alpha.
;(window as typeof window & { __iconExportDataUrl?: () => string }).__iconExportDataUrl = exportIconDataUrl
;(window as typeof window & { __iconDebug?: () => ReturnType<typeof collectDebug> }).__iconDebug = collectDebug

let lastRenderName = outputNameInput.value.trim() || 'item-icon.png'

const renderModel = async () => {
  const modelUrl = modelUrlInput.value.trim()
  if (!modelUrl) {
    statusText.textContent = 'Model URL is required.'
    return
  }
  statusText.textContent = `Loading ${modelUrl}...`
  try {
    const gltf = await gltfLoader.loadAsync(modelUrl)
    root.clear()
    const model = normalizeModel(gltf.scene)
    root.add(model)
    const wrapped = createOutlinedModel(model)
    root.add(wrapped)
    fitCameraToModel(wrapped)
    renderer.render(scene, camera)
    lastRenderName = outputNameInput.value.trim() || 'item-icon.png'
    statusText.textContent = `Rendered ${lastRenderName} (${ICON_SIZE}x${ICON_SIZE}, transparent).`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusText.textContent = `Failed to render model: ${message}`
  }
}

const downloadPng = async () => {
  if (!root.children[0]) {
    await renderModel()
    if (!root.children[0]) return
  }
  const outName = outputNameInput.value.trim() || lastRenderName || 'item-icon.png'
  try {
    const dataUrl = exportIconDataUrl()
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = outName
    anchor.click()
    statusText.textContent = `Downloaded ${outName}.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusText.textContent = `PNG export failed: ${message}`
  }
}

presetSelect.addEventListener('change', () => {
  const preset = presetById.get(presetSelect.value)
  if (!preset) return
  modelUrlInput.value = preset.modelUrl
  outputNameInput.value = preset.outputName
  void renderModel()
})

renderBtn.addEventListener('click', () => {
  void renderModel()
})

downloadBtn.addEventListener('click', () => {
  void downloadPng()
})

void renderModel()

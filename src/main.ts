import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import castleModelUrl from './assets/models/castle.glb?url'
import coinModelUrl from './assets/models/coin.glb?url'
import towerBallistaModelUrl from './assets/models/tower-ballista.glb?url'
import treeModelUrl from './assets/models/tree.glb?url'
import { screenToWorldOnGround } from './utils/coords'
import { SelectionDialog } from './ui/SelectionDialog'
import { StructureStore } from './game/structures'
import { getTowerType, getTowerUpgradeDeltaText, getTowerUpgradeOptions } from './game/TowerTypes'
import type { TowerTypeId, TowerUpgradeId } from './game/TowerTypes'
import type {
  DestructibleCollider,
  Entity,
  MobEntity,
  NpcEntity,
  PlayerEntity,
  StaticCollider,
  Tower,
  WaveSpawner
} from './game/types'
import { SpatialGrid } from './utils/SpatialGrid'
import { createParticleSystem } from './effects/particles'
import { clamp, distanceToColliderSurface, resolveCircleCircle } from './physics/collision'
import { createEntityMotionSystem } from './entities/motion'
import { createGameLoop } from './game/GameLoop'
import { areWaveSpawnersDone } from './game/spawners'
import { getAllBorderDoors } from './game/borderDoors'
import { computeLanePathAStar, type LanePathResult } from './pathfinding/laneAStar'
import { computeDirtyBounds } from './pathfinding/obstacleDelta'
import { SpawnerPathOverlay } from './effects/spawnerPathOverlay'
import {
  canPlace as canPlaceAt,
  getBuildSize as getBuildSizeForMode,
  getWallLinePlacement as computeWallLinePlacement,
  placeBuilding as placeBuildingAt,
  placeWallSegments as placeWallSegmentsAt,
  placeWallLine as placeWallSegment,
  snapCenterToBuildGrid,
  type BuildMode
} from './placement/building'
import {
  clearSelectionState,
  createSelectionState,
  getSelectedInRange as getSelectedInRangeFromState,
  getSelectionTowerTypeId as getSelectionTowerTypeIdFromState,
  getSingleSelectedTower as getSingleSelectedTowerFromState,
  isColliderInRange as isColliderInRangeFromState,
  setSelectedStructures as setSelectedStructuresState
} from './selection/selection'
import {
  ENERGY_CAP,
  ENERGY_COST_DELETE_TOWER,
  ENERGY_COST_DELETE_WALL,
  ENERGY_COST_TOWER,
  ENERGY_COST_UPGRADE_DAMAGE,
  ENERGY_COST_UPGRADE_RANGE,
  ENERGY_COST_UPGRADE_SPEED,
  ENERGY_COST_WALL,
  ENERGY_PER_PLAYER_KILL,
  ENERGY_REGEN_RATE,
  ENERGY_SYMBOL,
  GRID_SIZE,
  MAX_VISIBLE_MOB_INSTANCES,
  MOB_INSTANCE_CAP,
  MOB_HEIGHT,
  MOB_SIEGE_ATTACK_COOLDOWN,
  MOB_SIEGE_DAMAGE,
  MOB_SIEGE_RANGE_BUFFER,
  MOB_SIEGE_UNREACHABLE_GRACE,
  MOB_SPEED,
  MOB_WIDTH,
  NPC_SPEED,
  PLAYER_COLLISION_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_SPEED,
  PLAYER_WIDTH,
  SELECTION_RADIUS,
  SHOOT_COOLDOWN,
  SHOOT_DAMAGE,
  SPATIAL_GRID_CELL_SIZE,
  TOWER_HEIGHT,
  TOWER_HP,
  WAVE_MAX_SPAWNERS,
  WAVE_MIN_SPAWNERS,
  WAVE_SPAWNER_BASE_RATE,
  WALL_HP,
  WORLD_BOUNDS
} from './game/constants'
import { createGameState } from './game/state/GameState'
import { createInputController } from './input/InputController'
import { updateHud } from './presentation/HudPresenter'
import { renderVisibleMobInstances } from './presentation/RenderCoordinator'
import { createBallistaVisualRig, updateBallistaRigTracking, type BallistaVisualRig } from './presentation/ballistaRig'
import { createWaveAndSpawnSystem } from './game/systems/WaveAndSpawnSystem'
import {
  assertEnergyInBounds,
  assertMobSpawnerReferences,
  assertSpawnerCounts,
  assertStructureStoreConsistency
} from './game/invariants'
import { createRandomSource } from './utils/rng'

const app = document.querySelector<HTMLDivElement>('#app')!
const seedParam = new URLSearchParams(window.location.search).get('seed')
const parsedSeed = seedParam === null ? undefined : Number(seedParam)
const randomSource = createRandomSource(
  parsedSeed !== undefined && Number.isFinite(parsedSeed) ? parsedSeed : undefined
)
const random = () => randomSource.next()
const HITBOX_LAYER = 1
const TOWER_BUILD_SIZE = getBuildSizeForMode('tower')
const TREE_BUILD_SIZE = new THREE.Vector3(2, 2.4, 2)
const MAP_TREE_COUNT = 64
app.innerHTML = `
  <div id="hud" class="hud">
    <div class="hud-corner hud-corner--top-left">
      <div class="hud-status-stack">
        <div class="wave-display">Wave <span id="wave">0</span></div>
        <div class="hud-meta">
          <div id="mobsRow" class="hud-status">
            <div class="hud-status__primary"></div>
            <div class="hud-status__secondary">0 mobs left</div>
          </div>
          <div id="nextWaveRow" class="hud-status">
            <div class="hud-status__primary"></div>
            <div class="hud-status__secondary">Next wave in 0 sec</div>
          </div>
        </div>
      </div>
    </div>
    <div class="hud-corner hud-corner--top-right">
      <div class="hud-energy">
        <div class="hud-energy__icon-view">
          <canvas id="coinHudCanvas" class="hud-energy__coin-canvas" aria-label="Coins"></canvas>
        </div>
        <span id="energyCount" class="hud-energy__value">100</span>
      </div>
    </div>
    <div class="hud-overlay">
      <div id="eventBanner" class="event-banner"></div>
      <div id="finalCountdown" class="final-countdown"></div>
    </div>
    <div class="hud-corner hud-corner--bottom-right">
      <div class="hud-actions">
        <div class="build-buttons">
          <button id="buildWall" class="hud-button build-button">
            <span class="button-label">Wall</span>
            <span id="wallCount" class="hud-badge">${ENERGY_SYMBOL}${ENERGY_COST_WALL}</span>
          </button>
          <button id="buildTower" class="hud-button build-button">
            <span class="button-label">Tower</span>
            <span id="towerCount" class="hud-badge">${ENERGY_SYMBOL}${ENERGY_COST_TOWER}</span>
          </button>
        </div>
        <button id="shootButton" class="shoot-button">Shoot</button>
      </div>
    </div>
    <div class="hud-corner hud-corner--bottom-left">
      <div class="hud-minimap-wrap">
        <canvas id="hudMinimap" class="hud-minimap" aria-label="Mob minimap"></canvas>
      </div>
    </div>
  </div>
`

const waveEl = document.querySelector<HTMLSpanElement>('#wave')!
const mobsRowEl = document.querySelector<HTMLDivElement>('#mobsRow')!
const mobsPrimaryEl = mobsRowEl.querySelector<HTMLDivElement>('.hud-status__primary')!
const mobsSecondaryEl = mobsRowEl.querySelector<HTMLDivElement>('.hud-status__secondary')!
const wallCountEl = document.querySelector<HTMLSpanElement>('#wallCount')!
const towerCountEl = document.querySelector<HTMLSpanElement>('#towerCount')!
const energyCountEl = document.querySelector<HTMLSpanElement>('#energyCount')!
const finalCountdownEl = document.querySelector<HTMLDivElement>('#finalCountdown')!
const nextWaveRowEl = document.querySelector<HTMLDivElement>('#nextWaveRow')!
const nextWavePrimaryEl = nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__primary')!
const nextWaveSecondaryEl = nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__secondary')!
const eventBannerEl = document.querySelector<HTMLDivElement>('#eventBanner')!
const hudActionsEl = document.querySelector<HTMLDivElement>('.hud-actions')!
const buildWallBtn = document.querySelector<HTMLButtonElement>('#buildWall')!
const buildTowerBtn = document.querySelector<HTMLButtonElement>('#buildTower')!
const shootButton = document.querySelector<HTMLButtonElement>('#shootButton')!
const coinHudCanvasEl = document.querySelector<HTMLCanvasElement>('#coinHudCanvas')!
const minimapCanvasEl = document.querySelector<HTMLCanvasElement>('#hudMinimap')!
const minimapCtx = minimapCanvasEl.getContext('2d')

const coinHudScene = new THREE.Scene()
const coinHudCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
coinHudCamera.position.set(0, 0.8, 3)
coinHudCamera.lookAt(0, 0, 0)
const coinHudRenderer = new THREE.WebGLRenderer({
  canvas: coinHudCanvasEl,
  antialias: true,
  alpha: true
})
coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
coinHudRenderer.setSize(36, 36, false)
coinHudRenderer.outputColorSpace = THREE.SRGBColorSpace
const coinHudAmbient = new THREE.AmbientLight(0xffffff, 1.05)
coinHudScene.add(coinHudAmbient)
const coinHudKey = new THREE.DirectionalLight(0xffffff, 1.15)
coinHudKey.position.set(1.5, 2, 2)
coinHudScene.add(coinHudKey)
const coinHudRoot = new THREE.Group()
coinHudScene.add(coinHudRoot)
const coinTrailCanvasEl = document.createElement('canvas')
coinTrailCanvasEl.style.position = 'fixed'
coinTrailCanvasEl.style.inset = '0'
coinTrailCanvasEl.style.width = '100%'
coinTrailCanvasEl.style.height = '100%'
coinTrailCanvasEl.style.pointerEvents = 'none'
coinTrailCanvasEl.style.zIndex = '1800'
app.appendChild(coinTrailCanvasEl)
const coinTrailScene = new THREE.Scene()
const coinTrailCamera = new THREE.OrthographicCamera(0, window.innerWidth, window.innerHeight, 0, -20, 20)
const coinTrailAmbient = new THREE.AmbientLight(0xffffff, 1.1)
coinTrailScene.add(coinTrailAmbient)
const coinTrailKey = new THREE.DirectionalLight(0xffffff, 1.2)
coinTrailKey.position.set(0.6, 0.8, 1.2)
coinTrailScene.add(coinTrailKey)
const coinTrailRenderer = new THREE.WebGLRenderer({
  canvas: coinTrailCanvasEl,
  antialias: true,
  alpha: true
})
coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false)
coinTrailRenderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x10151a)

const aspect = window.innerWidth / window.innerHeight
const orthoSize = 15
const camera = new THREE.OrthographicCamera(
  -orthoSize * aspect,
  orthoSize * aspect,
  orthoSize,
  -orthoSize,
  -50,
  200
)
// Isometric angle: 30° elevation, 45° rotation (standard isometric)
const isoAngle = Math.PI / 6 // 30 degrees
const isoRot = Math.PI / 4 // 45 degrees
const isoDistance = 18
const cameraOffset = new THREE.Vector3(
  Math.cos(isoRot) * Math.cos(isoAngle) * isoDistance,
  Math.sin(isoAngle) * isoDistance,
  Math.sin(isoRot) * Math.cos(isoAngle) * isoDistance
)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.VSMShadowMap
app.appendChild(renderer.domElement)

const viewportFogEl = document.createElement('div')
viewportFogEl.className = 'viewport-fog'
app.appendChild(viewportFogEl)

const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)
const structureOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
)
structureOutlinePass.visibleEdgeColor.set(0xffe066)
structureOutlinePass.hiddenEdgeColor.set(0x6b5a1a)
structureOutlinePass.edgeStrength = 4
structureOutlinePass.edgeThickness = 1.5
structureOutlinePass.pulsePeriod = 0
structureOutlinePass.selectedObjects = []
composer.addPass(structureOutlinePass)
const treeOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
)
treeOutlinePass.visibleEdgeColor.set(0xffe066)
treeOutlinePass.hiddenEdgeColor.set(0x6b5a1a)
treeOutlinePass.edgeStrength = 4
treeOutlinePass.edgeThickness = 1.5
treeOutlinePass.pulsePeriod = 0
treeOutlinePass.selectedObjects = []
composer.addPass(treeOutlinePass)
composer.addPass(new OutputPass())

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15)
scene.add(hemi)
const ambient = new THREE.AmbientLight(0xffffff, 0.85)
scene.add(ambient)
const dir = new THREE.DirectionalLight(0xffffff, 1.25)
dir.position.set(18, 10, -14)
dir.castShadow = true
dir.shadow.mapSize.set(2048, 2048)
dir.shadow.camera.near = 1
dir.shadow.camera.far = 70
dir.shadow.camera.left = -24
dir.shadow.camera.right = 24
dir.shadow.camera.top = 24
dir.shadow.camera.bottom = -24
dir.shadow.bias = -0.0005
dir.shadow.normalBias = 0.02
dir.shadow.radius = 10
dir.shadow.blurSamples = 16
scene.add(dir)

type GroundBounds = { minX: number, maxX: number, minZ: number, maxZ: number }

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const getVisibleGroundBounds = (camera: THREE.OrthographicCamera): GroundBounds => {
  const corners = [
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(1, 1, -1),
    new THREE.Vector3(-1, 1, -1)
  ]
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const corner of corners) {
    const nearPoint = corner.clone().unproject(camera)
    const farPoint = corner.clone().setZ(1).unproject(camera)
    const direction = farPoint.sub(nearPoint).normalize()
    const ray = new THREE.Ray(nearPoint, direction)
    const hit = new THREE.Vector3()
    if (ray.intersectPlane(groundPlane, hit)) {
      minX = Math.min(minX, hit.x)
      maxX = Math.max(maxX, hit.x)
      minZ = Math.min(minZ, hit.z)
      maxZ = Math.max(maxZ, hit.z)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  }

  const padding = GRID_SIZE * 2
  minX -= padding
  maxX += padding
  minZ -= padding
  maxZ += padding

  minX = Math.floor(minX / GRID_SIZE) * GRID_SIZE
  maxX = Math.ceil(maxX / GRID_SIZE) * GRID_SIZE
  minZ = Math.floor(minZ / GRID_SIZE) * GRID_SIZE
  maxZ = Math.ceil(maxZ / GRID_SIZE) * GRID_SIZE

  return { minX, maxX, minZ, maxZ }
}

// World-aligned grid system that only renders visible lines
class WorldGrid {
  private group: THREE.Group
  private lineMaterial: THREE.LineBasicMaterial
  private lines: THREE.Line[] = []
  private lastBounds: GroundBounds | null = null
  private readonly halfGrid: number

  constructor() {
    this.group = new THREE.Group()
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x25303a, transparent: true, opacity: 0.35 })
    this.halfGrid = GRID_SIZE * 0.5
    scene.add(this.group)
  }

  update(bounds: GroundBounds) {
    if (
      this.lastBounds &&
      this.lastBounds.minX === bounds.minX &&
      this.lastBounds.maxX === bounds.maxX &&
      this.lastBounds.minZ === bounds.minZ &&
      this.lastBounds.maxZ === bounds.maxZ
    ) {
      return
    }
    this.lastBounds = bounds

    // Clear existing lines
    for (const line of this.lines) {
      this.group.remove(line)
      line.geometry.dispose()
    }
    this.lines = []

    const clampedMinX = Math.max(bounds.minX, -WORLD_BOUNDS)
    const clampedMaxX = Math.min(bounds.maxX, WORLD_BOUNDS)
    const clampedMinZ = Math.max(bounds.minZ, -WORLD_BOUNDS)
    const clampedMaxZ = Math.min(bounds.maxZ, WORLD_BOUNDS)
    if (clampedMinX > clampedMaxX || clampedMinZ > clampedMaxZ) {
      return
    }

    const minX = Math.ceil((clampedMinX - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const maxX = Math.floor((clampedMaxX - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const minZ = Math.ceil((clampedMinZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const maxZ = Math.floor((clampedMaxZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid

    // Create vertical lines (along Z axis)
    for (let x = minX; x <= maxX; x += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, clampedMinZ),
        new THREE.Vector3(x, 0.01, clampedMaxZ)
      ])
      const line = new THREE.Line(geometry, this.lineMaterial)
      this.group.add(line)
      this.lines.push(line)
    }

    // Create horizontal lines (along X axis)
    for (let z = minZ; z <= maxZ; z += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(clampedMinX, 0.01, z),
        new THREE.Vector3(clampedMaxX, 0.01, z)
      ])
      const line = new THREE.Line(geometry, this.lineMaterial)
      this.group.add(line)
      this.lines.push(line)
    }
  }

  dispose() {
    for (const line of this.lines) {
      this.group.remove(line)
      line.geometry.dispose()
    }
    this.lines = []
    this.lineMaterial.dispose()
    scene.remove(this.group)
  }
}

class WorldBorder {
  private readonly line: THREE.LineLoop

  constructor() {
    const points = [
      new THREE.Vector3(-WORLD_BOUNDS, 0.06, -WORLD_BOUNDS),
      new THREE.Vector3(WORLD_BOUNDS, 0.06, -WORLD_BOUNDS),
      new THREE.Vector3(WORLD_BOUNDS, 0.06, WORLD_BOUNDS),
      new THREE.Vector3(-WORLD_BOUNDS, 0.06, WORLD_BOUNDS)
    ]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color: 0xd96464, transparent: true, opacity: 0.95 })
    this.line = new THREE.LineLoop(geometry, material)
    scene.add(this.line)
  }

  dispose() {
    scene.remove(this.line)
    this.line.geometry.dispose()
    ;(this.line.material as THREE.Material).dispose()
  }
}

class SpawnContainerOverlay {
  private readonly lines = new Map<string, THREE.LineLoop>()
  private readonly material = new THREE.LineBasicMaterial({ color: 0x6f8a9c, transparent: true, opacity: 0.8 })

  upsert(spawnerId: string, corners: THREE.Vector3[]) {
    const existing = this.lines.get(spawnerId)
    if (existing) {
      scene.remove(existing)
      existing.geometry.dispose()
      this.lines.delete(spawnerId)
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(corners)
    const loop = new THREE.LineLoop(geometry, this.material)
    loop.position.y = 0.05
    scene.add(loop)
    this.lines.set(spawnerId, loop)
  }

  clear() {
    for (const line of this.lines.values()) {
      scene.remove(line)
      line.geometry.dispose()
    }
    this.lines.clear()
  }

  dispose() {
    this.clear()
    this.material.dispose()
  }
}

const worldGrid = new WorldGrid()
const worldBorder = new WorldBorder()
const spawnContainerOverlay = new SpawnContainerOverlay()
let lastGroundBounds: GroundBounds | null = null
const updateGroundFromBounds = (bounds: GroundBounds) => {
  const clampedBounds: GroundBounds = {
    minX: Math.max(bounds.minX, -WORLD_BOUNDS),
    maxX: Math.min(bounds.maxX, WORLD_BOUNDS),
    minZ: Math.max(bounds.minZ, -WORLD_BOUNDS),
    maxZ: Math.min(bounds.maxZ, WORLD_BOUNDS)
  }
  if (clampedBounds.minX > clampedBounds.maxX || clampedBounds.minZ > clampedBounds.maxZ) {
    return
  }

  if (
    lastGroundBounds &&
    lastGroundBounds.minX === clampedBounds.minX &&
    lastGroundBounds.maxX === clampedBounds.maxX &&
    lastGroundBounds.minZ === clampedBounds.minZ &&
    lastGroundBounds.maxZ === clampedBounds.maxZ
  ) {
    return
  }
  lastGroundBounds = clampedBounds
  const width = clampedBounds.maxX - clampedBounds.minX
  const depth = clampedBounds.maxZ - clampedBounds.minZ
  ground.scale.set(width, depth, 1)
  ground.position.set((clampedBounds.minX + clampedBounds.maxX) * 0.5, 0, (clampedBounds.minZ + clampedBounds.maxZ) * 0.5)
}

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x52a384 })
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
ground.receiveShadow = true
scene.add(ground)

const castle = new THREE.Group()
castle.position.set(0, 0, 0)
scene.add(castle)
let castleContentLoaded = false

const replaceCastleContent = (object: THREE.Object3D) => {
  while (castle.children.length > 0) {
    castle.remove(castle.children[0]!)
  }
  castle.add(object)
}

const castleCollider: StaticCollider = {
  center: new THREE.Vector3(0, 0, 0),
  halfSize: new THREE.Vector3(3.5, 0.5, 3.5),
  type: 'castle'
}
const staticColliders: StaticCollider[] = [castleCollider]

const updateCastleColliderFromObject = (object: THREE.Object3D) => {
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) return
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  bounds.getSize(size)
  bounds.getCenter(center)
  const minHalfSize = GRID_SIZE * 0.5
  const collisionPadding = 0.15
  castleCollider.center.set(center.x, 0, center.z)
  castleCollider.halfSize.set(
    Math.max(minHalfSize, size.x * 0.5 + collisionPadding),
    0.5,
    Math.max(minHalfSize, size.z * 0.5 + collisionPadding)
  )
}

const gltfLoader = new GLTFLoader()
let towerModelTemplate: THREE.Object3D | null = null
let treeModelTemplate: THREE.Object3D | null = null
let coinModelTemplate: THREE.Object3D | null = null
const towerBallistaRigs = new Map<Tower, BallistaVisualRig>()

const prepareStaticModel = (source: THREE.Object3D, targetSize: THREE.Vector3) => {
  const model = source.clone(true)
  const initialBounds = new THREE.Box3().setFromObject(model)
  if (initialBounds.isEmpty()) return model
  const initialSize = new THREE.Vector3()
  initialBounds.getSize(initialSize)
  const footprint = Math.max(initialSize.x, initialSize.z, 0.001)
  const targetFootprint = targetSize.x * 0.9
  const uniformScale = targetFootprint / footprint
  model.scale.multiplyScalar(uniformScale)

  const fittedBounds = new THREE.Box3().setFromObject(model)
  const fittedCenter = new THREE.Vector3()
  fittedBounds.getCenter(fittedCenter)
  model.position.set(-fittedCenter.x, -fittedBounds.min.y, -fittedCenter.z)
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
  return model
}

const prepareStaticModelPreserveScale = (source: THREE.Object3D) => {
  const model = source.clone(true)
  const bounds = new THREE.Box3().setFromObject(model)
  if (bounds.isEmpty()) return model
  const center = new THREE.Vector3()
  bounds.getCenter(center)
  model.position.set(-center.x, -bounds.min.y, -center.z)
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
  return model
}

const prepareCoinModel = (source: THREE.Object3D) => {
  const model = source.clone(true)
  const initialBounds = new THREE.Box3().setFromObject(model)
  if (initialBounds.isEmpty()) return model
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  initialBounds.getSize(size)
  initialBounds.getCenter(center)
  const largestAxis = Math.max(size.x, size.y, size.z, 0.001)
  const targetAxis = 1.2
  const uniformScale = targetAxis / largestAxis
  model.scale.multiplyScalar(uniformScale)
  model.position.set(-center.x * uniformScale, -center.y * uniformScale, -center.z * uniformScale)
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
  return model
}

const applyTowerVisualToMesh = (mesh: THREE.Mesh, tower?: Tower) => {
  if (!towerModelTemplate) return
  if (mesh.userData.outlineTarget) return
  const rig = createBallistaVisualRig(towerModelTemplate)
  const towerVisual = rig?.root ?? towerModelTemplate.clone(true)
  towerVisual.position.copy(mesh.position)
  towerVisual.position.y -= TOWER_BUILD_SIZE.y * 0.5
  towerVisual.userData.isTowerVisual = true
  scene.add(towerVisual)
  mesh.userData.outlineTarget = towerVisual
  mesh.userData.linkedVisual = towerVisual
  // Keep collision/raycast hitboxes out of render + outline passes.
  mesh.layers.set(HITBOX_LAYER)
  if (tower && rig) {
    towerBallistaRigs.set(tower, rig)
  }
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial
  hitboxMaterial.transparent = true
  hitboxMaterial.opacity = 0
  hitboxMaterial.colorWrite = false
  hitboxMaterial.depthWrite = false
  mesh.castShadow = false
  mesh.receiveShadow = false
}

const applyTreeVisualToMesh = (mesh: THREE.Mesh) => {
  if (!treeModelTemplate) return
  if (mesh.userData.outlineTarget) return
  const treeVisual = treeModelTemplate.clone(true)
  treeVisual.position.copy(mesh.position)
  treeVisual.position.y -= TREE_BUILD_SIZE.y * 0.5
  treeVisual.userData.isTreeVisual = true
  scene.add(treeVisual)
  mesh.userData.outlineTarget = treeVisual
  mesh.userData.linkedVisual = treeVisual
  // Keep collision/raycast hitboxes out of render + outline passes.
  mesh.layers.set(HITBOX_LAYER)
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial
  hitboxMaterial.transparent = true
  hitboxMaterial.opacity = 0
  hitboxMaterial.colorWrite = false
  hitboxMaterial.depthWrite = false
  mesh.castShadow = false
  mesh.receiveShadow = false
}

const syncHudCoinModel = () => {
  coinHudRoot.clear()
  if (!coinModelTemplate) return
  const hudCoin = coinModelTemplate.clone(true)
  hudCoin.scale.multiplyScalar(0.85)
  hudCoin.rotation.y = Math.PI / 7
  coinHudRoot.add(hudCoin)
}

gltfLoader.load(
  towerBallistaModelUrl,
  (gltf) => {
    towerModelTemplate = prepareStaticModelPreserveScale(gltf.scene)
    for (const tower of towers) {
      applyTowerVisualToMesh(tower.mesh, tower)
    }
  },
  undefined,
  (error) => {
    console.error('Failed to load tower model:', error)
  }
)

gltfLoader.load(
  treeModelUrl,
  (gltf) => {
    treeModelTemplate = prepareStaticModelPreserveScale(gltf.scene)
    for (const [collider, state] of structureStore.structureStates.entries()) {
      if (collider.type !== 'tree') continue
      applyTreeVisualToMesh(state.mesh)
    }
  },
  undefined,
  (error) => {
    console.error('Failed to load tree model:', error)
  }
)

gltfLoader.load(
  coinModelUrl,
  (gltf) => {
    coinModelTemplate = prepareCoinModel(gltf.scene)
    syncHudCoinModel()
    setCoinParticleTemplate(coinModelTemplate)
  },
  undefined,
  (error) => {
    console.error('Failed to load coin model:', error)
  }
)

gltfLoader.load(
  castleModelUrl,
  (gltf) => {
    if (castleContentLoaded) return
    castleContentLoaded = true
    const model = gltf.scene
    model.position.set(0, 0, 0)
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
    })
    replaceCastleContent(model)
    updateCastleColliderFromObject(model)
    refreshAllSpawnerPathlines()
  },
  undefined,
  (error) => {
    if (castleContentLoaded) return
    castleContentLoaded = true
    console.error('Failed to load castle model:', error)
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshStandardMaterial({ color: 0xe0c34a })
    )
    fallback.rotation.x = -Math.PI / 2
    fallback.position.set(0, 0.02, 0)
    fallback.castShadow = true
    fallback.receiveShadow = true
    replaceCastleContent(fallback)
    updateCastleColliderFromObject(fallback)
    refreshAllSpawnerPathlines()
  }
)
const mobs: MobEntity[] = []
const towers: Tower[] = []
let selectedTower: Tower | null = null
const structureStore = new StructureStore(
  scene,
  staticColliders,
  towers,
  (tower) => {
    if (selectedTower === tower) selectedTower = null
  },
  (added, removed = []) => applyObstacleDelta(added, removed)
)

// Add basic walls on the map
const addMapWall = (center: THREE.Vector3, halfSize: THREE.Vector3) => {
  const halfGrid = GRID_SIZE * 0.5
  const sizeXTiles = Math.round((halfSize.x * 2) / GRID_SIZE)
  const sizeZTiles = Math.round((halfSize.z * 2) / GRID_SIZE)
  const snapValue = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE
  const snapAxis = (value: number, sizeTiles: number) => {
    if (sizeTiles % 2 === 0) {
      return Math.round((value - halfGrid) / GRID_SIZE) * GRID_SIZE + halfGrid
    }
    return snapValue(value)
  }
  const snappedCenter = new THREE.Vector3(
    snapAxis(center.x, sizeXTiles),
    center.y,
    snapAxis(center.z, sizeZTiles)
  )
  const startX = snappedCenter.x - (sizeXTiles - 1) * halfGrid
  const startZ = snappedCenter.z - (sizeZTiles - 1) * halfGrid
  const tileHalf = new THREE.Vector3(GRID_SIZE * 0.5, halfSize.y, GRID_SIZE * 0.5)

  for (let x = 0; x < sizeXTiles; x += 1) {
    for (let z = 0; z < sizeZTiles; z += 1) {
      const tileCenter = new THREE.Vector3(
        startX + x * GRID_SIZE,
        snappedCenter.y,
        startZ + z * GRID_SIZE
      )
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(GRID_SIZE, halfSize.y * 2, GRID_SIZE),
        new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
      )
      mesh.position.copy(tileCenter)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      structureStore.addWallCollider(tileCenter, tileHalf, mesh, WALL_HP)
    }
  }
}

// Add some basic walls for mobs to navigate around
addMapWall(new THREE.Vector3(8, 0.5, 8), new THREE.Vector3(0.5, 0.5, 4))
addMapWall(new THREE.Vector3(-8, 0.5, -8), new THREE.Vector3(4, 0.5, 0.5))
addMapWall(new THREE.Vector3(10, 0.5, -5), new THREE.Vector3(3, 0.5, 0.5))
addMapWall(new THREE.Vector3(-10, 0.5, 5), new THREE.Vector3(0.5, 0.5, 3))
addMapWall(new THREE.Vector3(0, 0.5, 12), new THREE.Vector3(5, 0.5, 0.5))

// Initialize spatial grid and lane path caches
const spatialGrid = new SpatialGrid(SPATIAL_GRID_CELL_SIZE)
const castleGoal = new THREE.Vector3(0, 0, 0)
const borderDoors = getAllBorderDoors(WORLD_BOUNDS)
const waveAndSpawnSystem = createWaveAndSpawnSystem({
  borderDoors,
  minSpawners: WAVE_MIN_SPAWNERS,
  maxSpawners: WAVE_MAX_SPAWNERS,
  baseSpawnRate: WAVE_SPAWNER_BASE_RATE,
  random
})
const activeWaveSpawners: WaveSpawner[] = []
const spawnerById = new Map<string, WaveSpawner>()
const spawnerPathlineCache = new Map<string, LanePathResult>()
const pendingSpawnerPathRefresh = new Set<string>()
const pendingSpawnerPathOrder: string[] = []
const PATHLINE_REFRESH_BUDGET_PER_FRAME = 2
const collisionNearbyScratch: Entity[] = []
const rangeCandidateScratch: Entity[] = []
const spawnerRouteOverlay = new SpawnerPathOverlay(scene)

const mobInstanceMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(MOB_WIDTH, MOB_HEIGHT, MOB_WIDTH),
  new THREE.MeshStandardMaterial({ color: 0xff7a7a }),
  MOB_INSTANCE_CAP
)
mobInstanceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
mobInstanceMesh.frustumCulled = false
mobInstanceMesh.castShadow = true
mobInstanceMesh.receiveShadow = true
scene.add(mobInstanceMesh)
const mobLogicGeometry = new THREE.BoxGeometry(MOB_WIDTH, MOB_HEIGHT, MOB_WIDTH)
const mobLogicMaterial = new THREE.MeshBasicMaterial({ visible: false })
const mobInstanceDummy = new THREE.Object3D()
const normalMobColor = new THREE.Color(0xff7a7a)
const berserkMobColor = new THREE.Color(0xff3a3a)

const getSpawnerOutwardNormal = (pos: THREE.Vector3) => {
  if (Math.abs(pos.x) >= Math.abs(pos.z)) {
    return new THREE.Vector3(Math.sign(pos.x || 1), 0, 0)
  }
  return new THREE.Vector3(0, 0, Math.sign(pos.z || 1))
}

const getSpawnerTangent = (pos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(pos)
  return new THREE.Vector3(-normal.z, 0, normal.x)
}

const getSpawnerEntryPoint = (pos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(pos)
  const x = Math.round(pos.x - normal.x * GRID_SIZE)
  const z = Math.round(pos.z - normal.z * GRID_SIZE)
  return new THREE.Vector3(
    clamp(x, -WORLD_BOUNDS + GRID_SIZE, WORLD_BOUNDS - GRID_SIZE),
    0,
    clamp(z, -WORLD_BOUNDS + GRID_SIZE, WORLD_BOUNDS - GRID_SIZE)
  )
}

const getForwardWaypointIndex = (pos: THREE.Vector3, waypoints: THREE.Vector3[]): number => {
  if (waypoints.length <= 1) return 0
  let bestIdx = 0
  let bestDistSq = Number.POSITIVE_INFINITY
  for (let i = 0; i < waypoints.length; i += 1) {
    const wp = waypoints[i]!
    const dx = wp.x - pos.x
    const dz = wp.z - pos.z
    const distSq = dx * dx + dz * dz
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestIdx = i
    }
  }
  // Prevent backtracking toward waypoints behind current progress.
  return Math.min(bestIdx + 1, waypoints.length - 1)
}

const getSpawnCandidatePosition = (spawner: WaveSpawner) => {
  const normal = getSpawnerOutwardNormal(spawner.position)
  const tangent = getSpawnerTangent(spawner.position)
  const lateral = (Math.random() - 0.5) * 10
  const outward = 0.25 + Math.random() * 9.5
  const pos = spawner.position
    .clone()
    .addScaledVector(tangent, lateral)
    .addScaledVector(normal, outward)
  return new THREE.Vector3(
    clamp(pos.x, -WORLD_BOUNDS - 10, WORLD_BOUNDS + 10),
    0,
    clamp(pos.z, -WORLD_BOUNDS - 10, WORLD_BOUNDS + 10)
  )
}

const canSpawnAt = (pos: THREE.Vector3, radius = MOB_WIDTH * 0.5) => {
  const minDist = radius * 3.2
  const minDistSq = minDist * minDist
  for (const mob of mobs) {
    const dx = mob.mesh.position.x - pos.x
    const dz = mob.mesh.position.z - pos.z
    if (dx * dx + dz * dz < minDistSq) return false
  }
  return true
}

const getSpawnContainerCorners = (spawnerPos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(spawnerPos)
  const tangent = getSpawnerTangent(spawnerPos)
  const center = spawnerPos.clone().addScaledVector(normal, 5)
  const half = 5
  return [
    center.clone().addScaledVector(tangent, -half).addScaledVector(normal, -half),
    center.clone().addScaledVector(tangent, half).addScaledVector(normal, -half),
    center.clone().addScaledVector(tangent, half).addScaledVector(normal, half),
    center.clone().addScaledVector(tangent, -half).addScaledVector(normal, half)
  ]
}

const isPointInsideCastle = (point: THREE.Vector3) => (
  Math.abs(point.x - castleCollider.center.x) <= castleCollider.halfSize.x &&
  Math.abs(point.z - castleCollider.center.z) <= castleCollider.halfSize.z
)

const getCastleBoundaryIntersection = (from: THREE.Vector3, to: THREE.Vector3) => {
  const minX = castleCollider.center.x - castleCollider.halfSize.x
  const maxX = castleCollider.center.x + castleCollider.halfSize.x
  const minZ = castleCollider.center.z - castleCollider.halfSize.z
  const maxZ = castleCollider.center.z + castleCollider.halfSize.z
  const dx = to.x - from.x
  const dz = to.z - from.z
  const eps = 1e-6
  const candidates: number[] = []

  if (Math.abs(dx) > eps) {
    candidates.push((minX - from.x) / dx, (maxX - from.x) / dx)
  }
  if (Math.abs(dz) > eps) {
    candidates.push((minZ - from.z) / dz, (maxZ - from.z) / dz)
  }

  let bestT = Number.POSITIVE_INFINITY
  for (const t of candidates) {
    if (t < 0 || t > 1) continue
    const x = from.x + dx * t
    const z = from.z + dz * t
    const onFaceX = x >= minX - eps && x <= maxX + eps
    const onFaceZ = z >= minZ - eps && z <= maxZ + eps
    if (!onFaceX || !onFaceZ) continue
    if (t < bestT) bestT = t
  }

  if (!Number.isFinite(bestT)) return to.clone()
  return new THREE.Vector3(from.x + dx * bestT, to.y, from.z + dz * bestT)
}

const trimPathToCastleBoundary = (points: THREE.Vector3[]) => {
  if (points.length < 2) return points.map((point) => point.clone())

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!
    const curr = points[i]!
    if (!isPointInsideCastle(prev) && isPointInsideCastle(curr)) {
      const clipped = points.slice(0, i).map((point) => point.clone())
      clipped.push(getCastleBoundaryIntersection(prev, curr))
      return clipped
    }
  }

  return points.map((point) => point.clone())
}

const refreshSpawnerPathline = (spawner: WaveSpawner) => {
  const entry = getSpawnerEntryPoint(spawner.position)
  const route = computeLanePathAStar({
    start: entry,
    goal: castleGoal,
    colliders: staticColliders,
    worldBounds: WORLD_BOUNDS,
    resolution: GRID_SIZE,
    maxVisited: 240_000
  })
  spawner.routeState = route.state
  spawnerPathlineCache.set(spawner.id, route)
  const displayPoints = trimPathToCastleBoundary(route.points)
  spawnerRouteOverlay.upsert(spawner.id, displayPoints, route.state)
  spawnContainerOverlay.upsert(spawner.id, getSpawnContainerCorners(spawner.position))
  for (const mob of mobs) {
    if (mob.spawnerId !== spawner.id) continue
    mob.laneBlocked = route.state !== 'reachable'
    mob.waypoints = route.state === 'reachable' ? route.points : undefined
    mob.waypointIndex = route.state === 'reachable'
      ? getForwardWaypointIndex(mob.mesh.position, route.points)
      : undefined
  }
}

const enqueueSpawnerPathRefresh = (spawnerId: string) => {
  if (pendingSpawnerPathRefresh.has(spawnerId)) return
  pendingSpawnerPathRefresh.add(spawnerId)
  pendingSpawnerPathOrder.push(spawnerId)
}

const processSpawnerPathlineQueue = (budget = PATHLINE_REFRESH_BUDGET_PER_FRAME) => {
  let processed = 0
  while (processed < budget && pendingSpawnerPathOrder.length > 0) {
    const spawnerId = pendingSpawnerPathOrder.shift()!
    pendingSpawnerPathRefresh.delete(spawnerId)
    const spawner = spawnerById.get(spawnerId)
    if (!spawner) continue
    refreshSpawnerPathline(spawner)
    processed += 1
  }
}

const refreshAllSpawnerPathlines = () => {
  for (const spawner of activeWaveSpawners) {
    refreshSpawnerPathline(spawner)
  }
}

const applyObstacleDelta = (added: StaticCollider[], removed: StaticCollider[] = []) => {
  if (added.length === 0 && removed.length === 0) return
  if (activeWaveSpawners.length === 0) return

  const gridSize = Math.max(2, Math.ceil((WORLD_BOUNDS * 2) / GRID_SIZE) + 1)
  const dirty = computeDirtyBounds(added, removed, WORLD_BOUNDS, GRID_SIZE, gridSize, 0.6)
  if (!dirty) return

  const dirtyMinX = -WORLD_BOUNDS + dirty.minX * GRID_SIZE - GRID_SIZE
  const dirtyMaxX = -WORLD_BOUNDS + dirty.maxX * GRID_SIZE + GRID_SIZE
  const dirtyMinZ = -WORLD_BOUNDS + dirty.minZ * GRID_SIZE - GRID_SIZE
  const dirtyMaxZ = -WORLD_BOUNDS + dirty.maxZ * GRID_SIZE + GRID_SIZE

  for (const spawner of activeWaveSpawners) {
    const route = spawnerPathlineCache.get(spawner.id)
    if (!route || route.points.length === 0) {
      enqueueSpawnerPathRefresh(spawner.id)
      continue
    }

    let affected = false
    for (const point of route.points) {
      if (point.x >= dirtyMinX && point.x <= dirtyMaxX && point.z >= dirtyMinZ && point.z <= dirtyMaxZ) {
        affected = true
        break
      }
    }
    if (affected) enqueueSpawnerPathRefresh(spawner.id)
  }
}

const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.001, 0x4ad1ff)
scene.add(arrow)

const selectionArrowGroup = new THREE.Group()
const arrowShaftLength = 1.0
const arrowHeadLength = 0.6
const arrowHeadRadius = 0.5
const arrowShaftRadius = 0.08
const shaftGeometry = new THREE.CylinderGeometry(arrowShaftRadius, arrowShaftRadius, arrowShaftLength, 8)
const shaftMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial)
// Cone is rotated 180deg (pointing down)
// In THREE.js ConeGeometry, tip is at y=0, base at y=-height
// After rotation and positioning, tip is at head.position.y
// Shaft should start at tip and extend upward
shaft.position.y = -arrowHeadLength + arrowShaftLength / 2
selectionArrowGroup.add(shaft)
const headGeometry = new THREE.ConeGeometry(arrowHeadRadius, arrowHeadLength, 8)
const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
const head = new THREE.Mesh(headGeometry, headMaterial)
head.rotation.x = Math.PI
head.position.y = -arrowHeadLength
selectionArrowGroup.add(head)
selectionArrowGroup.visible = false
const selectionArrow = selectionArrowGroup
scene.add(selectionArrow)

const laserMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b3b })
const laserGeometry = new THREE.CylinderGeometry(0.075, 0.075, 1, 8)
const laser = new THREE.Mesh(laserGeometry, laserMaterial)
laser.visible = false
laser.rotation.order = 'YXZ'
scene.add(laser)

const towerLaserMaterial = new THREE.MeshBasicMaterial({ color: 0x7ad1ff })
const towerLaserGeometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 8)
const towerRangeMaterial = new THREE.MeshBasicMaterial({
  color: 0x7ad1ff,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide
})

const raycaster = new THREE.Raycaster()
raycaster.layers.enable(HITBOX_LAYER)
const pointer = new THREE.Vector2()

const makeCapsule = (color: number) => {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_WIDTH * 0.5, PLAYER_HEIGHT - PLAYER_WIDTH, 4, 10),
    new THREE.MeshStandardMaterial({ color })
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

const player: PlayerEntity = {
  mesh: makeCapsule(0x62ff9a),
  radius: PLAYER_COLLISION_RADIUS,
  speed: PLAYER_SPEED,
  velocity: new THREE.Vector3(),
  target: new THREE.Vector3(0, 0, 0),
  kind: 'player',
  baseY: PLAYER_HEIGHT * 0.5,
  username: 'u/PlayerOne'
}
player.mesh.position.set(4, player.baseY, 4)
player.target.set(player.mesh.position.x, 0, player.mesh.position.z)
scene.add(player.mesh)

const npcs: NpcEntity[] = []
const makeNpc = (pos: THREE.Vector3, color: number, username: string) => {
  const npc: NpcEntity = {
    mesh: makeCapsule(color),
    radius: PLAYER_COLLISION_RADIUS,
    speed: NPC_SPEED,
    velocity: new THREE.Vector3(),
    target: pos.clone(),
    kind: 'npc',
    baseY: PLAYER_HEIGHT * 0.5,
    username
  }
  npc.mesh.position.copy(pos).setY(npc.baseY)
  scene.add(npc.mesh)
  npcs.push(npc)
}
makeNpc(new THREE.Vector3(-6, 0, 6), 0xffc857, 'u/NPC_Alpha')
makeNpc(new THREE.Vector3(-6, 0, -6), 0xb48cff, 'u/NPC_Beta')

const selection = createSelectionState()
const selectedStructures = selection.selectedStructures
let activePointerId: number | null = null
const syncSelectedStructureOutline = () => {
  const structureSelectedObjects: THREE.Object3D[] = []
  for (const collider of selectedStructures) {
    const mesh = structureStore.structureStates.get(collider)?.mesh
    if (!mesh) continue
    const outlineTarget = mesh.userData.outlineTarget as THREE.Object3D | undefined
    structureSelectedObjects.push(outlineTarget ?? mesh)
  }
  structureOutlinePass.selectedObjects = structureSelectedObjects
  treeOutlinePass.selectedObjects = []
}

const applyTowerUpgrade = (tower: Tower, upgradeId: TowerUpgradeId) => {
  if (upgradeId === 'range') {
    tower.rangeLevel += 1
    tower.range += 1
  } else if (upgradeId === 'damage') {
    tower.damageLevel += 1
    tower.damage += 1
  } else if (upgradeId === 'speed') {
    tower.speedLevel += 1
    const shotsPerSecond = 4 + tower.speedLevel * 2
    tower.shootCadence = 1 / shotsPerSecond
  }
  tower.rangeRing.geometry.dispose()
  tower.rangeRing.geometry = new THREE.RingGeometry(tower.range - 0.12, tower.range, 32)
}

const createTowerAt = (snapped: THREE.Vector3, typeId: TowerTypeId, builtBy: string): Tower => {
  const typeConfig = getTowerType(typeId)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(TOWER_BUILD_SIZE.x, TOWER_BUILD_SIZE.y, TOWER_BUILD_SIZE.z),
    new THREE.MeshStandardMaterial({
      color: typeConfig.color,
      transparent: true,
      opacity: towerModelTemplate ? 0.01 : 1
    })
  )
  mesh.position.copy(snapped)
  if (!towerModelTemplate) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  scene.add(mesh)

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(typeConfig.range - 0.12, typeConfig.range, 32),
    towerRangeMaterial
  )
  rangeRing.rotation.x = -Math.PI / 2
  rangeRing.position.set(snapped.x, 0.02, snapped.z)
  rangeRing.visible = false
  scene.add(rangeRing)

  const towerLaser = new THREE.Mesh(towerLaserGeometry, towerLaserMaterial)
  towerLaser.visible = false
  towerLaser.rotation.order = 'YXZ'
  scene.add(towerLaser)

  const tower: Tower = {
    mesh,
    range: typeConfig.range,
    damage: typeConfig.damage,
    rangeLevel: 0,
    damageLevel: 0,
    speedLevel: 0,
    killCount: 0,
    builtBy,
    shootCooldown: 0,
    shootCadence: typeConfig.shootCadence,
    laserVisibleTime: 0,
    laser: towerLaser,
    rangeRing,
    typeId,
    level: typeConfig.level
  }
  if (towerModelTemplate) {
    applyTowerVisualToMesh(mesh, tower)
  }
  towers.push(tower)
  return tower
}

const makeMob = (spawner: WaveSpawner) => {
  const pos = getSpawnCandidatePosition(spawner)
  if (!canSpawnAt(pos)) return false
  const mob = new THREE.Mesh(mobLogicGeometry, mobLogicMaterial)
  mob.position.copy(pos).setY(MOB_HEIGHT * 0.5)
  const lanePath = spawnerPathlineCache.get(spawner.id)
  const hasLane = lanePath?.state === 'reachable'
  const entryPoint = getSpawnerEntryPoint(spawner.position)
  const laneWaypoints = hasLane
    ? [entryPoint.clone(), ...lanePath!.points.slice(1).map((p) => p.clone())]
    : undefined
  const maxHp = 3
  mobs.push({
    mesh: mob,
    radius: MOB_WIDTH * 0.5,
    speed: MOB_SPEED,
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(0, 0, 0),
    kind: 'mob',
    hp: maxHp,
    maxHp: maxHp,
    baseY: MOB_HEIGHT * 0.5,
    waypoints: laneWaypoints,
    waypointIndex: hasLane ? 0 : undefined,
    berserkMode: false,
    berserkTarget: null,
    laneBlocked: !hasLane,
    siegeAttackCooldown: 0,
    unreachableTime: 0,
    lastHitBy: undefined,
    spawnerId: spawner.id
  })
  return true
}

const gameState = createGameState(ENERGY_CAP)
let isDraggingWall = false
let wallDragStart: THREE.Vector3 | null = null
let wallDragEnd: THREE.Vector3 | null = null
let wallDragValidPositions: THREE.Vector3[] = []
const inputController = createInputController()
const keyboardForward = new THREE.Vector3()
const keyboardRight = new THREE.Vector3()
const keyboardMoveDir = new THREE.Vector3()
let wasKeyboardMoving = false
const EVENT_BANNER_DURATION = 2.4

type EnergyTrail = {
  mesh: THREE.Object3D
  materials: THREE.Material[]
  startX: number
  startY: number
  control1X: number
  control1Y: number
  control2X: number
  control2Y: number
  endX: number
  endY: number
  elapsed: number
  duration: number
  reward: number
  spinStartDeg: number
  spinTotalDeg: number
  pitchStartDeg: number
  pitchTotalDeg: number
  rollStartDeg: number
  rollTotalDeg: number
  baseScale: number
}

type FloatingDamageText = {
  el: HTMLDivElement
  target: Entity | null
  worldPos: THREE.Vector3
  elapsed: number
  duration: number
  driftX: number
}

const getUpgradeEnergyCost = (upgradeId: TowerUpgradeId): number => {
  if (upgradeId === 'range') return ENERGY_COST_UPGRADE_RANGE
  if (upgradeId === 'damage') return ENERGY_COST_UPGRADE_DAMAGE
  return ENERGY_COST_UPGRADE_SPEED
}

const getDeleteEnergyCost = (collider: DestructibleCollider): number => {
  return collider.type === 'tower' ? ENERGY_COST_DELETE_TOWER : ENERGY_COST_DELETE_WALL
}

const particleSystem = createParticleSystem(scene)
const spawnCubeEffects = particleSystem.spawnCubeEffects
const spawnMobDeathEffects = particleSystem.spawnMobDeathEffects
const setCoinParticleTemplate = particleSystem.setCoinParticleTemplate
const updateParticles = particleSystem.updateParticles

// Health bars and username labels using HTML overlays
const healthBarContainer = document.createElement('div')
healthBarContainer.style.position = 'fixed'
healthBarContainer.style.top = '0'
healthBarContainer.style.left = '0'
healthBarContainer.style.width = '100%'
healthBarContainer.style.height = '100%'
healthBarContainer.style.pointerEvents = 'none'
healthBarContainer.style.zIndex = '999'
app.appendChild(healthBarContainer)

const usernameContainer = document.createElement('div')
usernameContainer.style.position = 'fixed'
usernameContainer.style.top = '0'
usernameContainer.style.left = '0'
usernameContainer.style.width = '100%'
usernameContainer.style.height = '100%'
usernameContainer.style.pointerEvents = 'none'
usernameContainer.style.zIndex = '1001'
app.appendChild(usernameContainer)

const damageTextContainer = document.createElement('div')
damageTextContainer.style.position = 'fixed'
damageTextContainer.style.top = '0'
damageTextContainer.style.left = '0'
damageTextContainer.style.width = '100%'
damageTextContainer.style.height = '100%'
damageTextContainer.style.pointerEvents = 'none'
damageTextContainer.style.zIndex = '1200'
app.appendChild(damageTextContainer)

const activeEnergyTrails: EnergyTrail[] = []
const activeDamageTexts: FloatingDamageText[] = []
const CRIT_CHANCE = 1 / 8
const CRIT_MULTIPLIER = 2

const updateCoinHudView = (delta: number) => {
  const rect = coinHudCanvasEl.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  coinHudRenderer.setSize(width, height, false)
  coinHudCamera.aspect = width / height
  coinHudCamera.updateProjectionMatrix()
  if (coinHudRoot.children.length > 0) {
    const spinSpeed = 1.75
    coinHudRoot.rotation.y += delta * spinSpeed
  }
  coinHudRenderer.render(coinHudScene, coinHudCamera)
}

const syncCoinTrailViewport = () => {
  coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false)
  coinTrailCamera.left = 0
  coinTrailCamera.right = window.innerWidth
  coinTrailCamera.top = window.innerHeight
  coinTrailCamera.bottom = 0
  coinTrailCamera.updateProjectionMatrix()
}

const syncMinimapCanvasSize = () => {
  const rect = minimapCanvasEl.getBoundingClientRect()
  const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio, 2))
  const width = Math.max(1, Math.round(rect.width * pixelRatio))
  const height = Math.max(1, Math.round(rect.height * pixelRatio))
  if (minimapCanvasEl.width !== width || minimapCanvasEl.height !== height) {
    minimapCanvasEl.width = width
    minimapCanvasEl.height = height
  }
}

const drawMinimap = () => {
  if (!minimapCtx) return
  const width = minimapCanvasEl.width
  const height = minimapCanvasEl.height
  if (width <= 0 || height <= 0) return

  minimapCtx.clearRect(0, 0, width, height)
  minimapCtx.fillStyle = 'rgba(22, 28, 35, 0.92)'
  minimapCtx.fillRect(0, 0, width, height)

  // Keep minimap orientation aligned with the camera view.
  const forward3 = camera.getWorldDirection(new THREE.Vector3())
  const forward2 = new THREE.Vector2(forward3.x, forward3.z)
  if (forward2.lengthSq() <= 1e-5) {
    forward2.set(0, -1)
  } else {
    forward2.normalize()
  }
  const right2 = new THREE.Vector2(-forward2.y, forward2.x)
  const axisExtent = WORLD_BOUNDS * Math.SQRT2

  const worldToMap = (x: number, z: number) => {
    const rx = (x * right2.x + z * right2.y) / axisExtent
    const ry = (x * forward2.x + z * forward2.y) / axisExtent
    return {
      x: clamp((rx + 1) * 0.5, 0, 1) * width,
      y: clamp((1 - (ry + 1) * 0.5), 0, 1) * height
    }
  }

  const center = worldToMap(0, 0)
  minimapCtx.fillStyle = '#f0d066'
  minimapCtx.fillRect(center.x - 1.5, center.y - 1.5, 3, 3)

  const playerPoint = worldToMap(player.mesh.position.x, player.mesh.position.z)
  minimapCtx.fillStyle = '#62ff9a'
  minimapCtx.beginPath()
  minimapCtx.arc(playerPoint.x, playerPoint.y, 2.6, 0, Math.PI * 2)
  minimapCtx.fill()

  minimapCtx.fillStyle = '#ff6a6a'
  for (const mob of mobs) {
    const point = worldToMap(mob.mesh.position.x, mob.mesh.position.z)
    minimapCtx.beginPath()
    minimapCtx.arc(point.x, point.y, 1.8, 0, Math.PI * 2)
    minimapCtx.fill()
  }
}

const worldToScreen = (worldPos: THREE.Vector3): { x: number, y: number } | null => {
  const vector = worldPos.clone()
  vector.project(camera)
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight
  return { x, y }
}

const updateViewportFogCenter = () => {
  const anchor = worldToScreen(player.mesh.position.clone().setY(player.baseY))
  if (!anchor) return
  const xPct = Math.max(0, Math.min(100, (anchor.x / window.innerWidth) * 100))
  const yPct = Math.max(0, Math.min(100, (anchor.y / window.innerHeight) * 100))
  viewportFogEl.style.setProperty('--fog-center-x', `${xPct}%`)
  viewportFogEl.style.setProperty('--fog-center-y', `${yPct}%`)
}

const getEnergyCounterAnchor = () => {
  const rect = coinHudCanvasEl.getBoundingClientRect()
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }
}

const addEnergy = (amount: number, withPop = false) => {
  gameState.energy = Math.min(ENERGY_CAP, gameState.energy + amount)
  if (withPop) {
    gameState.energyPopTimer = 0.2
  }
}

const spendEnergy = (amount: number) => {
  if (gameState.energy < amount) return false
  gameState.energy = Math.max(0, gameState.energy - amount)
  return true
}

const createTrailCoinInstance = () => {
  if (!coinModelTemplate) return null
  const mesh = coinModelTemplate.clone(true)
  const materials: THREE.Material[] = []
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const source = child.material
    if (Array.isArray(source)) {
      const cloned = source.map((material) => {
        const next = material.clone()
        next.transparent = true
        next.depthWrite = false
        next.depthTest = false
        return next
      })
      child.material = cloned
      materials.push(...cloned)
      return
    }
    const cloned = source.clone()
    cloned.transparent = true
    cloned.depthWrite = false
    cloned.depthTest = false
    child.material = cloned
    materials.push(cloned)
  })
  return { mesh, materials }
}

const spawnEnergyTrail = (fromWorldPos: THREE.Vector3, reward: number) => {
  const start = worldToScreen(fromWorldPos.clone().setY(fromWorldPos.y + 0.6))
  if (!start) {
    addEnergy(reward, true)
    return
  }
  const trailCoin = createTrailCoinInstance()
  if (!trailCoin) {
    addEnergy(reward, true)
    return
  }
  coinTrailScene.add(trailCoin.mesh)
  const end = getEnergyCounterAnchor()
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dist = Math.hypot(dx, dy)
  const dirX = dist > 0.001 ? dx / dist : 0
  const dirY = dist > 0.001 ? dy / dist : -1
  const perpX = -dirY
  const perpY = dirX
  const baseArc = Math.min(210, Math.max(80, dist * (0.34 + Math.random() * 0.16)))
  const sideA = (Math.random() - 0.5) * Math.min(190, Math.max(60, dist * 0.45))
  const sideB = (Math.random() - 0.5) * Math.min(70, Math.max(20, dist * 0.18))
  const progress1 = 0.22 + Math.random() * 0.16
  const control1X = start.x + dx * progress1 + perpX * sideA
  const control1Y = start.y + dy * progress1 + perpY * sideA - baseArc * (0.9 + Math.random() * 0.45)
  const approachHeight = Math.min(180, Math.max(70, dist * (0.28 + Math.random() * 0.14)))
  const control2X = end.x + sideB
  const control2Y = end.y + approachHeight
  const spinStartDeg = Math.random() * 360
  const spinDirection = Math.random() < 0.5 ? -1 : 1
  const spinTotalDeg = spinDirection * (360 + Math.random() * 540)
  const pitchStartDeg = -16 + Math.random() * 32
  const pitchTotalDeg = -30 + Math.random() * 60
  const rollStartDeg = -14 + Math.random() * 28
  const rollTotalDeg = -32 + Math.random() * 64
  const baseScale = 15 + Math.random() * 8
  activeEnergyTrails.push({
    mesh: trailCoin.mesh,
    materials: trailCoin.materials,
    startX: start.x,
    startY: start.y,
    control1X,
    control1Y,
    control2X,
    control2Y,
    endX: end.x,
    endY: end.y,
    elapsed: 0,
    duration: 0.44 + Math.random() * 0.16,
    reward,
    spinStartDeg,
    spinTotalDeg,
    pitchStartDeg,
    pitchTotalDeg,
    rollStartDeg,
    rollTotalDeg,
    baseScale
  })
}

const updateEnergyTrails = (delta: number) => {
  for (let i = activeEnergyTrails.length - 1; i >= 0; i -= 1) {
    const trail = activeEnergyTrails[i]!
    trail.elapsed += delta
    const t = Math.min(1, trail.elapsed / trail.duration)
    const easeT = 1 - Math.pow(1 - t, 2)
    const u = 1 - easeT
    const x =
      u * u * u * trail.startX +
      3 * u * u * easeT * trail.control1X +
      3 * u * easeT * easeT * trail.control2X +
      easeT * easeT * easeT * trail.endX
    const y =
      u * u * u * trail.startY +
      3 * u * u * easeT * trail.control1Y +
      3 * u * easeT * easeT * trail.control2Y +
      easeT * easeT * easeT * trail.endY
    const rotation = trail.spinStartDeg + trail.spinTotalDeg * easeT
    const pitch = trail.pitchStartDeg + trail.pitchTotalDeg * easeT
    const roll = trail.rollStartDeg + trail.rollTotalDeg * easeT
    const scale = trail.baseScale * (1 - t * 0.05)
    trail.mesh.position.set(x, window.innerHeight - y, 0)
    trail.mesh.rotation.set(
      THREE.MathUtils.degToRad(pitch),
      THREE.MathUtils.degToRad(rotation),
      THREE.MathUtils.degToRad(roll)
    )
    trail.mesh.scale.setScalar(scale)
    for (const material of trail.materials) {
      if ('opacity' in material) {
        ;(material as THREE.Material & { opacity: number }).opacity = 1
      }
    }
    if (t >= 1) {
      coinTrailScene.remove(trail.mesh)
      for (const material of trail.materials) {
        material.dispose()
      }
      activeEnergyTrails.splice(i, 1)
      addEnergy(trail.reward, true)
    }
  }
}

const rollAttackDamage = (baseDamage: number) => {
  const isCrit = Math.random() < CRIT_CHANCE
  return {
    damage: isCrit ? baseDamage * CRIT_MULTIPLIER : baseDamage,
    isCrit
  }
}

const spawnFloatingDamageText = (mob: Entity, damage: number, source: 'player' | 'tower', isCrit = false) => {
  if (damage <= 0) return
  const text = document.createElement('div')
  const classes = ['floating-damage-text']
  if (source === 'player') {
    classes.push('floating-damage-text--player')
  } else {
    classes.push('floating-damage-text--tower')
  }
  if (isCrit) classes.push('floating-damage-text--crit')
  text.className = classes.join(' ')
  text.textContent = `${Math.round(damage)}${isCrit ? '!' : ''}`
  damageTextContainer.appendChild(text)
  activeDamageTexts.push({
    el: text,
    target: mob,
    worldPos: mob.mesh.position.clone().setY(mob.baseY + 1.1),
    elapsed: 0,
    duration: 0.65,
    driftX: (Math.random() - 0.5) * 20
  })
}

const updateFloatingDamageTexts = (delta: number) => {
  for (let i = activeDamageTexts.length - 1; i >= 0; i -= 1) {
    const text = activeDamageTexts[i]!
    text.elapsed += delta
    const t = Math.min(1, text.elapsed / text.duration)
    const easeOut = 1 - Math.pow(1 - t, 2)

    if (text.target !== null) {
      text.worldPos.copy(text.target.mesh.position).setY(text.target.baseY + 1.1)
    }

    const liftedWorldPos = text.worldPos.clone().setY(text.worldPos.y + easeOut * 0.55)
    const screenPos = worldToScreen(liftedWorldPos)
    if (screenPos) {
      const swayX = Math.sin(t * Math.PI) * text.driftX
      text.el.style.left = `${screenPos.x + swayX}px`
      text.el.style.top = `${screenPos.y}px`
      text.el.style.opacity = String(1 - t)
      text.el.style.transform = `translate(-50%, -100%) scale(${1 + (1 - t) * 0.2})`
    }

    if (t >= 1) {
      text.el.remove()
      activeDamageTexts.splice(i, 1)
    }
  }
}

const updateHealthBars = () => {
  // Clear existing health bars
  healthBarContainer.innerHTML = ''
}

const updateUsernameLabels = () => {
  // Clear existing labels
  usernameContainer.innerHTML = ''
  
  const entities = [player, ...npcs]
  for (const entity of entities) {
    if (!entity.username) continue
    const screenPos = worldToScreen(
      entity.mesh.position.clone().setY(entity.baseY + 1.0)
    )
    if (!screenPos) continue
    
    const label = document.createElement('div')
    label.textContent = entity.username
    label.style.position = 'absolute'
    label.style.left = `${screenPos.x}px`
    label.style.top = `${screenPos.y}px`
    label.style.transform = 'translate(-50%, -100%)'
    label.style.color = '#fff'
    label.style.fontSize = '12px'
    label.style.fontWeight = '600'
    label.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'
    label.style.whiteSpace = 'nowrap'
    label.style.pointerEvents = 'none'
    
    usernameContainer.appendChild(label)
  }
}

const buildPreview = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x66ff66, transparent: true, opacity: 0.4 })
)
buildPreview.visible = false
scene.add(buildPreview)

const canAffordBuildMode = (mode: BuildMode) => {
  if (mode === 'wall') return gameState.energy >= ENERGY_COST_WALL
  if (mode === 'tower') return gameState.energy >= ENERGY_COST_TOWER
  return true
}

const setBuildMode = (mode: BuildMode) => {
  if (mode !== 'off' && !canAffordBuildMode(mode)) {
    triggerEventBanner('Not enough coins')
    return
  }
  if (gameState.buildMode === mode) {
    // Toggle off if clicking same button
    gameState.buildMode = 'off'
  } else {
    gameState.buildMode = mode
  }
  buildWallBtn.classList.toggle('active', gameState.buildMode === 'wall')
  buildTowerBtn.classList.toggle('active', gameState.buildMode === 'tower')
  buildPreview.visible = gameState.buildMode !== 'off'
  if (gameState.buildMode !== 'off') {
    clearSelectionState(selection)
    selectedTower = selection.selectedTower
  }
  isDraggingWall = false
  wallDragStart = null
  wallDragEnd = null
  wallDragValidPositions = []
}

const setSelectedStructures = (colliders: DestructibleCollider[]) => {
  setSelectedStructuresState(selection, colliders, structureStore)
  selectedTower = selection.selectedTower
}

const clearSelection = () => {
  clearSelectionState(selection)
  selectedTower = selection.selectedTower
}

const isColliderInRange = (collider: DestructibleCollider, range: number) => {
  return isColliderInRangeFromState(player, collider, range)
}

const getSelectedInRange = () =>
  getSelectedInRangeFromState(selection, player, SELECTION_RADIUS)

const getSingleSelectedTower = (): Tower | null => {
  return getSingleSelectedTowerFromState(selection, structureStore)
}

const getSelectionTowerTypeId = (): TowerTypeId | null => {
  return getSelectionTowerTypeIdFromState(selection, structureStore)
}

const selectionDialog = new SelectionDialog(
  app,
  {
    selectedCount: 0,
    inRangeCount: 0,
    selectedTowerTypeId: null,
    selectedStructureLabel: 'Wall',
    showRepair: true,
    buildingCoords: null,
    buildingHealth: null,
    upgradeOptions: [],
    towerDetails: null,
    canRepair: false,
    canDelete: false
  },
  {
    onDelete: () => {
      const colliders = getSelectedInRange()
      if (colliders.length === 0) return
      const deleteCost = colliders.reduce((sum, collider) => sum + getDeleteEnergyCost(collider), 0)
      if (!spendEnergy(deleteCost)) {
        triggerEventBanner(`Need ${deleteCost} coins`)
        return
      }
      for (const collider of colliders) {
        structureStore.removeStructureCollider(collider)
      }
      clearSelection()
    },
    onUpgrade: (upgradeId) => {
      const tower = getSingleSelectedTower()
      if (!tower) return
      const [collider] = selectedStructures.values()
      if (!isColliderInRange(collider, SELECTION_RADIUS)) return
      const upgradeCost = getUpgradeEnergyCost(upgradeId)
      if (!spendEnergy(upgradeCost)) {
        triggerEventBanner(`Need ${upgradeCost} coins`)
        return
      }
      applyTowerUpgrade(tower, upgradeId)
      triggerEventBanner('Upgraded')
    },
    onRepair: () => {
      const [collider] = selectedStructures.values()
      if (!collider) return
      if (collider.type === 'tree') return
      if (!isColliderInRange(collider, SELECTION_RADIUS)) return
      const state = structureStore.structureStates.get(collider)
      if (!state) return
      if (state.hp >= state.maxHp) return
      state.hp = state.maxHp
    }
  }
)

const updateSelectionDialog = () => {
  const selectedCount = selectedStructures.size
  const inRange = getSelectedInRange()
  hudActionsEl.style.display = selectedCount > 0 && inRange.length > 0 ? 'none' : ''
  const tower = getSingleSelectedTower()
  const [selectedCollider] = selectedStructures.values()
  const selectedStructureState = selectedCollider ? (structureStore.structureStates.get(selectedCollider) ?? null) : null
  const isTreeSelected = selectedCollider?.type === 'tree'
  const deleteCost = inRange.reduce((sum, collider) => sum + getDeleteEnergyCost(collider), 0)
  const selectedTowerTypeId = getSelectionTowerTypeId()
  const selectedStructureLabel = isTreeSelected ? 'Tree' : 'Wall'
  const upgradeOptions = tower
    ? getTowerUpgradeOptions(tower).map(option => ({
        id: option.id,
        label: option.label,
        deltaText: getTowerUpgradeDeltaText(option.id),
        cost: getUpgradeEnergyCost(option.id),
        canAfford: gameState.energy >= getUpgradeEnergyCost(option.id)
      }))
    : []

  selectionDialog.update({
    selectedCount,
    inRangeCount: inRange.length,
    selectedTowerTypeId,
    selectedStructureLabel,
    showRepair: !isTreeSelected,
    buildingCoords: selectedCollider
      ? {
          x: Math.round(selectedCollider.center.x),
          z: Math.round(selectedCollider.center.z)
        }
      : null,
    buildingHealth: selectedStructureState
      && !isTreeSelected
      ? {
          hp: selectedStructureState.hp,
          maxHp: selectedStructureState.maxHp
        }
      : null,
    upgradeOptions,
    towerDetails: tower
      ? {
          builtBy: tower.builtBy,
          killCount: tower.killCount,
          range: tower.range,
          damage: tower.damage,
          speed: 1 / tower.shootCadence,
          dps: tower.damage * (1 / tower.shootCadence),
          rangeLevel: tower.rangeLevel,
          damageLevel: tower.damageLevel,
          speedLevel: tower.speedLevel
        }
      : null,
    canRepair: !isTreeSelected
      && selectedStructureState !== null
      && selectedStructureState.hp < selectedStructureState.maxHp
      && inRange.length > 0,
    canDelete: inRange.length > 0 && gameState.energy >= deleteCost
  })
}

buildWallBtn.addEventListener('click', () => setBuildMode('wall'))
buildTowerBtn.addEventListener('click', () => setBuildMode('tower'))

shootButton.addEventListener('pointerdown', () => {
  gameState.isShooting = true
})
shootButton.addEventListener('pointerup', () => {
  gameState.isShooting = false
})
shootButton.addEventListener('pointerleave', () => {
  gameState.isShooting = false
})

window.addEventListener('keydown', (event) => {
  const isEditableTarget =
    event.target instanceof HTMLElement &&
    (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable)
  if (inputController.handleKeyDown(event, isEditableTarget)) {
    event.preventDefault()
  } else if (event.code === 'Space') {
    event.preventDefault()
    gameState.isShooting = true
  } else if (event.code === 'Escape') {
    event.preventDefault()
    setBuildMode('off')
  }
})

window.addEventListener('keyup', (event) => {
  const isEditableTarget =
    event.target instanceof HTMLElement &&
    (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable)
  if (inputController.handleKeyUp(event, isEditableTarget)) {
    event.preventDefault()
  } else if (event.code === 'Space') {
    event.preventDefault()
    gameState.isShooting = false
  }
})

window.addEventListener('blur', () => {
  inputController.clearMovement()
  gameState.isShooting = false
})

const updatePointer = (event: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

const getGroundPoint = (event: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect()
  return screenToWorldOnGround(event.clientX, event.clientY, rect, camera, groundPlane)
}

const getStructureHit = (event: PointerEvent): DestructibleCollider | null => {
  const meshes = Array.from(structureStore.structureMeshToCollider.keys())
  if (meshes.length === 0) return null
  updatePointer(event)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(meshes, false)
  if (hits.length === 0) return null
  const mesh = hits[0]!.object as THREE.Mesh
  return structureStore.structureMeshToCollider.get(mesh) ?? null
}

const canPlace = (center: THREE.Vector3, halfSize: THREE.Vector3, allowTouchingStructures = false) => {
  return canPlaceAt(center, halfSize, staticColliders, allowTouchingStructures)
}

const placeBuilding = (center: THREE.Vector3) => {
  const result = placeBuildingAt(center, gameState.buildMode, gameState.energy, {
    staticColliders,
    structureStore,
    scene,
    createTowerAt: (snapped) => createTowerAt(snapped, 'base', player.username ?? 'Player'),
    applyObstacleDelta
  })
  gameState.energy = Math.max(0, gameState.energy - result.energySpent)
  return result.placed
}

const WALL_LINE_SIZE = new THREE.Vector3(1, 1, 1)
const WALL_LINE_HALF = WALL_LINE_SIZE.clone().multiplyScalar(0.5)

const getWallLinePlacement = (start: THREE.Vector3, end: THREE.Vector3, availableEnergy: number) => {
  return computeWallLinePlacement(start, end, availableEnergy, staticColliders)
}

const placeWallLine = (start: THREE.Vector3, end: THREE.Vector3) => {
  const placed = placeWallSegment(start, end, gameState.energy, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta
  })
  gameState.energy = Math.max(0, gameState.energy - placed * ENERGY_COST_WALL)
  return placed > 0
}

const placeWallSegments = (positions: THREE.Vector3[]) => {
  const placed = placeWallSegmentsAt(positions, gameState.energy, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta
  })
  gameState.energy = Math.max(0, gameState.energy - placed * ENERGY_COST_WALL)
  return placed > 0
}

const addMapTower = (center: THREE.Vector3) => {
  const size = getBuildSizeForMode('tower')
  const half = size.clone().multiplyScalar(0.5)
  const snapped = snapCenterToBuildGrid(center, size)
  if (!canPlaceAt(snapped, half, staticColliders)) return
  const tower = createTowerAt(snapped, 'base', 'Map')
  const mesh = tower.mesh
  structureStore.addTowerCollider(snapped, half, mesh, tower, TOWER_HP)
}

const addMapTree = (center: THREE.Vector3) => {
  const size = TREE_BUILD_SIZE
  const half = size.clone().multiplyScalar(0.5)
  const snapped = snapCenterToBuildGrid(center, size)
  if (!canPlaceAt(snapped, half, staticColliders)) return false
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color: 0x4f8f46, transparent: true, opacity: treeModelTemplate ? 0.01 : 1 })
  )
  mesh.position.copy(snapped)
  if (treeModelTemplate) {
    applyTreeVisualToMesh(mesh)
  } else {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  scene.add(mesh)
  structureStore.addTreeCollider(snapped, half, mesh, WALL_HP)
  return true
}

const scatterMapTrees = (count: number) => {
  let placed = 0
  let attempts = 0
  const maxAttempts = count * 20
  while (placed < count && attempts < maxAttempts) {
    attempts += 1
    const x = Math.round((random() * 2 - 1) * (WORLD_BOUNDS - 3))
    const z = Math.round((random() * 2 - 1) * (WORLD_BOUNDS - 3))
    if (addMapTree(new THREE.Vector3(x, 0, z))) placed += 1
  }
}

const prebuiltTowers = [
  new THREE.Vector3(-14, 0, 10),
  new THREE.Vector3(14, 0, 10),
  new THREE.Vector3(-14, 0, -10),
  new THREE.Vector3(14, 0, -10),
  new THREE.Vector3(-10, 0, 14),
  new THREE.Vector3(10, 0, 14),
  new THREE.Vector3(-10, 0, -14),
  new THREE.Vector3(10, 0, -14),
  new THREE.Vector3(-6, 0, 6),
  new THREE.Vector3(6, 0, -6),
  new THREE.Vector3(6, 0, 6),
  new THREE.Vector3(-6, 0, -6)
]

for (const pos of prebuiltTowers) {
  addMapTower(pos)
}
scatterMapTrees(MAP_TREE_COUNT)

// Initialize lane paths for active spawners once map is ready.
refreshAllSpawnerPathlines()

const resetGame = () => {
  gameState.lives = 1
  gameState.wave = 0
  gameState.nextWaveAt = 0
  gameState.prevMobsCount = 0
  gameState.energy = ENERGY_CAP
  gameState.energyPopTimer = 0
  gameState.eventBannerTimer = 0
  eventBannerEl.classList.remove('show')
  eventBannerEl.textContent = ''
  finalCountdownEl.classList.remove('show')
  finalCountdownEl.textContent = ''
  setBuildMode('off')
  selectedTower = null
  selectedStructures.clear()
  structureOutlinePass.selectedObjects = []
  treeOutlinePass.selectedObjects = []
  isDraggingWall = false
  wallDragStart = null
  wallDragEnd = null
  wallDragValidPositions = []

  for (const mob of mobs) {
    if (mob.spawnerId) {
      const spawner = spawnerById.get(mob.spawnerId)
      if (spawner) spawner.aliveCount = Math.max(0, spawner.aliveCount - 1)
    }
  }
  mobs.length = 0
  mobInstanceMesh.count = 0
  spawnerById.clear()
  activeWaveSpawners.length = 0
  spawnerPathlineCache.clear()
  pendingSpawnerPathRefresh.clear()
  pendingSpawnerPathOrder.length = 0
  spawnerRouteOverlay.clear()
  spawnContainerOverlay.clear()
  particleSystem.dispose()

  for (const state of structureStore.structureStates.values()) {
    const linkedVisual = state.mesh.userData.linkedVisual as THREE.Object3D | undefined
    if (linkedVisual) {
      scene.remove(linkedVisual)
      linkedVisual.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        node.geometry.dispose()
        if (Array.isArray(node.material)) {
          for (const material of node.material) material.dispose()
        } else {
          node.material.dispose()
        }
      })
    }
    scene.remove(state.mesh)
    state.mesh.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      if (Array.isArray(node.material)) {
        for (const material of node.material) material.dispose()
      } else {
        node.material.dispose()
      }
    })
    if (state.tower) {
      scene.remove(state.tower.rangeRing)
      scene.remove(state.tower.laser)
      state.tower.rangeRing.geometry.dispose()
    }
  }
  towers.length = 0
  towerBallistaRigs.clear()
  structureStore.wallMeshes.length = 0
  structureStore.structureStates.clear()
  structureStore.structureMeshToCollider.clear()

  staticColliders.length = 0
  staticColliders.push(castleCollider)

  for (const trail of activeEnergyTrails) {
    coinTrailScene.remove(trail.mesh)
    for (const material of trail.materials) {
      material.dispose()
    }
  }
  activeEnergyTrails.length = 0

  refreshAllSpawnerPathlines()
}

const setMoveTarget = (pos: THREE.Vector3) => {
  const clamped = new THREE.Vector3(clamp(pos.x, -WORLD_BOUNDS, WORLD_BOUNDS), 0, clamp(pos.z, -WORLD_BOUNDS, WORLD_BOUNDS))
  player.target.copy(clamped)
}

const hasPlayerReachedBlockedTarget = () => {
  for (const collider of staticColliders) {
    const targetInsideCollider =
      Math.abs(player.target.x - collider.center.x) <= collider.halfSize.x &&
      Math.abs(player.target.z - collider.center.z) <= collider.halfSize.z
    if (!targetInsideCollider) continue
    if (distanceToColliderSurface(player.mesh.position, player.radius, collider) <= 0.05) {
      return true
    }
  }
  return false
}

const motionSystem = createEntityMotionSystem({
  structureStore,
  staticColliders,
  spatialGrid,
  npcs,
  constants: {
    mobBerserkAttackCooldown: MOB_SIEGE_ATTACK_COOLDOWN,
    mobBerserkDamage: MOB_SIEGE_DAMAGE,
    mobBerserkRangeBuffer: MOB_SIEGE_RANGE_BUFFER,
    mobBerserkUnreachableGrace: MOB_SIEGE_UNREACHABLE_GRACE,
    worldBounds: WORLD_BOUNDS,
    gridSize: GRID_SIZE
  },
  random,
  spawnCubeEffects
})

renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('#hud, .selection-dialog')) return
  activePointerId = event.pointerId
  renderer.domElement.setPointerCapture(event.pointerId)
  if (gameState.buildMode !== 'off') {
    const point = getGroundPoint(event)
    if (!point) return
    if (gameState.buildMode === 'wall') {
      isDraggingWall = true
      wallDragStart = point.clone()
      wallDragEnd = point.clone()
      wallDragValidPositions = []
    } else {
      // Tower: place and exit
      if (placeBuilding(point)) {
        setBuildMode('off')
      }
    }
    return
  }
  const structureHit = getStructureHit(event)
  if (structureHit) {
    setSelectedStructures([structureHit])
    setMoveTarget(structureHit.center)
    return
  }
  const point = getGroundPoint(event)
  if (!point) return
  clearSelection()
  setMoveTarget(point)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (gameState.buildMode === 'off') return
  const point = getGroundPoint(event)
  if (!point) return
  
  if (gameState.buildMode === 'wall' && isDraggingWall && wallDragStart) {
    wallDragEnd = point.clone()

    // Show one continuous preview mesh for the wall segment.
    const availableWallPreview = gameState.energy
    const { validPositions, blockedPosition } = getWallLinePlacement(wallDragStart, wallDragEnd, availableWallPreview)
    wallDragValidPositions = validPositions

    if (validPositions.length > 0) {
      const first = validPositions[0]!
      const last = validPositions[validPositions.length - 1]!
      const length = validPositions.length
      const isHorizontal = Math.abs(last.x - first.x) >= Math.abs(last.z - first.z)
      const previewSizeX = isHorizontal ? length * GRID_SIZE : GRID_SIZE
      const previewSizeZ = isHorizontal ? GRID_SIZE : length * GRID_SIZE

      buildPreview.scale.set(previewSizeX, WALL_LINE_SIZE.y, previewSizeZ)
      buildPreview.position.set((first.x + last.x) * 0.5, WALL_LINE_HALF.y, (first.z + last.z) * 0.5)
      ;(buildPreview.material as THREE.MeshStandardMaterial).color.setHex(0x66ff66)
      buildPreview.visible = true
    } else if (blockedPosition) {
      buildPreview.scale.set(WALL_LINE_SIZE.x, WALL_LINE_SIZE.y, WALL_LINE_SIZE.z)
      buildPreview.position.copy(blockedPosition)
      ;(buildPreview.material as THREE.MeshStandardMaterial).color.setHex(0xff6666)
      buildPreview.visible = true
    } else {
      buildPreview.visible = false
    }
  } else {
    const isTower = gameState.buildMode === 'tower'
    const size = getBuildSizeForMode(isTower ? 'tower' : 'wall')
    const half = size.clone().multiplyScalar(0.5)
    const snapped = snapCenterToBuildGrid(point, size)
    const energyCost = isTower ? ENERGY_COST_TOWER : ENERGY_COST_WALL
    const ok = canPlace(snapped, half, true) && gameState.energy >= energyCost
    buildPreview.scale.set(size.x, size.y, size.z)
    buildPreview.position.copy(snapped)
    ;(buildPreview.material as THREE.MeshStandardMaterial).color.setHex(ok ? 0x66ff66 : 0xff6666)
    buildPreview.visible = true
  }
})

window.addEventListener('pointerup', (event) => {
  if (activePointerId !== null && event.pointerId === activePointerId) {
    renderer.domElement.releasePointerCapture(activePointerId)
    activePointerId = null
  }
  gameState.isShooting = false
  if (gameState.buildMode === 'wall' && isDraggingWall && wallDragStart && wallDragEnd) {
    if (wallDragValidPositions.length > 0) {
      placeWallSegments(wallDragValidPositions)
    } else {
      placeWallLine(wallDragStart, wallDragEnd)
    }
    setBuildMode('off')
  }
})

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight
  camera.left = -orthoSize * aspect
  camera.right = orthoSize * aspect
  camera.top = orthoSize
  camera.bottom = -orthoSize
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  syncCoinTrailViewport()
  syncMinimapCanvasSize()
})

const updateEntityMotion = (entity: Entity, delta: number) => {
  motionSystem.updateEntityMotion(entity, delta)
}

const updateNpcTargets = () => {
  motionSystem.updateNpcTargets()
}

const triggerEventBanner = (text: string) => {
  eventBannerEl.textContent = ''
  const line = document.createElement('div')
  line.className = 'event-banner__single'
  line.textContent = text
  eventBannerEl.appendChild(line)
  eventBannerEl.classList.remove('stack')
  eventBannerEl.classList.add('single')
  eventBannerEl.classList.remove('show')
  void eventBannerEl.offsetWidth
  eventBannerEl.classList.add('show')
  gameState.eventBannerTimer = EVENT_BANNER_DURATION
}

const spawnWave = () => {
  gameState.wave = waveAndSpawnSystem.spawnWave({
    wave: gameState.wave,
    activeWaveSpawners,
    spawnerById,
    refreshSpawnerPathline,
    clearWaveOverlays: () => {
      spawnerRouteOverlay.clear()
      spawnerPathlineCache.clear()
      spawnContainerOverlay.clear()
      pendingSpawnerPathRefresh.clear()
      pendingSpawnerPathOrder.length = 0
    }
  })
  triggerEventBanner(`Wave ${gameState.wave} spawned`)
}

const pickMobInRange = (center: THREE.Vector3, radius: number) => {
  let best: Entity | null = null
  let bestDistToBase = Number.POSITIVE_INFINITY
  const candidates = spatialGrid.getNearbyInto(center, radius, rangeCandidateScratch)
  for (const mob of candidates) {
    if (mob.kind !== 'mob') continue
    if ((mob.hp ?? 0) <= 0) continue
    const distToCenter = mob.mesh.position.distanceTo(center)
    if (distToCenter > radius) continue
    const distToBase = mob.mesh.position.length()
    if (distToBase < bestDistToBase) {
      best = mob
      bestDistToBase = distToBase
    }
  }
  return best
}

const pickSelectedMob = () => pickMobInRange(player.mesh.position, SELECTION_RADIUS)

const updateMobInstanceRender = (now: number) => {
  renderVisibleMobInstances({
    mobs,
    camera,
    mobInstanceMesh,
    mobInstanceDummy,
    nowMs: now,
    maxVisibleMobInstances: MAX_VISIBLE_MOB_INSTANCES,
    mobInstanceCap: MOB_INSTANCE_CAP,
    normalMobColor,
    berserkMobColor
  })
}

const tick = (now: number, delta: number) => {
  gameState.energy = Math.min(ENERGY_CAP, gameState.energy + ENERGY_REGEN_RATE * delta)
  if (gameState.buildMode === 'wall' && gameState.energy < ENERGY_COST_WALL) {
    setBuildMode('off')
  }
  if (gameState.buildMode === 'tower' && gameState.energy < ENERGY_COST_TOWER) {
    setBuildMode('off')
  }

  waveAndSpawnSystem.emit(activeWaveSpawners, delta, (fromSpawner) => makeMob(fromSpawner))
  processSpawnerPathlineQueue()

  const keyboardDir = inputController.getKeyboardMoveDirection({
    camera,
    keyboardForward,
    keyboardRight,
    keyboardMoveDir
  })
  const isKeyboardMoving = keyboardDir !== null
  if (keyboardDir) {
    const keyboardMoveDistance = Math.max(GRID_SIZE, player.speed * 0.35)
    setMoveTarget(player.mesh.position.clone().addScaledVector(keyboardDir, keyboardMoveDistance))
    wasKeyboardMoving = true
  } else if (wasKeyboardMoving) {
    // Release-to-stop behavior for keyboard movement.
    setMoveTarget(player.mesh.position)
    wasKeyboardMoving = false
  }

  updateNpcTargets()
  updateEntityMotion(player, delta)
  for (const npc of npcs) {
    updateEntityMotion(npc, delta)
  }

  for (const mob of mobs) {
    mob.target.set(0, 0, 0)
    updateEntityMotion(mob, delta)
  }

  spatialGrid.clear()
  const dynamicEntities = [player, ...npcs, ...mobs]
  for (const entity of dynamicEntities) {
    spatialGrid.insert(entity)
  }

  updateParticles(delta)
  updateEnergyTrails(delta)
  updateFloatingDamageTexts(delta)

  for (const tower of towers) {
    tower.shootCooldown = Math.max(tower.shootCooldown - delta, 0)
    tower.laserVisibleTime = Math.max(tower.laserVisibleTime - delta, 0)

    const target = pickMobInRange(tower.mesh.position, tower.range)
    const rig = towerBallistaRigs.get(tower)
    if (rig) {
      updateBallistaRigTracking(rig, tower.mesh.position, target ? target.mesh.position : null, delta)
    }
    if (target) {
      const start = tower.mesh.position.clone().setY(tower.mesh.position.y + TOWER_HEIGHT * 0.5)
      const end = target.mesh.position.clone().setY(target.baseY + 0.3)
      const direction = new THREE.Vector3().subVectors(end, start)
      const length = direction.length()

      tower.laser.position.copy(start).add(end).multiplyScalar(0.5)
      tower.laser.scale.set(1, length, 1)
      tower.laser.lookAt(end)
      tower.laser.rotateX(Math.PI / 2)

      if (tower.shootCooldown <= 0) {
        const attack = rollAttackDamage(tower.damage)
        const prevHp = target.hp ?? 1
        const nextHp = prevHp - attack.damage
        target.hp = nextHp
        target.lastHitBy = 'tower'
        spawnFloatingDamageText(target, attack.damage, 'tower', attack.isCrit)
        if (prevHp > 0 && nextHp <= 0) {
          tower.killCount += 1
        }
        tower.shootCooldown = tower.shootCadence
        tower.laserVisibleTime = 0.07
      }
    }

    tower.laser.visible = tower.laserVisibleTime > 0 && target !== null
  }

  // Only check collisions between entities in nearby cells
  const processed = new Set<Entity>()
  for (const entity of dynamicEntities) {
    processed.add(entity)
    const nearby = spatialGrid.getNearbyInto(
      entity.mesh.position,
      (entity.radius + 0.5) * 2,
      collisionNearbyScratch
    )
    for (const other of nearby) {
      if (processed.has(other)) continue // Already processed this pair
      resolveCircleCircle(entity, other)
    }
  }

  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    const mob = mobs[i]!
    if (distanceToColliderSurface(mob.mesh.position, mob.radius, castleCollider) <= 0.2) {
      spawnCubeEffects(mob.mesh.position.clone())
      gameState.lives = Math.max(gameState.lives - 1, 0)
      if (mob.spawnerId) {
        const spawner = spawnerById.get(mob.spawnerId)
        if (spawner) spawner.aliveCount = Math.max(0, spawner.aliveCount - 1)
      }
      mobs.splice(i, 1)
      if (gameState.lives === 0) {
        resetGame()
        break
      }
    } else if ((mob.hp ?? 0) <= 0) {
      spawnMobDeathEffects(mob.mesh.position.clone())
      if (mob.lastHitBy === 'player') {
        spawnEnergyTrail(mob.mesh.position.clone(), ENERGY_PER_PLAYER_KILL)
      }
      if (mob.spawnerId) {
        const spawner = spawnerById.get(mob.spawnerId)
        if (spawner) spawner.aliveCount = Math.max(0, spawner.aliveCount - 1)
      }
      mobs.splice(i, 1)
    }
  }

  for (const spawner of activeWaveSpawners) {
    const mobCountForSpawner = mobs.filter((mob) => mob.spawnerId === spawner.id).length
    spawner.aliveCount = mobCountForSpawner
  }

  const waveComplete = gameState.wave > 0 && areWaveSpawnersDone(activeWaveSpawners)
  if (waveComplete && gameState.nextWaveAt === 0) {
    gameState.nextWaveAt = now + 10000
  }
  if (waveComplete && now >= gameState.nextWaveAt && gameState.nextWaveAt !== 0) {
    gameState.nextWaveAt = 0
    spawnWave()
  }
  if (gameState.wave === 0) {
    spawnWave()
  }

  const selected = pickSelectedMob()
  if (selected) {
    // Bounce animation using sine wave
    const bounceOffset = Math.sin(now * 0.005) * 0.3
    selectionArrow.position.set(
      selected.mesh.position.x,
      selected.baseY + 2.5 + bounceOffset,
      selected.mesh.position.z
    )
    // Rotate arrow to face camera (billboard effect)
    // Arrow is built pointing down (-Y in local space)
    // Get camera's right and up vectors
    const cameraRight = new THREE.Vector3(1, 0, 0)
    const cameraUp = new THREE.Vector3(0, 1, 0)
    cameraRight.applyQuaternion(camera.quaternion).normalize()
    cameraUp.applyQuaternion(camera.quaternion).normalize()
    // Make arrow's local X align with camera right, local Z with camera up
    // This makes arrow's Y axis perpendicular to camera view (showing side, not circles)
    const matrix = new THREE.Matrix4()
    matrix.makeBasis(cameraRight, cameraUp, cameraRight.clone().cross(cameraUp).normalize())
    selectionArrow.quaternion.setFromRotationMatrix(matrix)
    selectionArrow.visible = true
  } else {
    selectionArrow.visible = false
  }
  
  // Update shoot button state
  shootButton.disabled = selected === null
  updateSelectionDialog()
  syncSelectedStructureOutline()
  const outlinePulse = 3.8 + Math.sin(now * 0.01) * 0.5
  structureOutlinePass.edgeStrength = outlinePulse
  treeOutlinePass.edgeStrength = outlinePulse

  for (const tower of towers) {
    tower.rangeRing.position.set(tower.mesh.position.x, 0.02, tower.mesh.position.z)
    const collider = structureStore.structureMeshToCollider.get(tower.mesh)
    tower.rangeRing.visible = selectedTower === tower || (collider !== undefined && selectedStructures.has(collider))
  }

  const arrowDir = new THREE.Vector3(
    player.target.x - player.mesh.position.x,
    0,
    player.target.z - player.mesh.position.z
  )
  const arrowLength = hasPlayerReachedBlockedTarget() ? 0 : arrowDir.length()
  if (!isKeyboardMoving && arrowLength >= 1.0) {
    arrowDir.normalize()
    arrow.position.copy(player.mesh.position)
    arrow.setDirection(arrowDir)
    arrow.setLength(Math.min(arrowLength, 12), 0.6, 0.5)
    arrow.visible = true
  } else {
    arrow.visible = false
  }

  // Update laser visibility timer
  if (gameState.laserVisibleTime > 0) {
    gameState.laserVisibleTime -= delta
  }
  
  if (gameState.isShooting && selected) {
    const start = player.mesh.position.clone()
    const end = selected.mesh.position.clone()
    const direction = new THREE.Vector3().subVectors(end, start)
    const length = direction.length()
    
    // Always update laser position/rotation when shooting, but only show when timer is active
    laser.position.copy(start).add(end).multiplyScalar(0.5)
    laser.scale.set(1, length, 1)
    laser.lookAt(end)
    laser.rotateX(Math.PI / 2)
    
    gameState.shootCooldown -= delta
    if (gameState.shootCooldown <= 0) {
      const attack = rollAttackDamage(SHOOT_DAMAGE)
      selected.hp = (selected.hp ?? 0) - attack.damage
      selected.lastHitBy = 'player'
      spawnFloatingDamageText(selected, attack.damage, 'player', attack.isCrit)
      gameState.shootCooldown = SHOOT_COOLDOWN
      // Show laser for 0.1 seconds when shot fires
      gameState.laserVisibleTime = 0.1
    }
  } else {
    gameState.shootCooldown = Math.max(gameState.shootCooldown - delta, 0)
  }
  
  // Only show laser when visibility timer is active
  laser.visible = gameState.laserVisibleTime > 0 && selected !== null

  camera.position.copy(player.mesh.position).add(cameraOffset)
  camera.lookAt(player.mesh.position)
  camera.updateMatrixWorld()
  updateViewportFogCenter()
  updateMobInstanceRender(now)

  updateHealthBars()
  updateUsernameLabels()
  
  // Update ground + grid to cover the visible camera rectangle
  const visibleBounds = getVisibleGroundBounds(camera)
  updateGroundFromBounds(visibleBounds)
  worldGrid.update(visibleBounds)

  gameState.energyPopTimer = Math.max(0, gameState.energyPopTimer - delta)
  updateHud(
    {
      wallCountEl,
      towerCountEl,
      energyCountEl,
      buildWallBtn,
      buildTowerBtn,
      waveEl,
      nextWaveRowEl,
      mobsRowEl,
      nextWavePrimaryEl,
      nextWaveSecondaryEl,
      mobsPrimaryEl,
      mobsSecondaryEl,
      finalCountdownEl,
      shootButton
    },
    {
      energy: gameState.energy,
      wave: gameState.wave,
      waveComplete,
      nextWaveAt: gameState.nextWaveAt,
      now,
      mobsCount: mobs.length,
      energyPopTimer: gameState.energyPopTimer,
      shootCooldown: gameState.shootCooldown
    },
    {
      energySymbol: ENERGY_SYMBOL,
      energyCostWall: ENERGY_COST_WALL,
      energyCostTower: ENERGY_COST_TOWER,
      shootCooldownMax: SHOOT_COOLDOWN
    }
  )

  if (gameState.prevMobsCount > 0 && waveComplete) {
    triggerEventBanner('Wave cleared')
  }

  if (gameState.eventBannerTimer > 0) {
    gameState.eventBannerTimer = Math.max(0, gameState.eventBannerTimer - delta)
    if (gameState.eventBannerTimer === 0) {
      eventBannerEl.classList.remove('show')
      eventBannerEl.textContent = ''
    }
  }

  gameState.prevMobsCount = mobs.length
  if (import.meta.env.DEV) {
    assertEnergyInBounds(gameState.energy, ENERGY_CAP)
    assertSpawnerCounts(activeWaveSpawners)
    assertStructureStoreConsistency(structureStore, staticColliders)
    assertMobSpawnerReferences(mobs, new Set(spawnerById.keys()))
  }

  drawMinimap()
  updateCoinHudView(delta)
  composer.render()
  coinTrailRenderer.render(coinTrailScene, coinTrailCamera)
}

const gameLoop = createGameLoop(tick)
let disposed = false
const disposeApp = () => {
  if (disposed) return
  disposed = true

  particleSystem.dispose()
  spawnContainerOverlay.dispose()
  spawnerRouteOverlay.clear()
  worldGrid.dispose()
  worldBorder.dispose()

  scene.remove(laser)
  laser.geometry.dispose()
  ;(laser.material as THREE.Material).dispose()
  shaftGeometry.dispose()
  shaftMaterial.dispose()
  headGeometry.dispose()
  headMaterial.dispose()

  scene.remove(buildPreview)
  buildPreview.geometry.dispose()
  ;(buildPreview.material as THREE.Material).dispose()

  scene.remove(mobInstanceMesh)
  mobInstanceMesh.geometry.dispose()
  ;(mobInstanceMesh.material as THREE.Material).dispose()
  mobLogicGeometry.dispose()
  mobLogicMaterial.dispose()
  towerLaserGeometry.dispose()
  towerLaserMaterial.dispose()
  towerRangeMaterial.dispose()

  scene.remove(ground)
  ground.geometry.dispose()
  groundMaterial.dispose()
  scene.remove(castle)
  castle.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.geometry.dispose()
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        material.dispose()
      }
      return
    }
    node.material.dispose()
  })

  coinHudRoot.clear()
  coinHudRenderer.dispose()
  for (const trail of activeEnergyTrails) {
    coinTrailScene.remove(trail.mesh)
    for (const material of trail.materials) {
      material.dispose()
    }
  }
  activeEnergyTrails.length = 0
  coinTrailRenderer.dispose()
  composer.dispose()
  renderer.dispose()
}

window.addEventListener('beforeunload', disposeApp)
syncCoinTrailViewport()
syncMinimapCanvasSize()
gameLoop.start()

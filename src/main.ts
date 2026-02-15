import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { FlowField } from './pathfinding/FlowField'
import { screenToWorldOnGround } from './utils/coords'
import { SelectionDialog } from './ui/SelectionDialog'
import { UpgradeManager } from './game/UpgradeManager'
import { StructureStore } from './game/structures'
import { getTowerType, getTowerUpgrade, getTowerUpgradeDeltaText, getTowerUpgradeOptions } from './game/TowerTypes'
import type { TowerTypeId, TowerUpgradeId } from './game/TowerTypes'
import type { DestructibleCollider, Entity, StaticCollider, Tower } from './game/types'
import { WaypointCache } from './utils/WaypointCache'
import { SpatialGrid } from './utils/SpatialGrid'
import { createParticleSystem } from './effects/particles'
import { clamp, resolveCircleCircle } from './physics/collision'
import { createEntityMotionSystem } from './entities/motion'
import { createGameLoop } from './game/GameLoop'
import {
  canPlace as canPlaceAt,
  getWallLinePlacement as computeWallLinePlacement,
  placeBuilding as placeBuildingAt,
  placeWallSegments as placeWallSegmentsAt,
  placeWallLine as placeWallSegment,
  snapToGrid as snapGridValue,
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
  FLOW_FIELD_RESOLUTION,
  FLOW_FIELD_SIZE,
  GRID_SIZE,
  MOB_SIEGE_ATTACK_COOLDOWN,
  MOB_SIEGE_DAMAGE,
  MOB_SIEGE_RANGE_BUFFER,
  MOB_SIEGE_UNREACHABLE_GRACE,
  MOB_SPEED,
  NPC_SPEED,
  PLAYER_SPEED,
  SELECTION_RADIUS,
  SHOOT_COOLDOWN,
  SHOOT_DAMAGE,
  SPATIAL_GRID_CELL_SIZE,
  TOWER_CHARGE_MAX,
  TOWER_HEIGHT,
  TOWER_HP,
  TOWER_RECHARGE_RATE,
  WALL_CHARGE_MAX,
  WALL_HP,
  WALL_RECHARGE_RATE,
  WORLD_BOUNDS
} from './game/constants'

const app = document.querySelector<HTMLDivElement>('#app')!
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
    <div class="hud-overlay">
      <div id="eventBanner" class="event-banner"></div>
      <div id="finalCountdown" class="final-countdown"></div>
    </div>
    <div class="hud-corner hud-corner--bottom-right">
      <div class="hud-actions">
        <div class="build-buttons">
          <button id="buildWall" class="hud-button build-button">
            <span class="button-label">Wall</span>
            <span id="wallCount" class="hud-badge">200</span>
          </button>
          <button id="buildTower" class="hud-button build-button">
            <span class="button-label">Tower</span>
            <span id="towerCount" class="hud-badge">50</span>
          </button>
        </div>
        <button id="shootButton" class="shoot-button">Shoot</button>
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
const finalCountdownEl = document.querySelector<HTMLDivElement>('#finalCountdown')!
const nextWaveRowEl = document.querySelector<HTMLDivElement>('#nextWaveRow')!
const nextWavePrimaryEl = nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__primary')!
const nextWaveSecondaryEl = nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__secondary')!
const eventBannerEl = document.querySelector<HTMLDivElement>('#eventBanner')!
const hudActionsEl = document.querySelector<HTMLDivElement>('.hud-actions')!
const buildWallBtn = document.querySelector<HTMLButtonElement>('#buildWall')!
const buildTowerBtn = document.querySelector<HTMLButtonElement>('#buildTower')!
const shootButton = document.querySelector<HTMLButtonElement>('#shootButton')!

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
app.appendChild(renderer.domElement)
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
composer.addPass(new OutputPass())

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 0.9)
scene.add(hemi)
const dir = new THREE.DirectionalLight(0xffffff, 0.7)
dir.position.set(6, 12, 4)
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

    const minX = Math.floor((bounds.minX - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const maxX = Math.ceil((bounds.maxX - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const minZ = Math.floor((bounds.minZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid
    const maxZ = Math.ceil((bounds.maxZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE + this.halfGrid

    // Create vertical lines (along Z axis)
    for (let x = minX; x <= maxX; x += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, bounds.minZ),
        new THREE.Vector3(x, 0.01, bounds.maxZ)
      ])
      const line = new THREE.Line(geometry, this.lineMaterial)
      this.group.add(line)
      this.lines.push(line)
    }

    // Create horizontal lines (along X axis)
    for (let z = minZ; z <= maxZ; z += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(bounds.minX, 0.01, z),
        new THREE.Vector3(bounds.maxX, 0.01, z)
      ])
      const line = new THREE.Line(geometry, this.lineMaterial)
      this.group.add(line)
      this.lines.push(line)
    }
  }
}

const worldGrid = new WorldGrid()
let lastGroundBounds: GroundBounds | null = null
const updateGroundFromBounds = (bounds: GroundBounds) => {
  if (
    lastGroundBounds &&
    lastGroundBounds.minX === bounds.minX &&
    lastGroundBounds.maxX === bounds.maxX &&
    lastGroundBounds.minZ === bounds.minZ &&
    lastGroundBounds.maxZ === bounds.maxZ
  ) {
    return
  }
  lastGroundBounds = bounds
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  ground.scale.set(width, depth, 1)
  ground.position.set((bounds.minX + bounds.maxX) * 0.5, 0, (bounds.minZ + bounds.maxZ) * 0.5)
}

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x1b232b })
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
scene.add(ground)

const castle = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: 0xe0c34a })
)
castle.rotation.x = -Math.PI / 2
castle.position.set(0, 0.02, 0)
scene.add(castle)

const castleCollider: StaticCollider = {
  center: new THREE.Vector3(0, 0.02, 0),
  halfSize: new THREE.Vector3(0.5, 0.01, 0.5),
  type: 'castle'
}
const staticColliders: StaticCollider[] = [castleCollider]
const mobs: Entity[] = []
const towers: Tower[] = []
let selectedTower: Tower | null = null
const structureStore = new StructureStore(
  scene,
  staticColliders,
  towers,
  (tower) => {
    if (selectedTower === tower) selectedTower = null
    upgradeManager.cancelForTower(tower)
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

// Initialize flow field and spatial grid
const flowField = new FlowField({
  size: FLOW_FIELD_SIZE,
  resolution: FLOW_FIELD_RESOLUTION,
  worldBounds: WORLD_BOUNDS
})
const spatialGrid = new SpatialGrid(SPATIAL_GRID_CELL_SIZE)
const waypointCache = new WaypointCache(GRID_SIZE * 2) // Share waypoints within 2 grid cells
const castleGoal = new THREE.Vector3(0, 0, 0)
let pendingWaypointRefresh = false
let pendingWaypointRefreshIndex = 0
const WAYPOINT_REFRESH_BATCH_SIZE = 200

const refreshAllMobWaypoints = () => {
  pendingWaypointRefresh = false
  pendingWaypointRefreshIndex = 0
  for (const mob of mobs) {
    const waypoints = flowField.computeWaypoints(mob.mesh.position, castleGoal)
    mob.waypoints = waypoints
    mob.waypointIndex = 0
  }
}

const applyObstacleDelta = (added: StaticCollider[], removed: StaticCollider[] = []) => {
  const changed = flowField.applyObstacleDelta(staticColliders, added, removed, castleGoal)
  if (!changed) return
  waypointCache.clear()
  pendingWaypointRefresh = true
  pendingWaypointRefreshIndex = 0
}

// Compute initial flow field (exclude castle from pathfinding)
flowField.rebuildAll(staticColliders, castleGoal)

const ring = new THREE.Mesh(
  new THREE.RingGeometry(SELECTION_RADIUS - 0.1, SELECTION_RADIUS, 32),
  new THREE.MeshBasicMaterial({ color: 0x4ad1ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
)
ring.rotation.x = -Math.PI / 2
scene.add(ring)

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
const upgradeManager = new UpgradeManager(8)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

const makeCapsule = (color: number) =>
  new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 10), new THREE.MeshStandardMaterial({ color }))

const player: Entity = {
  mesh: makeCapsule(0x62ff9a),
  radius: 0.45,
  speed: PLAYER_SPEED,
  velocity: new THREE.Vector3(),
  target: new THREE.Vector3(0, 0, 0),
  kind: 'player',
  baseY: 0.7,
  username: 'u/PlayerOne'
}
player.mesh.position.set(4, player.baseY, 4)
player.target.set(player.mesh.position.x, 0, player.mesh.position.z)
scene.add(player.mesh)

const npcs: Entity[] = []
const makeNpc = (pos: THREE.Vector3, color: number, username: string) => {
  const npc: Entity = {
    mesh: makeCapsule(color),
    radius: 0.45,
    speed: NPC_SPEED,
    velocity: new THREE.Vector3(),
    target: pos.clone(),
    kind: 'npc',
    baseY: 0.7,
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
  const selectedObjects: THREE.Object3D[] = []
  for (const collider of selectedStructures) {
    const mesh = structureStore.structureStates.get(collider)?.mesh
    if (!mesh) continue
    selectedObjects.push(mesh)
  }
  structureOutlinePass.selectedObjects = selectedObjects
}

const applyTowerUpgrade = (tower: Tower, upgradeId: TowerUpgradeId) => {
  if (upgradeId === 'range') {
    tower.rangeLevel += 1
    tower.range += 0.75
  } else if (upgradeId === 'damage') {
    tower.damageLevel += 1
    tower.damage += 2
  } else if (upgradeId === 'speed') {
    tower.speedLevel += 1
    tower.shootCadence = Math.max(0.06, tower.shootCadence * 0.9)
  }
  tower.rangeRing.geometry.dispose()
  tower.rangeRing.geometry = new THREE.RingGeometry(tower.range - 0.12, tower.range, 32)
}

const createTowerAt = (snapped: THREE.Vector3, typeId: TowerTypeId, builtBy: string): Tower => {
  const typeConfig = getTowerType(typeId)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, TOWER_HEIGHT, 1),
    new THREE.MeshStandardMaterial({ color: typeConfig.color })
  )
  mesh.position.copy(snapped)
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
  towers.push(tower)
  return tower
}

const makeMob = (pos: THREE.Vector3) => {
  const mob = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff7a7a })
  )
  mob.position.copy(pos).setY(0.4)
  scene.add(mob)
  
  // Try to get cached waypoints, otherwise compute new ones
  let waypoints = waypointCache.get(pos)
  if (!waypoints) {
    waypoints = flowField.computeWaypoints(pos, castleGoal)
    waypointCache.set(pos, waypoints)
  }
  
  const maxHp = 3
  mobs.push({
    mesh: mob,
    radius: 0.45,
    speed: MOB_SPEED,
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(0, 0, 0),
    kind: 'mob',
    hp: maxHp,
    maxHp: maxHp,
    baseY: 0.4,
    waypoints: waypoints.map(w => w.clone()), // Clone for this mob
    waypointIndex: 0,
    siegeMode: false,
    siegeTarget: null,
    siegeAttackCooldown: 0,
    unreachableTime: 0
  })
}

let buildMode: BuildMode = 'off'
let isShooting = false
let shootCooldown = 0
let laserVisibleTime = 0
let wave = 0
let lives = 1
let nextWaveAt = 0
let wallCharges = WALL_CHARGE_MAX
let towerCharges = TOWER_CHARGE_MAX
let isDraggingWall = false
let wallDragStart: THREE.Vector3 | null = null
let wallDragEnd: THREE.Vector3 | null = null
let wallDragValidPositions: THREE.Vector3[] = []
const EVENT_BANNER_DURATION = 2.4
let eventBannerTimer = 0
let prevMobsCount = 0

const particleSystem = createParticleSystem(scene)
const spawnCubeEffects = particleSystem.spawnCubeEffects
const spawnMobDeathEffects = particleSystem.spawnMobDeathEffects
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

const worldToScreen = (worldPos: THREE.Vector3): { x: number, y: number } | null => {
  const vector = worldPos.clone()
  vector.project(camera)
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight
  return { x, y }
}

const updateHealthBars = () => {
  // Clear existing health bars
  healthBarContainer.innerHTML = ''
  
  for (const mob of mobs) {
    if (mob.maxHp === undefined) continue
    // Only show health bar if not full
    if (mob.hp !== undefined && mob.maxHp !== undefined && mob.hp >= mob.maxHp) continue
    const screenPos = worldToScreen(
      mob.mesh.position.clone().setY(mob.baseY + 0.8)
    )
    if (!screenPos) continue
    
    const healthBar = document.createElement('div')
    healthBar.style.position = 'absolute'
    healthBar.style.left = `${screenPos.x - 30}px`
    healthBar.style.top = `${screenPos.y}px`
    healthBar.style.width = '60px'
    healthBar.style.height = '4px'
    healthBar.style.backgroundColor = '#333'
    healthBar.style.border = '1px solid #666'
    healthBar.style.borderRadius = '2px'
    healthBar.style.overflow = 'hidden'
    
    const healthFill = document.createElement('div')
    const hpPercent = Math.max(0, (mob.hp ?? 0) / mob.maxHp)
    healthFill.style.width = `${hpPercent * 100}%`
    healthFill.style.height = '100%'
    healthFill.style.backgroundColor = hpPercent > 0.5 
      ? `rgb(${Math.floor(255 * (1 - hpPercent) * 2)}, 255, 0)`
      : `rgb(255, ${Math.floor(255 * hpPercent * 2)}, 0)`
    healthFill.style.transition = 'width 0.1s, background-color 0.1s'
    
    healthBar.appendChild(healthFill)
    healthBarContainer.appendChild(healthBar)
  }
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

const setBuildMode = (mode: BuildMode) => {
  if (buildMode === mode) {
    // Toggle off if clicking same button
    buildMode = 'off'
  } else {
    buildMode = mode
  }
  buildWallBtn.classList.toggle('active', buildMode === 'wall')
  buildTowerBtn.classList.toggle('active', buildMode === 'tower')
  buildPreview.visible = buildMode !== 'off'
  if (buildMode !== 'off') {
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
    buildingCoords: null,
    buildingHealth: null,
    upgradeOptions: [],
    towerDetails: null,
    upgradeBlockedReason: null,
    canRepair: false,
    canDelete: false,
    activeUpgradeText: null
  },
  {
    onDelete: () => {
      const colliders = getSelectedInRange()
      if (colliders.length === 0) return
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
      upgradeManager.startUpgrade(tower, upgradeId, performance.now())
    },
    onRepair: () => {
      const [collider] = selectedStructures.values()
      if (!collider) return
      if (!isColliderInRange(collider, SELECTION_RADIUS)) return
      const state = structureStore.structureStates.get(collider)
      if (!state) return
      if (state.hp >= state.maxHp) return
      state.hp = state.maxHp
    }
  }
)

const updateSelectionDialog = (nowMs: number) => {
  const selectedCount = selectedStructures.size
  const inRange = getSelectedInRange()
  hudActionsEl.style.display = selectedCount > 0 && inRange.length > 0 ? 'none' : ''
  const tower = getSingleSelectedTower()
  const [selectedCollider] = selectedStructures.values()
  const selectedStructureState = selectedCollider ? (structureStore.structureStates.get(selectedCollider) ?? null) : null
  const selectedTowerTypeId = getSelectionTowerTypeId()
  const upgradeOptions = tower
    ? getTowerUpgradeOptions(tower).map(option => ({
        id: option.id,
        label: option.label,
        deltaText: getTowerUpgradeDeltaText(option.id)
      }))
    : []
  const activeUpgrade = tower ? upgradeManager.getJob(tower) : null
  let upgradeBlockedReason: string | null = null
  let activeUpgradeText: string | null = null
  if (tower && activeUpgrade) {
    const remaining = Math.max(0, Math.ceil((activeUpgrade.endsAtMs - nowMs) / 1000))
    activeUpgradeText = `Upgrading ${getTowerUpgrade(activeUpgrade.upgradeId).label} (${remaining}s)`
    upgradeBlockedReason = 'Upgrade already in progress'
  } else if (tower && inRange.length === 0) {
    upgradeBlockedReason = 'Move closer to upgrade'
  } else if (tower && upgradeManager.availableWorkers <= 0) {
    upgradeBlockedReason = 'No workers available'
  }

  selectionDialog.update({
    selectedCount,
    inRangeCount: inRange.length,
    selectedTowerTypeId,
    buildingCoords: selectedCollider
      ? {
          x: Math.round(selectedCollider.center.x),
          z: Math.round(selectedCollider.center.z)
        }
      : null,
    buildingHealth: selectedStructureState
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
          dps: tower.damage * (1 / tower.shootCadence)
        }
      : null,
    upgradeBlockedReason,
    canRepair: selectedStructureState !== null && selectedStructureState.hp < selectedStructureState.maxHp && inRange.length > 0,
    canDelete: inRange.length > 0,
    activeUpgradeText
  })
}

buildWallBtn.addEventListener('click', () => setBuildMode('wall'))
buildTowerBtn.addEventListener('click', () => setBuildMode('tower'))

shootButton.addEventListener('pointerdown', () => {
  isShooting = true
})
shootButton.addEventListener('pointerup', () => {
  isShooting = false
})
shootButton.addEventListener('pointerleave', () => {
  isShooting = false
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault()
    isShooting = true
  } else if (event.code === 'Escape') {
    event.preventDefault()
    setBuildMode('off')
  }
})

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    event.preventDefault()
    isShooting = false
  }
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
  const result = placeBuildingAt(center, buildMode, towerCharges, wallCharges, {
    staticColliders,
    structureStore,
    scene,
    createTowerAt: (snapped) => createTowerAt(snapped, 'base', player.username ?? 'Player'),
    applyObstacleDelta
  })
  wallCharges -= result.wallSpent
  towerCharges -= result.towerSpent
  return result.placed
}

const WALL_LINE_SIZE = new THREE.Vector3(1, 1, 1)
const WALL_LINE_HALF = WALL_LINE_SIZE.clone().multiplyScalar(0.5)

const getWallLinePlacement = (start: THREE.Vector3, end: THREE.Vector3, availableWallCharges: number) => {
  return computeWallLinePlacement(start, end, availableWallCharges, staticColliders)
}

const placeWallLine = (start: THREE.Vector3, end: THREE.Vector3) => {
  const placed = placeWallSegment(start, end, wallCharges, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta
  })
  wallCharges -= placed
  return placed > 0
}

const placeWallSegments = (positions: THREE.Vector3[]) => {
  const placed = placeWallSegmentsAt(positions, wallCharges, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta
  })
  wallCharges -= placed
  return placed > 0
}

const addMapTower = (center: THREE.Vector3) => {
  const size = new THREE.Vector3(1, TOWER_HEIGHT, 1)
  const half = size.clone().multiplyScalar(0.5)
  const snapped = new THREE.Vector3(snapGridValue(center.x), half.y, snapGridValue(center.z))
  if (!canPlaceAt(snapped, half, staticColliders)) return
  const tower = createTowerAt(snapped, 'base', 'Map')
  const mesh = tower.mesh
  structureStore.addTowerCollider(snapped, half, mesh, tower, TOWER_HP)
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
  new THREE.Vector3(-4, 0, 4),
  new THREE.Vector3(4, 0, -4),
  new THREE.Vector3(4, 0, 4),
  new THREE.Vector3(-4, 0, -4)
]

for (const pos of prebuiltTowers) {
  addMapTower(pos)
}

// Rebuild once after initial static map setup.
flowField.rebuildAll(staticColliders, castleGoal)
waypointCache.clear()
refreshAllMobWaypoints()

const resetGame = () => {
  lives = 1
  wave = 0
  nextWaveAt = 0
  prevMobsCount = 0
  eventBannerTimer = 0
  eventBannerEl.classList.remove('show')
  eventBannerEl.textContent = ''
  finalCountdownEl.classList.remove('show')
  finalCountdownEl.textContent = ''
  setBuildMode('off')
  selectedTower = null
  selectedStructures.clear()
  structureOutlinePass.selectedObjects = []
  isDraggingWall = false
  wallDragStart = null
  wallDragEnd = null
  wallDragValidPositions = []

  for (const mob of mobs) {
    scene.remove(mob.mesh)
  }
  mobs.length = 0

  for (const tower of towers) {
    upgradeManager.cancelForTower(tower)
    scene.remove(tower.mesh)
    scene.remove(tower.rangeRing)
    scene.remove(tower.laser)
  }
  towers.length = 0

  for (const wall of structureStore.wallMeshes) {
    scene.remove(wall)
  }
  structureStore.wallMeshes.length = 0
  structureStore.structureStates.clear()
  structureStore.structureMeshToCollider.clear()

  staticColliders.length = 0
  staticColliders.push(castleCollider)

  wallCharges = WALL_CHARGE_MAX
  towerCharges = TOWER_CHARGE_MAX

  flowField.rebuildAll(staticColliders, castleGoal)
  waypointCache.clear()
}

const setMoveTarget = (pos: THREE.Vector3) => {
  const clamped = new THREE.Vector3(clamp(pos.x, -WORLD_BOUNDS, WORLD_BOUNDS), 0, clamp(pos.z, -WORLD_BOUNDS, WORLD_BOUNDS))
  player.target.copy(clamped)
}

const motionSystem = createEntityMotionSystem({
  flowField,
  structureStore,
  staticColliders,
  spatialGrid,
  npcs,
  castleGoal,
  constants: {
    mobSiegeAttackCooldown: MOB_SIEGE_ATTACK_COOLDOWN,
    mobSiegeDamage: MOB_SIEGE_DAMAGE,
    mobSiegeRangeBuffer: MOB_SIEGE_RANGE_BUFFER,
    mobSiegeUnreachableGrace: MOB_SIEGE_UNREACHABLE_GRACE,
    worldBounds: WORLD_BOUNDS,
    gridSize: GRID_SIZE
  },
  spawnCubeEffects
})

renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('#hud, .selection-dialog')) return
  activePointerId = event.pointerId
  renderer.domElement.setPointerCapture(event.pointerId)
  if (buildMode !== 'off') {
    const point = getGroundPoint(event)
    if (!point) return
    if (buildMode === 'wall') {
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
  if (buildMode === 'off') return
  const point = getGroundPoint(event)
  if (!point) return
  
  if (buildMode === 'wall' && isDraggingWall && wallDragStart) {
    wallDragEnd = point.clone()

    // Show one continuous preview mesh for the wall segment.
    const availableWallPreview = Math.floor(wallCharges)
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
    const isTower = buildMode === 'tower'
    const size = isTower ? new THREE.Vector3(1, 2, 1) : new THREE.Vector3(1, 1, 1)
    const half = size.clone().multiplyScalar(0.5)
    const snapped = new THREE.Vector3(snapGridValue(point.x), half.y, snapGridValue(point.z))
    const chargesAvailable = isTower ? towerCharges : wallCharges
    const ok = canPlace(snapped, half, true) && chargesAvailable > 0
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
  isShooting = false
  if (buildMode === 'wall' && isDraggingWall && wallDragStart && wallDragEnd) {
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
  eventBannerTimer = EVENT_BANNER_DURATION
}

const spawnWave = () => {
  wave += 1
  const count = (5 + wave * 2) * 10
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const radius = 22 + Math.random() * 6
    const pos = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    makeMob(pos)
  }
  triggerEventBanner(`Wave ${wave} spawned`)
}

const pickMobInRange = (center: THREE.Vector3, radius: number) => {
  let best: Entity | null = null
  let bestDistToBase = Number.POSITIVE_INFINITY
  const candidates = spatialGrid.getNearby(center, radius)
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

const tick = (now: number, delta: number) => {

  for (const completed of upgradeManager.collectCompleted(now)) {
    applyTowerUpgrade(completed.tower, completed.upgradeId)
    triggerEventBanner(`${getTowerUpgrade(completed.upgradeId).label} upgraded`)
  }

  wallCharges = Math.min(WALL_CHARGE_MAX, wallCharges + WALL_RECHARGE_RATE * delta)
  towerCharges = Math.min(TOWER_CHARGE_MAX, towerCharges + TOWER_RECHARGE_RATE * delta)
  if (buildMode === 'wall' && wallCharges < 1) {
    setBuildMode('off')
  }
  if (buildMode === 'tower' && towerCharges < 1) {
    setBuildMode('off')
  }

  if (pendingWaypointRefresh) {
    const stop = Math.min(mobs.length, pendingWaypointRefreshIndex + WAYPOINT_REFRESH_BATCH_SIZE)
    for (let i = pendingWaypointRefreshIndex; i < stop; i += 1) {
      const mob = mobs[i]!
      mob.waypoints = flowField.computeWaypoints(mob.mesh.position, castleGoal)
      mob.waypointIndex = 0
    }
    pendingWaypointRefreshIndex = stop
    if (pendingWaypointRefreshIndex >= mobs.length) {
      pendingWaypointRefresh = false
      pendingWaypointRefreshIndex = 0
    }
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

  for (const tower of towers) {
    tower.shootCooldown = Math.max(tower.shootCooldown - delta, 0)
    tower.laserVisibleTime = Math.max(tower.laserVisibleTime - delta, 0)

    const target = pickMobInRange(tower.mesh.position, tower.range)
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
        const prevHp = target.hp ?? 1
        const nextHp = prevHp - tower.damage
        target.hp = nextHp
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
    const nearby = spatialGrid.getNearby(entity.mesh.position, (entity.radius + 0.5) * 2)
    for (const other of nearby) {
      if (processed.has(other)) continue // Already processed this pair
      resolveCircleCircle(entity, other)
    }
  }

  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    const mob = mobs[i]
    // Check if mob has reached castle - distance from mob center to castle center
    // should be less than castle halfSize + mob radius (they're touching)
    const dx = mob.mesh.position.x - castleCollider.center.x
    const dz = mob.mesh.position.z - castleCollider.center.z
    const distToCastleCenter = Math.sqrt(dx * dx + dz * dz)
    const castleReachDistance = castleCollider.halfSize.x + mob.radius + 0.2 // small buffer
    
    if (distToCastleCenter < castleReachDistance) {
      spawnCubeEffects(mob.mesh.position.clone())
      lives = Math.max(lives - 1, 0)
      scene.remove(mob.mesh)
      mobs.splice(i, 1)
      if (lives === 0) {
        resetGame()
        break
      }
    } else if ((mob.hp ?? 0) <= 0) {
      spawnMobDeathEffects(mob.mesh.position.clone())
      scene.remove(mob.mesh)
      mobs.splice(i, 1)
    }
  }

  if (wave > 0 && mobs.length === 0 && nextWaveAt === 0) {
    nextWaveAt = now + 10000
  }
  if (mobs.length === 0 && now >= nextWaveAt && nextWaveAt !== 0) {
    nextWaveAt = 0
    spawnWave()
  }
  if (wave === 0) {
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
  updateSelectionDialog(now)
  syncSelectedStructureOutline()
  structureOutlinePass.edgeStrength = 3.8 + Math.sin(now * 0.01) * 0.5

  ring.position.set(player.mesh.position.x, 0.02, player.mesh.position.z)
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
  const arrowLength = arrowDir.length()
  if (arrowLength >= 1.0) {
    arrowDir.normalize()
    arrow.position.copy(player.mesh.position)
    arrow.setDirection(arrowDir)
    arrow.setLength(Math.min(arrowLength, 12), 0.6, 0.5)
    arrow.visible = true
  } else {
    arrow.visible = false
  }

  // Update laser visibility timer
  if (laserVisibleTime > 0) {
    laserVisibleTime -= delta
  }
  
  if (isShooting && selected) {
    const start = player.mesh.position.clone()
    const end = selected.mesh.position.clone()
    const direction = new THREE.Vector3().subVectors(end, start)
    const length = direction.length()
    
    // Always update laser position/rotation when shooting, but only show when timer is active
    laser.position.copy(start).add(end).multiplyScalar(0.5)
    laser.scale.set(1, length, 1)
    laser.lookAt(end)
    laser.rotateX(Math.PI / 2)
    
    shootCooldown -= delta
    if (shootCooldown <= 0) {
      selected.hp = (selected.hp ?? 1) - SHOOT_DAMAGE
      shootCooldown = SHOOT_COOLDOWN
      // Show laser for 0.1 seconds when shot fires
      laserVisibleTime = 0.1
    }
  } else {
    shootCooldown = Math.max(shootCooldown - delta, 0)
  }
  
  // Only show laser when visibility timer is active
  laser.visible = laserVisibleTime > 0 && selected !== null

  camera.position.copy(player.mesh.position).add(cameraOffset)
  camera.lookAt(player.mesh.position)
  camera.updateMatrixWorld()

  updateHealthBars()
  updateUsernameLabels()
  
  // Update ground + grid to cover the visible camera rectangle
  const visibleBounds = getVisibleGroundBounds(camera)
  updateGroundFromBounds(visibleBounds)
  worldGrid.update(visibleBounds)

  const wallAvailable = Math.floor(wallCharges)
  const towerAvailable = Math.floor(towerCharges)
  wallCountEl.textContent = `x${wallAvailable}`
  towerCountEl.textContent = `x${towerAvailable}`
  buildWallBtn.disabled = wallAvailable <= 0
  buildTowerBtn.disabled = towerAvailable <= 0
  const nextWaveIn = mobs.length === 0 && nextWaveAt !== 0 ? Math.max(0, Math.ceil((nextWaveAt - now) / 1000)) : 0
  const showNextWave = mobs.length === 0 && nextWaveAt !== 0
  waveEl.textContent = String(showNextWave ? wave + 1 : wave)
  nextWaveRowEl.style.display = showNextWave ? '' : 'none'
  mobsRowEl.style.display = showNextWave ? 'none' : ''
  if (showNextWave) {
    nextWavePrimaryEl.textContent = ''
    nextWaveSecondaryEl.textContent = `In ${nextWaveIn} seconds`
  } else {
    mobsPrimaryEl.textContent = ''
    mobsSecondaryEl.textContent = `${mobs.length} mobs left`
  }

  if (nextWaveIn > 0 && nextWaveIn <= 5) {
    finalCountdownEl.textContent = String(nextWaveIn)
    finalCountdownEl.classList.add('show')
  } else {
    finalCountdownEl.classList.remove('show')
    finalCountdownEl.textContent = ''
  }

  if (prevMobsCount > 0 && mobs.length === 0) {
    triggerEventBanner('Wave cleared')
  }

  if (eventBannerTimer > 0) {
    eventBannerTimer = Math.max(0, eventBannerTimer - delta)
    if (eventBannerTimer === 0) {
      eventBannerEl.classList.remove('show')
      eventBannerEl.textContent = ''
    }
  }

  prevMobsCount = mobs.length
  
  // Update shoot button cooldown visual
  const cooldownPercent = Math.min(1, shootCooldown / SHOOT_COOLDOWN)
  const clipPercent = (1 - cooldownPercent) * 100
  shootButton.style.setProperty('--cooldown-clip', `inset(0 0 0 ${clipPercent}%)`)
  // Make unlock instant by removing transition when cooldown is complete
  shootButton.classList.toggle('unlocked', cooldownPercent <= 0.01)

  const wallFraction = wallCharges - Math.floor(wallCharges)
  const wallCooldownPercent =
    wallCharges >= WALL_CHARGE_MAX
      ? 0
      : wallFraction === 0
        ? 1
        : 1 - wallFraction
  const wallClipPercent = (1 - wallCooldownPercent) * 100
  buildWallBtn.style.setProperty('--cooldown-clip', `inset(0 0 0 ${wallClipPercent}%)`)
  buildWallBtn.classList.toggle('unlocked', wallCooldownPercent <= 0.01)

  const towerFraction = towerCharges - Math.floor(towerCharges)
  const towerCooldownPercent =
    towerCharges >= TOWER_CHARGE_MAX
      ? 0
      : towerFraction === 0
        ? 1
        : 1 - towerFraction
  const towerClipPercent = (1 - towerCooldownPercent) * 100
  buildTowerBtn.style.setProperty('--cooldown-clip', `inset(0 0 0 ${towerClipPercent}%)`)
  buildTowerBtn.classList.toggle('unlocked', towerCooldownPercent <= 0.01)

  composer.render()
}

const gameLoop = createGameLoop(tick)
gameLoop.start()

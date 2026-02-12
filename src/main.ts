import './style.css'
import * as THREE from 'three'

type StaticCollider = {
  center: THREE.Vector3
  halfSize: THREE.Vector3
  type: 'castle' | 'wall' | 'tower'
}

type Entity = {
  mesh: THREE.Mesh
  radius: number
  speed: number
  velocity: THREE.Vector3
  target: THREE.Vector3
  kind: 'player' | 'mob' | 'npc'
  hp?: number
  maxHp?: number
  baseY: number
  waypoints?: THREE.Vector3[] // For mobs: pre-computed path waypoints
  waypointIndex?: number // Current waypoint index
  username?: string
}

type Tower = {
  mesh: THREE.Mesh
  range: number
  shootCooldown: number
  laserVisibleTime: number
  laser: THREE.Mesh
  rangeRing: THREE.Mesh
}

const SELECTION_RADIUS = 8
const WORLD_BOUNDS = 30
const GRID_SIZE = 1
const CASTLE_RADIUS = 0.5
const PLAYER_SPEED = 6
const MOB_SPEED = 3
const NPC_SPEED = 4
const SHOOT_COOLDOWN = 0.5
const SHOOT_DAMAGE = 5
const TOWER_RANGE = 8
const TOWER_SHOOT_COOLDOWN = 0.25
const TOWER_HEIGHT = 2
const WALL_CHARGE_MAX = 3
const TOWER_CHARGE_MAX = 2
const CHARGE_FULL_RECHARGE_TIME = 60
const WALL_RECHARGE_RATE = WALL_CHARGE_MAX / CHARGE_FULL_RECHARGE_TIME
const TOWER_RECHARGE_RATE = TOWER_CHARGE_MAX / CHARGE_FULL_RECHARGE_TIME

// Flow field constants
const FLOW_FIELD_RESOLUTION = GRID_SIZE
const FLOW_FIELD_SIZE = Math.ceil((WORLD_BOUNDS * 2) / FLOW_FIELD_RESOLUTION)
const SPATIAL_GRID_CELL_SIZE = 3

// Waypoint cache for sharing paths between mobs
class WaypointCache {
  private cache: Map<string, THREE.Vector3[]>
  private gridSnap: number

  constructor(gridSnap: number) {
    this.cache = new Map()
    this.gridSnap = gridSnap
  }

  private getKey(pos: THREE.Vector3): string {
    // Snap to grid for sharing between nearby spawns
    const gx = Math.floor(pos.x / this.gridSnap)
    const gz = Math.floor(pos.z / this.gridSnap)
    return `${gx},${gz}`
  }

  get(start: THREE.Vector3): THREE.Vector3[] | null {
    return this.cache.get(this.getKey(start)) || null
  }

  set(start: THREE.Vector3, waypoints: THREE.Vector3[]) {
    this.cache.set(this.getKey(start), waypoints)
  }

  clear() {
    this.cache.clear()
  }
}

// Flow Field Pathfinding System
class FlowField {
  private grid: Float32Array // Stores direction vectors: [x0, z0, x1, z1, ...]
  private costs: Float32Array // Stores path costs for Dijkstra
  private size: number
  private resolution: number

  constructor(size: number, resolution: number) {
    this.size = size
    this.resolution = resolution
    this.grid = new Float32Array(size * size * 2) // 2 floats per cell (x, z direction)
    this.costs = new Float32Array(size * size)
  }

  private worldToGrid(x: number, z: number): [number, number] {
    const gx = Math.floor((x + WORLD_BOUNDS) / this.resolution)
    const gz = Math.floor((z + WORLD_BOUNDS) / this.resolution)
    return [Math.max(0, Math.min(this.size - 1, gx)), Math.max(0, Math.min(this.size - 1, gz))]
  }

  private gridToWorld(gx: number, gz: number): [number, number] {
    const x = gx * this.resolution - WORLD_BOUNDS + this.resolution * 0.5
    const z = gz * this.resolution - WORLD_BOUNDS + this.resolution * 0.5
    return [x, z]
  }

  private getIndex(gx: number, gz: number): number {
    return gz * this.size + gx
  }

  private isBlocked(gx: number, gz: number, staticColliders: StaticCollider[]): boolean {
    const [wx, wz] = this.gridToWorld(gx, gz)
    const testPos = new THREE.Vector3(wx, 0, wz)
    const testRadius = this.resolution * 0.4 // Slightly smaller than cell to allow passage

    for (const collider of staticColliders) {
      if (collider.type === 'castle') continue // Castle is the goal
      const minX = collider.center.x - collider.halfSize.x - testRadius
      const maxX = collider.center.x + collider.halfSize.x + testRadius
      const minZ = collider.center.z - collider.halfSize.z - testRadius
      const maxZ = collider.center.z + collider.halfSize.z + testRadius
      if (testPos.x >= minX && testPos.x <= maxX && testPos.z >= minZ && testPos.z <= maxZ) {
        return true
      }
    }
    return false
  }

  compute(staticColliders: StaticCollider[], goal: THREE.Vector3) {
    // Initialize costs to infinity
    this.costs.fill(Number.POSITIVE_INFINITY)
    this.grid.fill(0)

    const [goalGx, goalGz] = this.worldToGrid(goal.x, goal.z)
    const goalIdx = this.getIndex(goalGx, goalGz)

    // Min-heap priority queue: [cost, gx, gz]
    const heap: Array<[number, number, number]> = []
    const heapPush = (item: [number, number, number]) => {
      heap.push(item)
      let i = heap.length - 1
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2)
        if (heap[parent][0] <= heap[i][0]) break
        [heap[parent], heap[i]] = [heap[i], heap[parent]]
        i = parent
      }
    }
    const heapPop = (): [number, number, number] => {
      const top = heap[0]!
      const bottom = heap.pop()!
      if (heap.length === 0) return top
      heap[0] = bottom
      let i = 0
      while (true) {
        const left = i * 2 + 1
        const right = i * 2 + 2
        let smallest = i
        if (left < heap.length && heap[left]![0] < heap[smallest]![0]) smallest = left
        if (right < heap.length && heap[right]![0] < heap[smallest]![0]) smallest = right
        if (smallest === i) break
        [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!]
        i = smallest
      }
      return top
    }

    this.costs[goalIdx] = 0
    heapPush([0, goalGx, goalGz])

    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1]
    ]

    while (heap.length > 0) {
      const [cost, gx, gz] = heapPop()
      const idx = this.getIndex(gx, gz)

      // Skip if we already found a better path
      if (cost > this.costs[idx]) continue

      for (const [dx, dz] of neighbors) {
        const ngx = gx + dx
        const ngz = gz + dz
        if (ngx < 0 || ngx >= this.size || ngz < 0 || ngz >= this.size) continue

        const nidx = this.getIndex(ngx, ngz)
        
        // Check if blocked
        if (this.isBlocked(ngx, ngz, staticColliders)) {
          this.costs[nidx] = Number.POSITIVE_INFINITY
          continue
        }

        // Diagonal cost is sqrt(2), cardinal is 1
        const moveCost = (dx !== 0 && dz !== 0) ? 1.414 : 1.0
        const newCost = cost + moveCost

        if (newCost < this.costs[nidx]) {
          this.costs[nidx] = newCost
          heapPush([newCost, ngx, ngz])

          // Set direction vector toward this cell (from neighbor to current)
          const dirX = (gx - ngx) * this.resolution
          const dirZ = (gz - ngz) * this.resolution
          const len = Math.sqrt(dirX * dirX + dirZ * dirZ)
          if (len > 0.001) {
            this.grid[nidx * 2] = dirX / len
            this.grid[nidx * 2 + 1] = dirZ / len
          }
        }
      }
    }
  }

  getDirection(pos: THREE.Vector3): THREE.Vector3 {
    const [gx, gz] = this.worldToGrid(pos.x, pos.z)
    const idx = this.getIndex(gx, gz)
    
    // If unreachable, fallback to direct-to-goal
    if (this.costs[idx] === Number.POSITIVE_INFINITY) {
      const dir = new THREE.Vector3(-pos.x, 0, -pos.z)
      if (dir.length() > 0.001) {
        dir.normalize()
        return dir
      }
      return new THREE.Vector3(0, 0, 0)
    }

    // Sample flow field with bilinear interpolation for smoothness
    const fx = (pos.x + WORLD_BOUNDS) / this.resolution
    const fz = (pos.z + WORLD_BOUNDS) / this.resolution
    const gx0 = Math.floor(fx)
    const gz0 = Math.floor(fz)
    const gx1 = Math.min(gx0 + 1, this.size - 1)
    const gz1 = Math.min(gz0 + 1, this.size - 1)
    
    const tx = fx - gx0
    const tz = fz - gz0

    const sample = (gx: number, gz: number) => {
      const idx = this.getIndex(gx, gz)
      return new THREE.Vector3(this.grid[idx * 2], 0, this.grid[idx * 2 + 1])
    }

    const v00 = sample(gx0, gz0)
    const v10 = sample(gx1, gz0)
    const v01 = sample(gx0, gz1)
    const v11 = sample(gx1, gz1)

    const v0 = new THREE.Vector3().lerpVectors(v00, v10, tx)
    const v1 = new THREE.Vector3().lerpVectors(v01, v11, tx)
    const result = new THREE.Vector3().lerpVectors(v0, v1, tz)

    if (result.length() < 0.001) {
      // Fallback to direct-to-goal
      const dir = new THREE.Vector3(-pos.x, 0, -pos.z)
      if (dir.length() > 0.001) {
        dir.normalize()
        return dir
      }
    }

    return result.normalize()
  }

  // Compute waypoints from start to goal following flow field
  computeWaypoints(start: THREE.Vector3, goal: THREE.Vector3, maxWaypoints = 100): THREE.Vector3[] {
    const waypoints: THREE.Vector3[] = [start.clone()]
    let current = start.clone()
    const waypointSpacing = this.resolution * 2 // Space waypoints every 2 grid cells
    const maxDistance = start.distanceTo(goal) * 2 // Safety limit

    for (let i = 0; i < maxWaypoints; i++) {
      const dir = this.getDirection(current)
      if (dir.length() < 0.001) break // Reached goal or stuck

      // Move along flow field (create new vector, don't mutate current)
      const next = current.clone().add(dir.clone().multiplyScalar(waypointSpacing))

      // Check if we're close enough to goal
      const distToGoal = next.distanceTo(goal)
      if (distToGoal < waypointSpacing * 1.5) {
        waypoints.push(goal.clone())
        break
      }

      waypoints.push(next.clone())
      current = next

      // Safety check: if we've moved too far, something's wrong
      if (current.distanceTo(start) > maxDistance) break
    }

    return waypoints
  }
}

// Spatial Grid for efficient dynamic collision checks
class SpatialGrid {
  private cells: Map<string, Entity[]>
  private cellSize: number

  constructor(cellSize: number) {
    this.cells = new Map()
    this.cellSize = cellSize
  }

  private getCellKey(x: number, z: number): string {
    const gx = Math.floor(x / this.cellSize)
    const gz = Math.floor(z / this.cellSize)
    return `${gx},${gz}`
  }

  clear() {
    this.cells.clear()
  }

  insert(entity: Entity) {
    const key = this.getCellKey(entity.mesh.position.x, entity.mesh.position.z)
    if (!this.cells.has(key)) {
      this.cells.set(key, [])
    }
    this.cells.get(key)!.push(entity)
  }

  getNearby(pos: THREE.Vector3, radius: number): Entity[] {
    const results: Entity[] = []
    const minGx = Math.floor((pos.x - radius) / this.cellSize)
    const maxGx = Math.floor((pos.x + radius) / this.cellSize)
    const minGz = Math.floor((pos.z - radius) / this.cellSize)
    const maxGz = Math.floor((pos.z + radius) / this.cellSize)

    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gz = minGz; gz <= maxGz; gz++) {
        const key = `${gx},${gz}`
        const cell = this.cells.get(key)
        if (cell) {
          for (const entity of cell) {
            const dx = entity.mesh.position.x - pos.x
            const dz = entity.mesh.position.z - pos.z
            const distSq = dx * dx + dz * dz
            if (distSq <= radius * radius) {
              results.push(entity)
            }
          }
        }
      }
    }
    return results
  }
}

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
            <span id="wallCount" class="hud-badge">3</span>
          </button>
          <button id="buildTower" class="hud-button build-button">
            <span class="button-label">Tower</span>
            <span id="towerCount" class="hud-badge">2</span>
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
const wallMeshes: THREE.Mesh[] = []

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
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(halfSize.x * 2, halfSize.y * 2, halfSize.z * 2),
    new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
  )
  mesh.position.copy(snappedCenter)
  scene.add(mesh)
  wallMeshes.push(mesh)
  staticColliders.push({ center: snappedCenter.clone(), halfSize: halfSize.clone(), type: 'wall' })
}

// Add some basic walls for mobs to navigate around
addMapWall(new THREE.Vector3(8, 0.5, 8), new THREE.Vector3(0.5, 0.5, 4))
addMapWall(new THREE.Vector3(-8, 0.5, -8), new THREE.Vector3(4, 0.5, 0.5))
addMapWall(new THREE.Vector3(10, 0.5, -5), new THREE.Vector3(3, 0.5, 0.5))
addMapWall(new THREE.Vector3(-10, 0.5, 5), new THREE.Vector3(0.5, 0.5, 3))
addMapWall(new THREE.Vector3(0, 0.5, 12), new THREE.Vector3(5, 0.5, 0.5))

// Initialize flow field and spatial grid
const flowField = new FlowField(FLOW_FIELD_SIZE, FLOW_FIELD_RESOLUTION)
const spatialGrid = new SpatialGrid(SPATIAL_GRID_CELL_SIZE)
const waypointCache = new WaypointCache(GRID_SIZE * 2) // Share waypoints within 2 grid cells

// Compute initial flow field (exclude castle from pathfinding)
// Note: walls are added after this, so flow field will be recomputed when walls are added
const collisionColliders = staticColliders.filter(c => c.type !== 'castle')
flowField.compute(collisionColliders, new THREE.Vector3(0, 0, 0))

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

const mobs: Entity[] = []
const towers: Tower[] = []
let selectedTower: Tower | null = null

const makeMob = (pos: THREE.Vector3) => {
  const mob = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff7a7a })
  )
  mob.position.copy(pos).setY(0.4)
  scene.add(mob)
  
  // Try to get cached waypoints, otherwise compute new ones
  const goal = new THREE.Vector3(0, 0, 0)
  let waypoints = waypointCache.get(pos)
  if (!waypoints) {
    waypoints = flowField.computeWaypoints(pos, goal)
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
    waypointIndex: 0
  })
}

let buildMode: 'off' | 'wall' | 'tower' = 'off'
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
const EVENT_BANNER_DURATION = 2.4
let eventBannerTimer = 0
let prevMobsCount = 0
let prevNextWaveIn = 0

// Particle system
type CubeParticle = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  lifetime: number
  maxLifetime: number
}

type CubeParticleOptions = {
  sizeMin?: number
  sizeMax?: number
  lifetimeMin?: number
  lifetimeMax?: number
  color?: number
  angularVelocityScale?: number
}

type CubeEffectOptions = {
  countMin?: number
  countMax?: number
  speedMin?: number
  speedMax?: number
  verticalMin?: number
  verticalMax?: number
  particle?: CubeParticleOptions
}

const cubeParticles: CubeParticle[] = []

const createCubeParticle = (
  pos: THREE.Vector3,
  velocity: THREE.Vector3,
  options: CubeParticleOptions = {}
): CubeParticle => {
  const sizeMin = options.sizeMin ?? 0.15
  const sizeMax = options.sizeMax ?? 0.25
  const size = sizeMin + Math.random() * (sizeMax - sizeMin)
  const lifetimeMin = options.lifetimeMin ?? 1.5
  const lifetimeMax = options.lifetimeMax ?? 1.5
  const maxLifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin)
  const angularScale = options.angularVelocityScale ?? 10
  const particle = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: options.color ?? 0xff7a7a, transparent: true })
  )
  particle.position.copy(pos)
  scene.add(particle)
  return {
    mesh: particle,
    velocity: velocity.clone(),
    angularVelocity: new THREE.Vector3(
      (Math.random() - 0.5) * angularScale,
      (Math.random() - 0.5) * angularScale,
      (Math.random() - 0.5) * angularScale
    ),
    lifetime: maxLifetime,
    maxLifetime
  }
}

const spawnCubeEffects = (pos: THREE.Vector3, options: CubeEffectOptions = {}) => {
  const countMin = options.countMin ?? 6
  const countMax = options.countMax ?? 10
  const count = countMin + Math.floor(Math.random() * (countMax - countMin + 1))
  const speedMin = options.speedMin ?? 2
  const speedMax = options.speedMax ?? 4
  const verticalMin = options.verticalMin ?? 3
  const verticalMax = options.verticalMax ?? 5
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = speedMin + Math.random() * (speedMax - speedMin)
    const velocity = new THREE.Vector3(
      Math.cos(angle) * speed,
      verticalMin + Math.random() * (verticalMax - verticalMin),
      Math.sin(angle) * speed
    )
    cubeParticles.push(createCubeParticle(pos.clone(), velocity, options.particle))
  }
}

const spawnMobDeathEffects = (pos: THREE.Vector3) => {
  spawnCubeEffects(pos, {
    countMin: 6,
    countMax: 10,
    speedMin: 2.2,
    speedMax: 3.8,
    verticalMin: 3.2,
    verticalMax: 5.2,
    particle: {
      sizeMin: 0.18,
      sizeMax: 0.35,
      lifetimeMin: 1.8,
      lifetimeMax: 2.6,
      angularVelocityScale: 16
    }
  })
}

const updateParticles = (delta: number) => {
  // Update cube particles
  for (let i = cubeParticles.length - 1; i >= 0; i--) {
    const particle = cubeParticles[i]!
    particle.lifetime -= delta
    particle.velocity.y -= 9.8 * delta // Gravity
    particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta))
    
    // Rotate cube
    particle.mesh.rotation.x += particle.angularVelocity.x * delta
    particle.mesh.rotation.y += particle.angularVelocity.y * delta
    particle.mesh.rotation.z += particle.angularVelocity.z * delta
    
    // Fade out
    const opacity = Math.max(0, particle.lifetime / particle.maxLifetime)
    ;(particle.mesh.material as THREE.MeshStandardMaterial).opacity = opacity
    
    if (particle.lifetime <= 0 || particle.mesh.position.y < -1) {
      scene.remove(particle.mesh)
      cubeParticles.splice(i, 1)
    }
  }
}

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

const castleLivesContainer = document.createElement('div')
castleLivesContainer.style.position = 'fixed'
castleLivesContainer.style.top = '0'
castleLivesContainer.style.left = '0'
castleLivesContainer.style.width = '100%'
castleLivesContainer.style.height = '100%'
castleLivesContainer.style.pointerEvents = 'none'
castleLivesContainer.style.zIndex = '998'
app.appendChild(castleLivesContainer)

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

const updateCastleLivesText = () => {
  // Clear existing text
  castleLivesContainer.innerHTML = ''
  
  const screenPos = worldToScreen(
    player.mesh.position.clone().setY(player.baseY + 1.0)
  )
  if (!screenPos) return
  
  const label = document.createElement('div')
  label.textContent = `${lives} Lives`
  label.style.position = 'absolute'
  label.style.left = `${screenPos.x}px`
  label.style.top = `${screenPos.y}px`
  label.style.transform = 'translate(-50%, -50%)'
  label.style.color = '#fff'
  label.style.fontSize = '24px'
  label.style.fontWeight = '600'
  label.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)'
  label.style.whiteSpace = 'nowrap'
  label.style.pointerEvents = 'none'
  label.style.opacity = '0.6'
  
  castleLivesContainer.appendChild(label)
}

const buildPreview = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x66ff66, transparent: true, opacity: 0.4 })
)
buildPreview.visible = false
scene.add(buildPreview)

// Preview meshes for wall line
const wallPreviewMeshes: THREE.Mesh[] = []
const createWallPreview = () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x66ff66, transparent: true, opacity: 0.4 })
  )
  mesh.visible = false
  scene.add(mesh)
  wallPreviewMeshes.push(mesh)
  return mesh
}
// Pre-create preview meshes for wall charges
for (let i = 0; i < WALL_CHARGE_MAX; i += 1) {
  createWallPreview()
}

const setBuildMode = (mode: 'off' | 'wall' | 'tower') => {
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
    selectedTower = null
  }
  isDraggingWall = false
  wallDragStart = null
  wallDragEnd = null
  // Hide wall preview meshes when exiting build mode
  if (buildMode === 'off') {
    for (const preview of wallPreviewMeshes) {
      preview.visible = false
    }
  }
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE

const updatePointer = (event: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

const getGroundPoint = (event: PointerEvent) => {
  updatePointer(event)
  raycaster.setFromCamera(pointer, camera)
  const point = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(groundPlane, point)
  return hit ? point : null
}

const getTowerHit = (event: PointerEvent) => {
  if (towers.length === 0) return null
  updatePointer(event)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(towers.map(tower => tower.mesh), false)
  if (hits.length === 0) return null
  const hitMesh = hits[0]!.object
  return towers.find(tower => tower.mesh === hitMesh) ?? null
}

const withinBounds = (pos: THREE.Vector3) =>
  pos.x > -WORLD_BOUNDS && pos.x < WORLD_BOUNDS && pos.z > -WORLD_BOUNDS && pos.z < WORLD_BOUNDS

const canPlace = (center: THREE.Vector3, halfSize: THREE.Vector3, allowTouchingWalls = false) => {
  if (!withinBounds(center)) return false
  if (center.length() < CASTLE_RADIUS + 2) return false
  for (const collider of staticColliders) {
    if (collider.type === 'castle') continue // Castle has no collision
    // For wall placement, allow walls to touch (but not overlap)
    const isWallCollision = collider.type === 'wall' && allowTouchingWalls
    if (aabbOverlap(center, halfSize, collider.center, collider.halfSize, isWallCollision)) {
      return false
    }
  }
  return true
}

const placeBuilding = (center: THREE.Vector3) => {
  const isTower = buildMode === 'tower'
  const size = isTower ? new THREE.Vector3(1, TOWER_HEIGHT, 1) : new THREE.Vector3(1, 1, 1)
  const half = size.clone().multiplyScalar(0.5)
  const snapped = new THREE.Vector3(snapToGrid(center.x), half.y, snapToGrid(center.z))
  if (!canPlace(snapped, half)) return false
  if (isTower ? towerCharges < 1 : wallCharges < 1) return false
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color: isTower ? 0x5aa4ff : 0x7a8a99 })
  )
  mesh.position.copy(snapped)
  scene.add(mesh)
  if (!isTower) {
    wallMeshes.push(mesh)
  }
  staticColliders.push({ center: snapped.clone(), halfSize: half.clone(), type: isTower ? 'tower' : 'wall' })
  if (isTower) {
    const rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(TOWER_RANGE - 0.12, TOWER_RANGE, 32),
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

    towers.push({
      mesh,
      range: TOWER_RANGE,
      shootCooldown: 0,
      laserVisibleTime: 0,
      laser: towerLaser,
      rangeRing
    })
    towerCharges -= 1
  } else {
    wallCharges -= 1
  }
  // Recompute flow field and clear waypoint cache when static obstacles change
  const collisionColliders = staticColliders.filter(c => c.type !== 'castle')
  flowField.compute(collisionColliders, new THREE.Vector3(0, 0, 0))
  waypointCache.clear()
  // Recompute waypoints for all existing mobs
  const goal = new THREE.Vector3(0, 0, 0)
  for (const mob of mobs) {
    const waypoints = flowField.computeWaypoints(mob.mesh.position, goal)
    mob.waypoints = waypoints
    mob.waypointIndex = 0
  }
  return true
}

const getCardinalWallLine = (start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] => {
  // Snap both start and end to grid
  const startSnapped = new THREE.Vector3(snapToGrid(start.x), 0, snapToGrid(start.z))
  const endSnapped = new THREE.Vector3(snapToGrid(end.x), 0, snapToGrid(end.z))
  
  // Convert to grid coordinates (integers)
  const x0 = Math.round(startSnapped.x / GRID_SIZE)
  const z0 = Math.round(startSnapped.z / GRID_SIZE)
  const x1 = Math.round(endSnapped.x / GRID_SIZE)
  const z1 = Math.round(endSnapped.z / GRID_SIZE)
  
  // Calculate differences
  const dx = x1 - x0
  const dz = z1 - z0
  
  // Determine cardinal direction (only allow pure horizontal or vertical)
  const isHorizontal = Math.abs(dx) > Math.abs(dz)
  const isVertical = Math.abs(dz) > Math.abs(dx)
  
  // If not clearly cardinal, use the dominant direction
  let dirX = 0
  let dirZ = 0
  if (isHorizontal) {
    dirX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  } else if (isVertical) {
    dirZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  } else {
    // If equal, prefer horizontal
    dirX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  }
  
  // Calculate number of steps
  const steps = isHorizontal ? Math.abs(dx) : Math.abs(dz)
  
  const positions: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + dirX * i
    const z = z0 + dirZ * i
    positions.push(new THREE.Vector3(x * GRID_SIZE, 0, z * GRID_SIZE))
  }
  
  return positions
}

const placeWallLine = (start: THREE.Vector3, end: THREE.Vector3) => {
  const positions = getCardinalWallLine(start, end)
  const wallSize = new THREE.Vector3(1, 1, 1)
  const half = wallSize.clone().multiplyScalar(0.5)
  const availableWallCharges = Math.floor(wallCharges)
  if (availableWallCharges <= 0) return false
  
  // Check all positions first before placing any
  const validPositions: THREE.Vector3[] = []
  const seenKeys = new Set<string>()
  
  for (const pos of positions) {
    if (validPositions.length >= availableWallCharges) break
    
    const snapped = new THREE.Vector3(snapToGrid(pos.x), half.y, snapToGrid(pos.z))
    const key = `${snapped.x},${snapped.z}`
    
    // Skip duplicates
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    
    // Check if this position can be placed (against existing colliders only)
    // Allow walls to touch when placing lines
    if (canPlace(snapped, half, true)) {
      validPositions.push(snapped)
    } else {
      // Stop at first invalid position to avoid gaps
      break
    }
  }
  
  // Now place all valid positions
  let placed = 0
  for (const pos of validPositions) {
    if (placed >= availableWallCharges) break
    
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(wallSize.x, wallSize.y, wallSize.z),
      new THREE.MeshStandardMaterial({ color: 0x7a8a99 })
    )
    mesh.position.copy(pos)
    scene.add(mesh)
    wallMeshes.push(mesh)
    staticColliders.push({ center: pos.clone(), halfSize: half.clone(), type: 'wall' })
    placed += 1
  }
  if (placed > 0) {
    wallCharges -= placed
  }
  
  // Recompute flow field and clear waypoint cache when static obstacles change
  if (placed > 0) {
    const collisionColliders = staticColliders.filter(c => c.type !== 'castle')
    flowField.compute(collisionColliders, new THREE.Vector3(0, 0, 0))
    waypointCache.clear()
    // Recompute waypoints for all existing mobs
    const goal = new THREE.Vector3(0, 0, 0)
    for (const mob of mobs) {
      const waypoints = flowField.computeWaypoints(mob.mesh.position, goal)
      mob.waypoints = waypoints
      mob.waypointIndex = 0
    }
  }
  
  return placed > 0
}

const aabbOverlap = (aCenter: THREE.Vector3, aHalf: THREE.Vector3, bCenter: THREE.Vector3, bHalf: THREE.Vector3, allowTouching = false) => {
  const dx = Math.abs(aCenter.x - bCenter.x)
  const dz = Math.abs(aCenter.z - bCenter.z)
  const overlapX = allowTouching ? dx < aHalf.x + bHalf.x : dx <= aHalf.x + bHalf.x
  const overlapZ = allowTouching ? dz < aHalf.z + bHalf.z : dz <= aHalf.z + bHalf.z
  return overlapX && overlapZ
}

const addMapTower = (center: THREE.Vector3) => {
  const size = new THREE.Vector3(1, TOWER_HEIGHT, 1)
  const half = size.clone().multiplyScalar(0.5)
  const snapped = new THREE.Vector3(snapToGrid(center.x), half.y, snapToGrid(center.z))
  if (!withinBounds(snapped)) return
  if (snapped.length() < CASTLE_RADIUS + 2) return
  for (const collider of staticColliders) {
    if (collider.type === 'castle') continue
    if (aabbOverlap(snapped, half, collider.center, collider.halfSize)) return
  }
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color: 0x5aa4ff })
  )
  mesh.position.copy(snapped)
  scene.add(mesh)
  staticColliders.push({ center: snapped.clone(), halfSize: half.clone(), type: 'tower' })

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(TOWER_RANGE - 0.12, TOWER_RANGE, 32),
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

  towers.push({
    mesh,
    range: TOWER_RANGE,
    shootCooldown: 0,
    laserVisibleTime: 0,
    laser: towerLaser,
    rangeRing
  })
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

// Recompute flow field and clear waypoint cache after prebuilt towers
const mapCollisionColliders = staticColliders.filter(c => c.type !== 'castle')
flowField.compute(mapCollisionColliders, new THREE.Vector3(0, 0, 0))
waypointCache.clear()
for (const mob of mobs) {
  const waypoints = flowField.computeWaypoints(mob.mesh.position, new THREE.Vector3(0, 0, 0))
  mob.waypoints = waypoints
  mob.waypointIndex = 0
}

const resetGame = () => {
  lives = 1
  wave = 0
  nextWaveAt = 0
  prevMobsCount = 0
  prevNextWaveIn = 0
  eventBannerTimer = 0
  eventBannerEl.classList.remove('show')
  eventBannerEl.textContent = ''
  finalCountdownEl.classList.remove('show')
  finalCountdownEl.textContent = ''
  setBuildMode('off')
  selectedTower = null
  isDraggingWall = false
  wallDragStart = null
  wallDragEnd = null

  for (const mob of mobs) {
    scene.remove(mob.mesh)
  }
  mobs.length = 0

  for (const tower of towers) {
    scene.remove(tower.mesh)
    scene.remove(tower.rangeRing)
    scene.remove(tower.laser)
  }
  towers.length = 0

  for (const wall of wallMeshes) {
    scene.remove(wall)
  }
  wallMeshes.length = 0

  staticColliders.length = 0
  staticColliders.push(castleCollider)

  wallCharges = WALL_CHARGE_MAX
  towerCharges = TOWER_CHARGE_MAX

  flowField.compute([], new THREE.Vector3(0, 0, 0))
  waypointCache.clear()
}

const resolveCircleAabb = (pos: THREE.Vector3, radius: number, collider: StaticCollider) => {
  const minX = collider.center.x - collider.halfSize.x
  const maxX = collider.center.x + collider.halfSize.x
  const minZ = collider.center.z - collider.halfSize.z
  const maxZ = collider.center.z + collider.halfSize.z
  const closestX = clamp(pos.x, minX, maxX)
  const closestZ = clamp(pos.z, minZ, maxZ)
  const dx = pos.x - closestX
  const dz = pos.z - closestZ
  const distSq = dx * dx + dz * dz
  if (distSq < radius * radius) {
    const dist = Math.sqrt(distSq)
    if (dist > 0.0001) {
      const push = radius - dist
      pos.x += (dx / dist) * push
      pos.z += (dz / dist) * push
    } else {
      const left = Math.abs(pos.x - minX)
      const right = Math.abs(maxX - pos.x)
      const top = Math.abs(pos.z - minZ)
      const bottom = Math.abs(maxZ - pos.z)
      const smallest = Math.min(left, right, top, bottom)
      if (smallest === left) pos.x = minX - radius
      else if (smallest === right) pos.x = maxX + radius
      else if (smallest === top) pos.z = minZ - radius
      else pos.z = maxZ + radius
    }
  }
}

const resolveCircleCircle = (a: Entity, b: Entity) => {
  const dx = a.mesh.position.x - b.mesh.position.x
  const dz = a.mesh.position.z - b.mesh.position.z
  const distSq = dx * dx + dz * dz
  const minDist = a.radius + b.radius
  if (distSq < minDist * minDist && distSq > 0.00001) {
    const dist = Math.sqrt(distSq)
    const overlap = minDist - dist
    const nx = dx / dist
    const nz = dz / dist
    a.mesh.position.x += nx * (overlap * 0.5)
    a.mesh.position.z += nz * (overlap * 0.5)
    b.mesh.position.x -= nx * (overlap * 0.5)
    b.mesh.position.z -= nz * (overlap * 0.5)
  }
}

const setMoveTarget = (pos: THREE.Vector3) => {
  const clamped = new THREE.Vector3(clamp(pos.x, -WORLD_BOUNDS, WORLD_BOUNDS), 0, clamp(pos.z, -WORLD_BOUNDS, WORLD_BOUNDS))
  player.target.copy(clamped)
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('#hud')) return
  const point = getGroundPoint(event)
  if (!point) return
  if (buildMode !== 'off') {
    if (buildMode === 'wall') {
      isDraggingWall = true
      wallDragStart = point.clone()
      wallDragEnd = point.clone()
    } else {
      // Tower: place and exit
      if (placeBuilding(point)) {
        setBuildMode('off')
      }
    }
    return
  }
  const towerHit = getTowerHit(event)
  if (towerHit) {
    selectedTower = towerHit
    return
  }
  selectedTower = null
  setMoveTarget(point)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (buildMode === 'off') return
  const point = getGroundPoint(event)
  if (!point) return
  
  if (buildMode === 'wall' && isDraggingWall && wallDragStart) {
    wallDragEnd = point.clone()
    // Hide single preview
    buildPreview.visible = false
    
    // Show preview of all walls in the line
    const positions = getCardinalWallLine(wallDragStart, wallDragEnd)
    const wallSize = new THREE.Vector3(1, 1, 1)
    const half = wallSize.clone().multiplyScalar(0.5)
    
    for (let i = 0; i < wallPreviewMeshes.length; i += 1) {
      const preview = wallPreviewMeshes[i]
      if (i < positions.length && i < 5) {
        const pos = positions[i]
        const snapped = new THREE.Vector3(snapToGrid(pos.x), half.y, snapToGrid(pos.z))
        const availableWallPreview = Math.floor(wallCharges)
        const ok = canPlace(snapped, half) && availableWallPreview > i
        preview.scale.set(wallSize.x, wallSize.y, wallSize.z)
        preview.position.copy(snapped)
        ;(preview.material as THREE.MeshStandardMaterial).color.setHex(ok ? 0x66ff66 : 0xff6666)
        preview.visible = true
      } else {
        preview.visible = false
      }
    }
  } else {
    // Hide wall preview meshes
    for (const preview of wallPreviewMeshes) {
      preview.visible = false
    }
    const isTower = buildMode === 'tower'
    const size = isTower ? new THREE.Vector3(1, 2, 1) : new THREE.Vector3(1, 1, 1)
    const half = size.clone().multiplyScalar(0.5)
    const snapped = new THREE.Vector3(snapToGrid(point.x), half.y, snapToGrid(point.z))
    const ok = canPlace(snapped, half) && towerCharges > 0
    buildPreview.scale.set(size.x, size.y, size.z)
    buildPreview.position.copy(snapped)
    ;(buildPreview.material as THREE.MeshStandardMaterial).color.setHex(ok ? 0x66ff66 : 0xff6666)
  }
})

window.addEventListener('pointerup', (event) => {
  isShooting = false
  if (buildMode === 'wall' && isDraggingWall && wallDragStart && wallDragEnd) {
    placeWallLine(wallDragStart, wallDragEnd)
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
})

const updateEntityMotion = (entity: Entity, delta: number) => {
  let dir = new THREE.Vector3()
  
  if (entity.kind === 'mob' && entity.waypoints && entity.waypointIndex !== undefined) {
    // Use waypoint-based navigation
    const waypoints = entity.waypoints
    let waypointIdx = entity.waypointIndex
    
    // Advance to next waypoint if close enough
    if (waypointIdx < waypoints.length) {
      const targetWaypoint = waypoints[waypointIdx]
      const distToWaypoint = entity.mesh.position.distanceTo(targetWaypoint)
      
      if (distToWaypoint < entity.radius + 0.5) {
        waypointIdx++
        entity.waypointIndex = waypointIdx
      }
      
      // If we have a valid waypoint, move toward it
      if (waypointIdx < waypoints.length) {
        dir = new THREE.Vector3(
          waypoints[waypointIdx].x - entity.mesh.position.x,
          0,
          waypoints[waypointIdx].z - entity.mesh.position.z
        )
        if (dir.length() > 0.1) {
          dir.normalize()
        }
      } else {
        // Reached end of waypoints, use direct-to-goal
        dir = new THREE.Vector3(-entity.mesh.position.x, 0, -entity.mesh.position.z)
        if (dir.length() > 0.1) {
          dir.normalize()
        }
      }
    } else {
      // Fallback: use flow field if waypoints exhausted or invalid
      dir = flowField.getDirection(entity.mesh.position)
    }
    
    // Add dynamic avoidance for nearby entities
    const avoidanceRadius = entity.radius * 2 + 0.5
    const nearby = spatialGrid.getNearby(entity.mesh.position, avoidanceRadius)
    
    const avoidance = new THREE.Vector3()
    for (const other of nearby) {
      if (other === entity) continue
      const dx = entity.mesh.position.x - other.mesh.position.x
      const dz = entity.mesh.position.z - other.mesh.position.z
      const distSq = dx * dx + dz * dz
      if (distSq < 0.001) continue
      
      const dist = Math.sqrt(distSq)
      const minDist = entity.radius + other.radius + 0.3
      if (dist < minDist) {
        const strength = (minDist - dist) / minDist
        avoidance.x += (dx / dist) * strength
        avoidance.z += (dz / dist) * strength
      }
    }
    
    // Blend waypoint direction with avoidance (avoidance is secondary)
    if (avoidance.length() > 0.001) {
      avoidance.normalize().multiplyScalar(0.3) // 30% avoidance influence
      dir.add(avoidance).normalize()
    }
    
    // Check if mob is significantly off track (e.g., pushed by collision)
    // If so, recalculate waypoints from current position
    if (waypointIdx < waypoints.length && waypointIdx > 0) {
      const expectedPos = waypoints[waypointIdx - 1]
      const distOffTrack = entity.mesh.position.distanceTo(expectedPos)
      if (distOffTrack > GRID_SIZE * 3) {
        // Too far off track, recalculate waypoints
        const goal = new THREE.Vector3(0, 0, 0)
        entity.waypoints = flowField.computeWaypoints(entity.mesh.position, goal)
        entity.waypointIndex = 0
      }
    }
  } else if (entity.kind === 'mob') {
    // Fallback: use flow field directly if no waypoints
    dir = flowField.getDirection(entity.mesh.position)
    
    // Add dynamic avoidance
    const avoidanceRadius = entity.radius * 2 + 0.5
    const nearby = spatialGrid.getNearby(entity.mesh.position, avoidanceRadius)
    
    const avoidance = new THREE.Vector3()
    for (const other of nearby) {
      if (other === entity) continue
      const dx = entity.mesh.position.x - other.mesh.position.x
      const dz = entity.mesh.position.z - other.mesh.position.z
      const distSq = dx * dx + dz * dz
      if (distSq < 0.001) continue
      
      const dist = Math.sqrt(distSq)
      const minDist = entity.radius + other.radius + 0.3
      if (dist < minDist) {
        const strength = (minDist - dist) / minDist
        avoidance.x += (dx / dist) * strength
        avoidance.z += (dz / dist) * strength
      }
    }
    
    if (avoidance.length() > 0.001) {
      avoidance.normalize().multiplyScalar(0.3)
      dir.add(avoidance).normalize()
    }
  } else {
    // Non-mobs use direct target following
    dir = new THREE.Vector3(entity.target.x - entity.mesh.position.x, 0, entity.target.z - entity.mesh.position.z)
    if (dir.length() > 0.1) {
      dir.normalize()
    } else {
      dir.set(0, 0, 0)
    }
  }
  
  if (dir.length() > 0.1) {
    entity.velocity.copy(dir).multiplyScalar(entity.speed)
  } else {
    entity.velocity.set(0, 0, 0)
  }
  
  entity.mesh.position.x += entity.velocity.x * delta
  entity.mesh.position.z += entity.velocity.z * delta
  
  // Final collision resolution with static colliders
  for (const collider of staticColliders) {
    if (collider.type === 'castle') continue // Castle has no collision
    resolveCircleAabb(entity.mesh.position, entity.radius, collider)
  }
  
  entity.mesh.position.x = clamp(entity.mesh.position.x, -WORLD_BOUNDS, WORLD_BOUNDS)
  entity.mesh.position.z = clamp(entity.mesh.position.z, -WORLD_BOUNDS, WORLD_BOUNDS)
  entity.mesh.position.y = entity.baseY
}

const updateNpcTargets = () => {
  for (const npc of npcs) {
    if (npc.mesh.position.distanceTo(npc.target) < 0.5) {
      npc.target.set(
        (Math.random() - 0.5) * WORLD_BOUNDS * 1.2,
        0,
        (Math.random() - 0.5) * WORLD_BOUNDS * 1.2
      )
    }
  }
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
  for (const mob of mobs) {
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

let lastTime = performance.now()
const tick = () => {
  const now = performance.now()
  const delta = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now

  wallCharges = Math.min(WALL_CHARGE_MAX, wallCharges + WALL_RECHARGE_RATE * delta)
  towerCharges = Math.min(TOWER_CHARGE_MAX, towerCharges + TOWER_RECHARGE_RATE * delta)
  if (buildMode === 'wall' && wallCharges < 1) {
    setBuildMode('off')
  }
  if (buildMode === 'tower' && towerCharges < 1) {
    setBuildMode('off')
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
        target.hp = (target.hp ?? 1) - SHOOT_DAMAGE
        tower.shootCooldown = TOWER_SHOOT_COOLDOWN
        tower.laserVisibleTime = 0.07
      }
    }

    tower.laser.visible = tower.laserVisibleTime > 0 && target !== null
  }

  // Use spatial grid for efficient dynamic collision resolution
  spatialGrid.clear()
  const dynamicEntities = [player, ...npcs, ...mobs]
  for (const entity of dynamicEntities) {
    spatialGrid.insert(entity)
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

  ring.position.set(player.mesh.position.x, 0.02, player.mesh.position.z)
  for (const tower of towers) {
    tower.rangeRing.position.set(tower.mesh.position.x, 0.02, tower.mesh.position.z)
    tower.rangeRing.visible = selectedTower === tower
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
  prevNextWaveIn = nextWaveIn
  
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

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

tick()

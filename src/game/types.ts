import * as THREE from 'three'

export type ColliderType = 'castle' | 'wall' | 'tower' | 'tree' | 'rock'

export type NavPoint = { x: number, z: number }

export type NavCollider = {
  center: NavPoint
  halfSize: NavPoint
  type: ColliderType
}

export type StaticCollider = NavCollider & {
  center: THREE.Vector3
  halfSize: THREE.Vector3
}

export type StructureType = Extract<StaticCollider['type'], 'wall' | 'tower' | 'tree' | 'rock'>

export type DestructibleCollider = StaticCollider & {
  type: StructureType
}

type EntityBase = {
  mesh: THREE.Mesh
  radius: number
  speed: number
  velocity: THREE.Vector3
  target: THREE.Vector3
  baseY: number
}

export type PlayerEntity = EntityBase & {
  kind: 'player'
  username: string
}

export type NpcEntity = EntityBase & {
  kind: 'npc'
  username: string
}

export type MobEntity = EntityBase & {
  kind: 'mob'
  hp: number
  maxHp: number
  waypoints?: THREE.Vector3[]
  waypointIndex?: number
  siegeAttackCooldown: number
  unreachableTime: number
  lastHitBy?: 'player' | 'tower'
  spawnerId?: string
  berserkMode: boolean
  berserkTarget: DestructibleCollider | null
  laneBlocked: boolean
  representedCount?: number
}

export type Entity = PlayerEntity | NpcEntity | MobEntity

export type SpawnerRouteState = 'reachable' | 'unstable' | 'blocked'

export type WaveSpawner = {
  id: string
  position: THREE.Vector3
  totalCount: number
  spawnedCount: number
  aliveCount: number
  spawnRatePerSecond: number
  spawnAccumulator: number
  routeState: SpawnerRouteState
}

export type MobCohort = {
  spawnerId: string
  representedCount: number
  x: number
  z: number
  berserk: boolean
}

export type Tower = {
  mesh: THREE.Mesh
  range: number
  damage: number
  rangeLevel: number
  damageLevel: number
  speedLevel: number
  killCount: number
  builtBy: string
  shootCooldown: number
  shootCadence: number
  laserVisibleTime: number
  laser: THREE.Mesh
  rangeRing: THREE.Mesh
  typeId: string
  level: number
}

export type StructureState = {
  mesh: THREE.Mesh
  hp: number
  maxHp: number
  tower?: Tower
  playerBuilt?: boolean
  createdAtMs?: number
  lastDecayTickMs?: number
  graceUntilMs?: number
  cumulativeBuildCost?: number
}

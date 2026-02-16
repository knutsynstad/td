import * as THREE from 'three'

export type ColliderType = 'castle' | 'wall' | 'tower'

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

export type StructureType = Extract<StaticCollider['type'], 'wall' | 'tower'>

export type DestructibleCollider = StaticCollider & {
  type: StructureType
}

export type Entity = {
  mesh: THREE.Mesh
  radius: number
  speed: number
  velocity: THREE.Vector3
  target: THREE.Vector3
  kind: 'player' | 'mob' | 'npc'
  hp?: number
  maxHp?: number
  baseY: number
  waypoints?: THREE.Vector3[]
  waypointIndex?: number
  siegeMode?: boolean
  siegeTarget?: DestructibleCollider | null
  siegeAttackCooldown?: number
  unreachableTime?: number
  username?: string
  lastHitBy?: 'player' | 'tower'
  spawnerId?: string
  berserkMode?: boolean
  berserkTarget?: DestructibleCollider | null
  laneBlocked?: boolean
  representedCount?: number
}

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
}

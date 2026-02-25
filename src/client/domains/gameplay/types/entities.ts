import * as THREE from 'three';
import type { StructureType } from '../../../../shared/game-state';

export type ColliderType =
  | 'castle'
  | 'wall'
  | 'tower'
  | 'tree'
  | 'rock'
  | 'bank';

export type NavPoint = { x: number; z: number };

export type NavCollider = {
  center: NavPoint;
  halfSize: NavPoint;
  type: ColliderType;
};

export type StaticCollider = NavCollider & {
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
};

export type DestructibleCollider = StaticCollider & {
  type: StructureType;
};

type EntityBase = {
  mesh: THREE.Object3D;
  radius: number;
  speed: number;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  baseY: number;
};

export type PlayerEntity = EntityBase & {
  kind: 'player';
  username: string;
};

export type NpcEntity = EntityBase & {
  kind: 'npc';
  username: string;
};

export type MobEntity = EntityBase & {
  kind: 'mob';
  mobId?: string;
  hp: number;
  maxHp: number;
  staged: boolean;
  waypoints?: THREE.Vector3[];
  waypointIndex?: number;
  siegeAttackCooldown: number;
  unreachableTime: number;
  lastHitBy?: 'player' | 'tower';
  lastHitDirection?: THREE.Vector3;
  hitFlashUntilMs?: number;
  spawnerId?: string;
  berserkMode: boolean;
  berserkTarget: DestructibleCollider | null;
  laneBlocked: boolean;
  representedCount?: number;
};

export type Entity = PlayerEntity | NpcEntity | MobEntity;

export type SpawnerRouteState = 'reachable' | 'unstable' | 'blocked';

export type WaveSpawner = {
  id: string;
  position: THREE.Vector3;
  gateOpen: boolean;
  totalCount: number;
  spawnedCount: number;
  aliveCount: number;
  spawnRatePerSecond: number;
  spawnAccumulator: number;
  routeState: SpawnerRouteState;
};

export type MobCohort = {
  spawnerId: string;
  representedCount: number;
  x: number;
  z: number;
  berserk: boolean;
};

export type Tower = {
  mesh: THREE.Mesh;
  range: number;
  damage: number;
  rangeLevel: number;
  damageLevel: number;
  speedLevel: number;
  killCount: number;
  builtBy: string;
  shootCooldown: number;
  shootCadence: number;
  rangeRing: THREE.Mesh;
  typeId: string;
  level: number;
};

export type ArrowProjectile = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: THREE.Vector3;
  gravityDelay: number;
  radius: number;
  ttl: number;
  damage: number;
  sourceTower: Tower;
};

export type ClientStructureState = {
  mesh: THREE.Mesh;
  hp: number;
  maxHp: number;
  tower?: Tower;
  playerBuilt?: boolean;
  createdAtMs?: number;
  lastDecayTickMs?: number;
  graceUntilMs?: number;
  cumulativeBuildCost?: number;
};

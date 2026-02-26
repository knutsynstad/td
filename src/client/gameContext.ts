import type * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import type {
  ArrowProjectile,
  MobEntity,
  NpcEntity,
  PlayerEntity,
  StaticCollider,
  Tower,
  WaveSpawner,
} from './domains/gameplay/types/entities';
import type { StructureStore } from './domains/gameplay/structureStore';
import type { SpatialGrid } from './domains/world/spatialGrid';
import type { GameState } from './domains/gameplay/gameState';
import type { LanePathResult } from './domains/world/pathfinding/laneAStar';
import type { CorridorFlowField } from './domains/world/pathfinding/corridorFlowField';
import type { SpawnerPathOverlay } from './rendering/effects/spawnerPathOverlay';
import type {
  InstancedModelLayer,
  WorldGrid,
  StagingIslandsOverlay,
  FlowFieldDebugOverlay,
  SpawnContainerOverlay,
  WorldBorder,
} from './rendering/overlays';
import type { createInputController } from './domains/gameplay/inputController';
import type { BallistaVisualRig } from './rendering/presenters/ballistaRig';

export type DebugViewState = {
  worldGrid: boolean;
  flowField: boolean;
  playerShootRange: boolean;
};

export type PlayerArrowProjectile = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: THREE.Vector3;
  gravityDelay: number;
  radius: number;
  ttl: number;
  damage: number;
};

export type GroundBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type GameContext = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  structureOutlinePass: OutlinePass;
  treeOutlinePass: OutlinePass;

  player: PlayerEntity;
  mobs: MobEntity[];
  towers: Tower[];
  npcs: NpcEntity[];
  activeArrowProjectiles: ArrowProjectile[];
  activePlayerArrowProjectiles: PlayerArrowProjectile[];
  activeWaveSpawners: WaveSpawner[];
  spawnerById: Map<string, WaveSpawner>;
  staticColliders: StaticCollider[];

  structureStore: StructureStore;
  spatialGrid: SpatialGrid;
  gameState: GameState;
  inputController: ReturnType<typeof createInputController>;

  spawnerPathlineCache: Map<string, LanePathResult>;
  castleFlowField: CorridorFlowField | null;
  isCastleFlowFieldDirty: boolean;

  debugViewState: DebugViewState;

  worldGrid: WorldGrid;
  worldBorder: WorldBorder;
  spawnContainerOverlay: SpawnContainerOverlay;
  stagingIslandsOverlay: StagingIslandsOverlay;
  flowFieldDebugOverlay: FlowFieldDebugOverlay;
  spawnerRouteOverlay: SpawnerPathOverlay;

  groundTileLayer: InstancedModelLayer;
  pathCenterTileLayer: InstancedModelLayer;
  pathEdgeTileLayer: InstancedModelLayer;
  pathInnerCornerTileLayer: InstancedModelLayer;
  pathOuterCornerTileLayer: InstancedModelLayer;

  towerBallistaRigs: Map<Tower, BallistaVisualRig>;

  dir: THREE.DirectionalLight;
  dirShadowFollowOffset: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  orthoSize: number;

  castleCollider: StaticCollider;
};

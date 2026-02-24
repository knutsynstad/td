import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import castleModelUrl from './assets/models/castle.glb?url';
import castleIconUrl from './assets/icons/castle.svg?url';
import coinModelUrl from './assets/models/coin.glb?url';
import groundModelUrl from './assets/models/ground.glb?url';
import mobModelUrl from './assets/models/mob.glb?url';
import arrowModelUrl from './assets/models/arrow.glb?url';
import pathCornerInnerModelUrl from './assets/models/path-corner-inner.glb?url';
import pathCornerOuterModelUrl from './assets/models/path-corner-outer.glb?url';
import pathEdgeModelUrl from './assets/models/path-edge.glb?url';
import pathModelUrl from './assets/models/path.glb?url';
import rock2ModelUrl from './assets/models/rock-2.glb?url';
import rockModelUrl from './assets/models/rock.glb?url';
import towerBallistaModelUrl from './assets/models/tower-ballista.glb?url';
import treeModelUrl from './assets/models/tree.glb?url';
import wallModelUrl from './assets/models/wall.glb?url';
import { screenToWorldOnGround } from './domains/world/coords';
import { SelectionDialog } from './ui/components/selectionDialog';
import { StructureStore } from './domains/gameplay/structureStore';
import {
  getTowerType,
  getTowerUpgradeDeltaText,
  getTowerUpgradeOptions,
} from './domains/gameplay/towers/towerTypes';
import type {
  TowerTypeId,
  TowerUpgradeId,
} from './domains/gameplay/towers/towerTypes';
import type {
  ArrowProjectile,
  DestructibleCollider,
  Entity,
  MobEntity,
  NpcEntity,
  PlayerEntity,
  StaticCollider,
  Tower,
  WaveSpawner,
} from './domains/gameplay/types/entities';
import { SpatialGrid } from './domains/world/spatialGrid';
import { createParticleSystem } from './rendering/effects/particles';
import {
  clamp,
  distanceToColliderSurface,
  resolveCircleCircle,
} from './domains/world/collision';
import { createEntityMotionSystem } from './domains/entities/systems/motion';
import { createGameLoop } from './domains/gameplay/gameLoop';
import { getAllBorderDoors } from './domains/gameplay/borderDoors';
import type { LanePathResult } from './domains/world/pathfinding/laneAStar';
import {
  buildCastleFlowField,
  tracePathFromSpawner,
  type CorridorFlowField,
} from './domains/world/pathfinding/corridorFlowField';
import { buildPathTilesFromPoints as buildPathTilesFromNavPoints } from './domains/world/pathfinding/pathTiles';
import { toCastleDisplayRoute } from './domains/world/pathfinding/castleRouteDisplay';
import { SpawnerPathOverlay } from './rendering/effects/spawnerPathOverlay';
import {
  canPlace as canPlaceAt,
  getBuildSize as getBuildSizeForMode,
  getWallLinePlacement as computeWallLinePlacement,
  placeBuilding as placeBuildingAt,
  placeWallSegments as placeWallSegmentsAt,
  placeWallLine as placeWallSegment,
  snapCenterToBuildGrid,
  type BuildMode,
} from './domains/gameplay/buildingPlacement';
import {
  clearSelectionState,
  createSelectionState,
  getSelectedInRange as getSelectedInRangeFromState,
  getSelectionTowerTypeId as getSelectionTowerTypeIdFromState,
  getSingleSelectedTower as getSingleSelectedTowerFromState,
  isColliderInRange as isColliderInRangeFromState,
  setSelectedStructures as setSelectedStructuresState,
} from './domains/selection/state';
import {
  DECAY_GRACE_MS,
  DECAY_HP_PER_HOUR,
  BALLISTA_ARROW_GRAVITY,
  BALLISTA_ARROW_DIRECT_AIM_DISTANCE,
  BALLISTA_ARROW_GRAVITY_DELAY,
  BALLISTA_ARROW_MAX_LIFETIME,
  BALLISTA_ARROW_RADIUS,
  BALLISTA_ARROW_SPEED,
  ENERGY_CAP,
  ENERGY_COST_DELETE_TOWER,
  ENERGY_COST_DELETE_WALL,
  ENERGY_COST_TOWER,
  ENERGY_COST_UPGRADE_DAMAGE,
  ENERGY_COST_UPGRADE_RANGE,
  ENERGY_COST_UPGRADE_SPEED,
  ENERGY_COST_WALL,
  ENERGY_REGEN_RATE,
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
  PLAYER_SHOOT_RANGE,
  PLAYER_COLLISION_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_SPEED,
  PLAYER_WIDTH,
  REPAIR_CRITICAL_HP_RATIO,
  REPAIR_DISCOUNT_RATE,
  REPAIR_WARNING_HP_RATIO,
  SELECTION_RADIUS,
  SHOOT_COOLDOWN,
  SHOOT_DAMAGE,
  SPATIAL_GRID_CELL_SIZE,
  TREE_GROWTH_MS,
  TREE_REGROW_MS,
  TOWER_HEIGHT,
  WATER_BOB_AMPLITUDE,
  WATER_BOB_SPEED,
  WATER_LEVEL,
  WATER_RING_OUTER_PADDING,
  WALL_HP,
  WORLD_BOUNDS,
} from './domains/gameplay/constants';
import { createGameState } from './domains/gameplay/gameState';
import { createInputController } from './domains/gameplay/inputController';
import { updateHud } from './rendering/presenters/hudPresenter';
import { renderVisibleMobInstances } from './rendering/presenters/renderCoordinator';
import { buildCoinCostMarkup } from './ui/components/coinCost';
import {
  createBallistaVisualRig,
  getBallistaArrowLaunchTransform,
  updateBallistaRigTracking,
  type BallistaVisualRig,
} from './rendering/presenters/ballistaRig';
import { syncAuthoritativeWaveSpawners } from './domains/gameplay/authoritativeWaveSync';
import { connectAuthoritativeBridge } from './integrations/authoritativeBridge';
import {
  fetchCastleCoinsBalance,
  requestCastleCoinsDeposit,
  requestCastleCoinsWithdraw,
} from './integrations/castleApi';
import type {
  EntityDelta,
  StructureDelta,
  WaveDelta,
} from '../shared/game-protocol';
import {
  DEFAULT_PLAYER_SPAWN,
  type MobState as SharedMobState,
  type StructureState as SharedStructureState,
  type WaveState as SharedWaveState,
  type WorldState as SharedWorldState,
} from '../shared/game-state';
import {
  assertEnergyInBounds,
  assertMobSpawnerReferences,
  assertSpawnerCounts,
  assertStructureStoreConsistency,
} from './domains/gameplay/invariants';
import { createRandomSource, deriveSeed, hashSeed } from './domains/world/rng';

const app = document.querySelector<HTMLDivElement>('#app')!;
const WORLD_SEED_INPUT: string | number = 'alpha valley 01';
const WORLD_SEED = hashSeed(WORLD_SEED_INPUT);
const randomSource = createRandomSource(deriveSeed(WORLD_SEED, 'runtime'));
const random = () => randomSource.next();
const HITBOX_LAYER = 1;
const TOWER_BUILD_SIZE = getBuildSizeForMode('tower');
const TREE_BUILD_SIZE = new THREE.Vector3(2, 2.4, 2);
type TreeFootprint = 1 | 2 | 3 | 4;
type RockPlacement = {
  x: number;
  z: number;
  footprintX: number;
  footprintZ: number;
  yawQuarterTurns: 0 | 1 | 2 | 3;
  modelIndex: 0 | 1;
  mirrorX: boolean;
  mirrorZ: boolean;
  verticalScale: number;
};
const DEFAULT_TREE_FOOTPRINT: TreeFootprint = 2;
const clampTreeFootprint = (value: number): TreeFootprint => {
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  return 2;
};
const getTreeScaleForFootprint = (footprint: TreeFootprint) =>
  footprint / DEFAULT_TREE_FOOTPRINT;
const getTreeBuildSizeForFootprint = (footprint: TreeFootprint) =>
  TREE_BUILD_SIZE.clone().multiplyScalar(getTreeScaleForFootprint(footprint));
const COIN_PILE_CYLINDER_MIN = 3;
const COIN_PILE_CYLINDER_MAX = 96;
const COIN_PILE_MAX_RADIUS = 2.1;
const COIN_PILE_CLUSTER_MAX_PER_CORNER = 5;
type DebugViewState = {
  worldGrid: boolean;
  flowField: boolean;
  playerShootRange: boolean;
};

const debugViewState: DebugViewState = {
  worldGrid: false,
  flowField: false,
  playerShootRange: false,
};
const ENABLE_CLIENT_FRAME_PROFILING = true;
const FRAME_PROFILE_LOG_INTERVAL_MS = 10_000;
const FRAME_PROFILE_MAX_SAMPLES = 240;
const ENABLE_PROJECTILE_BROADPHASE = true;
const ENABLE_INCREMENTAL_SPATIAL_GRID = true;
const ENABLE_MOB_RENDER_LOD = true;
const MOB_LOD_NEAR_DISTANCE = 25;
const MOB_LOD_FAR_DISTANCE = 48;
const MOB_LOD_MID_ANIMATION_STEP_MS = 33;
const MOB_LOD_FAR_ANIMATION_STEP_MS = 90;
const MOB_LOD_DISABLE_FAR_WIGGLE = true;
const TOWER_TARGET_REFRESH_INTERVAL_FRAMES = 2;
const STAGING_ISLAND_DISTANCE = 14;
const STAGING_ISLAND_SIZE = 15;
const STAGING_ISLAND_HEIGHT = 1;
const STAGING_BRIDGE_SIDE_GROUND_ROWS = 1;
const STAGING_BRIDGE_PATH_WIDTH = 3;
const STAGING_BRIDGE_WIDTH =
  STAGING_BRIDGE_PATH_WIDTH + STAGING_BRIDGE_SIDE_GROUND_ROWS * 2;
const STAGING_BRIDGE_LENGTH = 11;
const CASTLE_ROUTE_HALF_WIDTH_CELLS = Math.max(
  0,
  Math.floor(STAGING_BRIDGE_PATH_WIDTH * 0.5)
);
const CASTLE_ENTRY_GOAL_STRIP_HALF_WIDTH_CELLS = CASTLE_ROUTE_HALF_WIDTH_CELLS;
const SPAWNER_ENTRY_INSET_CELLS = 3;
const STAGING_PLATFORM_Y = Math.max(0, STAGING_ISLAND_HEIGHT - 1);
const MOB_STAGING_BOUNDS_PADDING =
  STAGING_ISLAND_DISTANCE + STAGING_ISLAND_SIZE * 0.5 + 2;
app.innerHTML = `
  <div id="loadingScreen" class="loading-screen" role="status" aria-live="polite">
    <div class="loading-screen__panel">
      <div class="loading-screen__title">Loading world</div>
      <div class="loading-screen__subtitle">Preparing models and scene</div>
      <div class="loading-screen__bar" aria-hidden="true">
        <div id="loadingProgressFill" class="loading-screen__bar-fill"></div>
      </div>
      <div id="loadingProgressLabel" class="loading-screen__progress">0%</div>
    </div>
  </div>
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
            <span id="wallCount" class="hud-badge">${buildCoinCostMarkup(ENERGY_COST_WALL, 'Coin cost')}</span>
          </button>
          <button id="buildTower" class="hud-button build-button">
            <span class="button-label">Tower</span>
            <span id="towerCount" class="hud-badge">${buildCoinCostMarkup(ENERGY_COST_TOWER, 'Coin cost')}</span>
          </button>
        </div>
        <button id="shootButton" class="shoot-button">Shoot</button>
      </div>
    </div>
    <div class="hud-corner hud-corner--bottom-left">
      <div class="hud-minimap-wrap" id="hudMinimapWrap">
        <div class="hud-minimap-tape-section hud-minimap-tape-section--top" aria-hidden="true"></div>
        <button
          id="hudMinimapToggle"
          class="hud-minimap-toggle"
          type="button"
          aria-label="Expand minimap"
          aria-expanded="false"
        >
          <canvas id="hudMinimap" class="hud-minimap" aria-label="Mob minimap"></canvas>
        </button>
        <div class="hud-minimap-tape-section hud-minimap-tape-section--bottom" aria-hidden="true"></div>
      </div>
    </div>
  </div>
`;

const waveEl = document.querySelector<HTMLSpanElement>('#wave')!;
const mobsRowEl = document.querySelector<HTMLDivElement>('#mobsRow')!;
const mobsPrimaryEl = mobsRowEl.querySelector<HTMLDivElement>(
  '.hud-status__primary'
)!;
const mobsSecondaryEl = mobsRowEl.querySelector<HTMLDivElement>(
  '.hud-status__secondary'
)!;
const wallCountEl = document.querySelector<HTMLSpanElement>('#wallCount')!;
const towerCountEl = document.querySelector<HTMLSpanElement>('#towerCount')!;
const energyCountEl = document.querySelector<HTMLSpanElement>('#energyCount')!;
const finalCountdownEl =
  document.querySelector<HTMLDivElement>('#finalCountdown')!;
const nextWaveRowEl = document.querySelector<HTMLDivElement>('#nextWaveRow')!;
const nextWavePrimaryEl = nextWaveRowEl.querySelector<HTMLDivElement>(
  '.hud-status__primary'
)!;
const nextWaveSecondaryEl = nextWaveRowEl.querySelector<HTMLDivElement>(
  '.hud-status__secondary'
)!;
const eventBannerEl = document.querySelector<HTMLDivElement>('#eventBanner')!;
const hudActionsEl = document.querySelector<HTMLDivElement>('.hud-actions')!;
const hudStatusStackEl =
  document.querySelector<HTMLDivElement>('.hud-status-stack')!;
const hudEnergyEl = document.querySelector<HTMLDivElement>('.hud-energy')!;
const buildWallBtn = document.querySelector<HTMLButtonElement>('#buildWall')!;
const buildTowerBtn = document.querySelector<HTMLButtonElement>('#buildTower')!;
const shootButton = document.querySelector<HTMLButtonElement>('#shootButton')!;
const minimapWrapEl =
  document.querySelector<HTMLDivElement>('#hudMinimapWrap')!;
const minimapToggleBtn =
  document.querySelector<HTMLButtonElement>('#hudMinimapToggle')!;
const coinHudCanvasEl =
  document.querySelector<HTMLCanvasElement>('#coinHudCanvas')!;
const minimapCanvasEl =
  document.querySelector<HTMLCanvasElement>('#hudMinimap')!;
const loadingScreenEl =
  document.querySelector<HTMLDivElement>('#loadingScreen')!;
const loadingProgressFillEl = document.querySelector<HTMLDivElement>(
  '#loadingProgressFill'
)!;
const loadingProgressLabelEl = document.querySelector<HTMLDivElement>(
  '#loadingProgressLabel'
)!;
const minimapCtx = minimapCanvasEl.getContext('2d');
const minimapCastleIcon = new Image();
minimapCastleIcon.src = castleIconUrl;

const coinHudScene = new THREE.Scene();
const coinHudCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
coinHudCamera.position.set(0, 0.8, 3);
coinHudCamera.lookAt(0, 0, 0);
const coinHudRenderer = new THREE.WebGLRenderer({
  canvas: coinHudCanvasEl,
  antialias: true,
  alpha: true,
});
coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
coinHudRenderer.setSize(36, 36, false);
coinHudRenderer.outputColorSpace = THREE.SRGBColorSpace;
const coinHudAmbient = new THREE.AmbientLight(0xffffff, 1.05);
coinHudScene.add(coinHudAmbient);
const coinHudKey = new THREE.DirectionalLight(0xffffff, 1.15);
coinHudKey.position.set(1.5, 2, 2);
coinHudScene.add(coinHudKey);
const coinHudRoot = new THREE.Group();
coinHudScene.add(coinHudRoot);
const coinTrailCanvasEl = document.createElement('canvas');
coinTrailCanvasEl.style.position = 'fixed';
coinTrailCanvasEl.style.inset = '0';
coinTrailCanvasEl.style.width = '100%';
coinTrailCanvasEl.style.height = '100%';
coinTrailCanvasEl.style.pointerEvents = 'none';
coinTrailCanvasEl.style.zIndex = '1800';
app.appendChild(coinTrailCanvasEl);
const coinTrailScene = new THREE.Scene();
const coinTrailCamera = new THREE.OrthographicCamera(
  0,
  window.innerWidth,
  window.innerHeight,
  0,
  -20,
  20
);
const coinTrailAmbient = new THREE.AmbientLight(0xffffff, 1.1);
coinTrailScene.add(coinTrailAmbient);
const coinTrailKey = new THREE.DirectionalLight(0xffffff, 1.2);
coinTrailKey.position.set(0.6, 0.8, 1.2);
coinTrailScene.add(coinTrailKey);
const coinTrailRenderer = new THREE.WebGLRenderer({
  canvas: coinTrailCanvasEl,
  antialias: true,
  alpha: true,
});
coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false);
coinTrailRenderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151a);

const aspect = window.innerWidth / window.innerHeight;
const orthoSize = 15;
const camera = new THREE.OrthographicCamera(
  -orthoSize * aspect,
  orthoSize * aspect,
  orthoSize,
  -orthoSize,
  -50,
  200
);
// Isometric angle: 30° elevation, 45° rotation (standard isometric)
const isoAngle = Math.PI / 6; // 30 degrees
const isoRot = Math.PI / 4; // 45 degrees
const isoDistance = 18;
const cameraOffset = new THREE.Vector3(
  Math.cos(isoRot) * Math.cos(isoAngle) * isoDistance,
  Math.sin(isoAngle) * isoDistance,
  Math.sin(isoRot) * Math.cos(isoAngle) * isoDistance
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.style.visibility = 'hidden';
app.appendChild(renderer.domElement);

const viewportFogEl = document.createElement('div');
viewportFogEl.className = 'viewport-fog';
app.appendChild(viewportFogEl);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const structureOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
structureOutlinePass.visibleEdgeColor.set(0xffe066);
structureOutlinePass.hiddenEdgeColor.set(0x6b5a1a);
structureOutlinePass.edgeStrength = 4;
structureOutlinePass.edgeThickness = 1.5;
structureOutlinePass.pulsePeriod = 0;
structureOutlinePass.selectedObjects = [];
composer.addPass(structureOutlinePass);
const treeOutlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
treeOutlinePass.visibleEdgeColor.set(0xffe066);
treeOutlinePass.hiddenEdgeColor.set(0x6b5a1a);
treeOutlinePass.edgeStrength = 4;
treeOutlinePass.edgeThickness = 1.5;
treeOutlinePass.pulsePeriod = 0;
treeOutlinePass.selectedObjects = [];
composer.addPass(treeOutlinePass);
composer.addPass(new OutputPass());

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 1.25);
const dirShadowFollowOffset = new THREE.Vector3(18, 10, -14);
dir.position.copy(dirShadowFollowOffset);
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

type GroundBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

type InstancedLayerOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  yOffset?: number;
};

type InstancedLayerEntry = {
  mesh: THREE.InstancedMesh;
  baseMatrix: THREE.Matrix4;
};

class InstancedModelLayer {
  private readonly root = new THREE.Group();
  private readonly entries: InstancedLayerEntry[] = [];
  private readonly transformScratch = new THREE.Matrix4();
  private readonly instanceMatrixScratch = new THREE.Matrix4();
  private readonly facingQuaternionScratch = new THREE.Quaternion();
  private readonly facingDirectionScratch = new THREE.Vector3();
  private readonly capacity: number;
  private readonly castShadow: boolean;
  private readonly receiveShadow: boolean;
  private readonly yOffset: number;
  private facingYaw = 0;

  constructor(
    scene: THREE.Scene,
    capacity: number,
    options: InstancedLayerOptions = {}
  ) {
    this.capacity = capacity;
    this.castShadow = options.castShadow ?? false;
    this.receiveShadow = options.receiveShadow ?? true;
    this.yOffset = options.yOffset ?? 0;
    scene.add(this.root);
  }

  setTemplate(source: THREE.Object3D | null) {
    this.clearEntries();
    this.facingYaw = 0;
    if (!source) return;
    source.updateMatrixWorld(true);
    this.facingYaw = this.computeFacingYaw(source);
    source.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = Array.isArray(node.material)
        ? node.material.map((mat) => mat.clone())
        : node.material.clone();
      const instanced = new THREE.InstancedMesh(
        node.geometry,
        material,
        this.capacity
      );
      instanced.count = 0;
      instanced.frustumCulled = false;
      instanced.castShadow = this.castShadow;
      instanced.receiveShadow = this.receiveShadow;
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(instanced);
      this.entries.push({
        mesh: instanced,
        baseMatrix: node.matrixWorld.clone(),
      });
    });
  }

  setPositions(positions: readonly THREE.Vector3[]) {
    const count = Math.min(positions.length, this.capacity);
    for (const entry of this.entries) {
      entry.mesh.count = count;
      for (let i = 0; i < count; i += 1) {
        const pos = positions[i]!;
        this.transformScratch.makeTranslation(
          pos.x,
          pos.y + this.yOffset,
          pos.z
        );
        this.instanceMatrixScratch.multiplyMatrices(
          this.transformScratch,
          entry.baseMatrix
        );
        entry.mesh.setMatrixAt(i, this.instanceMatrixScratch);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setTransforms(transforms: readonly THREE.Matrix4[]) {
    const count = Math.min(transforms.length, this.capacity);
    for (const entry of this.entries) {
      entry.mesh.count = count;
      for (let i = 0; i < count; i += 1) {
        this.transformScratch.copy(transforms[i]!);
        if (this.yOffset !== 0) {
          this.transformScratch.elements[13] += this.yOffset;
        }
        this.instanceMatrixScratch.multiplyMatrices(
          this.transformScratch,
          entry.baseMatrix
        );
        entry.mesh.setMatrixAt(i, this.instanceMatrixScratch);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getFacingYaw() {
    return this.facingYaw;
  }

  clear() {
    for (const entry of this.entries) {
      entry.mesh.count = 0;
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.clearEntries();
    this.root.removeFromParent();
  }

  private clearEntries() {
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      this.root.remove(entry.mesh);
      if (Array.isArray(entry.mesh.material)) {
        for (const material of entry.mesh.material) {
          material.dispose();
        }
      } else {
        entry.mesh.material.dispose();
      }
    }
  }

  private computeFacingYaw(source: THREE.Object3D) {
    const facing = source.getObjectByName('Facing');
    if (!facing) return 0;
    facing.getWorldQuaternion(this.facingQuaternionScratch);
    // Blender empties commonly author "forward" as local -Y in export workflows.
    this.facingDirectionScratch
      .set(0, -1, 0)
      .applyQuaternion(this.facingQuaternionScratch);
    this.facingDirectionScratch.y = 0;
    if (this.facingDirectionScratch.lengthSq() < 1e-9) return 0;
    this.facingDirectionScratch.normalize();
    return Math.atan2(
      this.facingDirectionScratch.x,
      this.facingDirectionScratch.z
    );
  }
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const getVisibleGroundBounds = (
  camera: THREE.OrthographicCamera
): GroundBounds => {
  const corners = [
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(1, 1, -1),
    new THREE.Vector3(-1, 1, -1),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const nearPoint = corner.clone().unproject(camera);
    const farPoint = corner.clone().setZ(1).unproject(camera);
    const direction = farPoint.sub(nearPoint).normalize();
    const ray = new THREE.Ray(nearPoint, direction);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(groundPlane, hit)) {
      minX = Math.min(minX, hit.x);
      maxX = Math.max(maxX, hit.x);
      minZ = Math.min(minZ, hit.z);
      maxZ = Math.max(maxZ, hit.z);
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxZ)
  ) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  }

  const padding = GRID_SIZE * 2;
  minX -= padding;
  maxX += padding;
  minZ -= padding;
  maxZ += padding;

  minX = Math.floor(minX / GRID_SIZE) * GRID_SIZE;
  maxX = Math.ceil(maxX / GRID_SIZE) * GRID_SIZE;
  minZ = Math.floor(minZ / GRID_SIZE) * GRID_SIZE;
  maxZ = Math.ceil(maxZ / GRID_SIZE) * GRID_SIZE;

  return { minX, maxX, minZ, maxZ };
};

// World-aligned grid system that only renders visible lines
class WorldGrid {
  private group: THREE.Group;
  private lineMaterial: THREE.LineBasicMaterial;
  private lines: THREE.Line[] = [];
  private lastBounds: GroundBounds | null = null;
  private readonly halfGrid: number;

  constructor() {
    this.group = new THREE.Group();
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
    });
    this.halfGrid = GRID_SIZE * 0.5;
    scene.add(this.group);
  }

  update(bounds: GroundBounds) {
    if (
      this.lastBounds &&
      this.lastBounds.minX === bounds.minX &&
      this.lastBounds.maxX === bounds.maxX &&
      this.lastBounds.minZ === bounds.minZ &&
      this.lastBounds.maxZ === bounds.maxZ
    ) {
      return;
    }
    this.lastBounds = bounds;

    // Clear existing lines
    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines = [];

    const clampedMinX = Math.max(bounds.minX, -WORLD_BOUNDS);
    const clampedMaxX = Math.min(bounds.maxX, WORLD_BOUNDS);
    const clampedMinZ = Math.max(bounds.minZ, -WORLD_BOUNDS);
    const clampedMaxZ = Math.min(bounds.maxZ, WORLD_BOUNDS);
    if (clampedMinX > clampedMaxX || clampedMinZ > clampedMaxZ) {
      return;
    }

    const minX =
      Math.ceil((clampedMinX - this.halfGrid) / GRID_SIZE) * GRID_SIZE +
      this.halfGrid;
    const maxX =
      Math.floor((clampedMaxX - this.halfGrid) / GRID_SIZE) * GRID_SIZE +
      this.halfGrid;
    const minZ =
      Math.ceil((clampedMinZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE +
      this.halfGrid;
    const maxZ =
      Math.floor((clampedMaxZ - this.halfGrid) / GRID_SIZE) * GRID_SIZE +
      this.halfGrid;

    // Create vertical lines (along Z axis)
    for (let x = minX; x <= maxX; x += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, clampedMinZ),
        new THREE.Vector3(x, 0.01, clampedMaxZ),
      ]);
      const line = new THREE.Line(geometry, this.lineMaterial);
      this.group.add(line);
      this.lines.push(line);
    }

    // Create horizontal lines (along X axis)
    for (let z = minZ; z <= maxZ; z += GRID_SIZE) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(clampedMinX, 0.01, z),
        new THREE.Vector3(clampedMaxX, 0.01, z),
      ]);
      const line = new THREE.Line(geometry, this.lineMaterial);
      this.group.add(line);
      this.lines.push(line);
    }
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  dispose() {
    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines = [];
    this.lineMaterial.dispose();
    scene.remove(this.group);
  }
}

class WorldBorder {
  private readonly line: THREE.LineLoop;

  constructor() {
    const points = [
      new THREE.Vector3(-WORLD_BOUNDS, 0.06, -WORLD_BOUNDS),
      new THREE.Vector3(WORLD_BOUNDS, 0.06, -WORLD_BOUNDS),
      new THREE.Vector3(WORLD_BOUNDS, 0.06, WORLD_BOUNDS),
      new THREE.Vector3(-WORLD_BOUNDS, 0.06, WORLD_BOUNDS),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xd96464,
      transparent: true,
      opacity: 0.95,
    });
    this.line = new THREE.LineLoop(geometry, material);
    scene.add(this.line);
  }

  dispose() {
    scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

class SpawnContainerOverlay {
  private readonly lines = new Map<string, THREE.LineLoop>();
  private readonly material = new THREE.LineBasicMaterial({
    color: 0x6f8a9c,
    transparent: true,
    opacity: 0.8,
  });

  upsert(spawnerId: string, corners: THREE.Vector3[]) {
    const existing = this.lines.get(spawnerId);
    if (existing) {
      scene.remove(existing);
      existing.geometry.dispose();
      this.lines.delete(spawnerId);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const loop = new THREE.LineLoop(geometry, this.material);
    loop.position.y = 0.05;
    scene.add(loop);
    this.lines.set(spawnerId, loop);
  }

  clear() {
    for (const line of this.lines.values()) {
      scene.remove(line);
      line.geometry.dispose();
    }
    this.lines.clear();
  }

  dispose() {
    this.clear();
    this.material.dispose();
  }
}

class StagingIslandsOverlay {
  private readonly islands = new Map<
    string,
    {
      group: THREE.Group;
      gate: THREE.Mesh;
      gateClosedY: number;
      gateOpenY: number;
      gateProgress: number;
    }
  >();
  private readonly islandGroundPositionsBySpawner = new Map<
    string,
    THREE.Vector3[]
  >();
  private readonly bridgePathKeysBySpawner = new Map<string, Set<string>>();
  private readonly bridgePathCenterPositionsBySpawner = new Map<
    string,
    THREE.Vector3[]
  >();
  private readonly bridgePathEdgeTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly bridgePathInnerCornerTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly bridgePathOuterCornerTransformsBySpawner = new Map<
    string,
    THREE.Matrix4[]
  >();
  private readonly groundLayer = new InstancedModelLayer(scene, 2_500, {
    receiveShadow: true,
    castShadow: false,
  });
  private readonly pathCenterLayer = new InstancedModelLayer(scene, 1_500, {
    receiveShadow: true,
    castShadow: false,
    yOffset: 0.01,
  });
  private readonly pathEdgeLayer = new InstancedModelLayer(scene, 1_500, {
    receiveShadow: true,
    castShadow: false,
    yOffset: 0.01,
  });
  private readonly pathInnerCornerLayer = new InstancedModelLayer(scene, 600, {
    receiveShadow: true,
    castShadow: false,
    yOffset: 0.01,
  });
  private readonly pathOuterCornerLayer = new InstancedModelLayer(scene, 600, {
    receiveShadow: true,
    castShadow: false,
    yOffset: 0.01,
  });
  private readonly gateClosedMaterial = new THREE.MeshStandardMaterial({
    color: 0xb64747,
    transparent: true,
    opacity: 0.95,
  });
  private readonly gateOpenMaterial = new THREE.MeshStandardMaterial({
    color: 0x4bb46a,
    transparent: true,
    opacity: 0.9,
  });
  private tilesChangedListener: (() => void) | null = null;

  setTilesChangedListener(listener: (() => void) | null) {
    this.tilesChangedListener = listener;
  }

  getLandTileKeys() {
    const keys = new Set<string>();
    for (const tiles of this.islandGroundPositionsBySpawner.values()) {
      for (const tile of tiles) {
        keys.add(`${tile.x},${tile.z}`);
      }
    }
    for (const bridgePathKeys of this.bridgePathKeysBySpawner.values()) {
      for (const key of bridgePathKeys) {
        keys.add(key);
      }
    }
    return keys;
  }

  setGroundTemplate(source: THREE.Object3D | null) {
    this.groundLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathTemplate(source: THREE.Object3D | null) {
    this.pathCenterLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathEdgeTemplate(source: THREE.Object3D | null) {
    this.pathEdgeLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathInnerCornerTemplate(source: THREE.Object3D | null) {
    this.pathInnerCornerLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  setPathOuterCornerTemplate(source: THREE.Object3D | null) {
    this.pathOuterCornerLayer.setTemplate(source);
    this.rebuildTileLayers();
  }

  private rebuildTileLayers() {
    const groundTiles: THREE.Vector3[] = [];
    for (const tiles of this.islandGroundPositionsBySpawner.values()) {
      groundTiles.push(...tiles);
    }
    this.groundLayer.setPositions(groundTiles);

    const bridgePathCenterTiles: THREE.Vector3[] = [];
    for (const tiles of this.bridgePathCenterPositionsBySpawner.values()) {
      bridgePathCenterTiles.push(...tiles);
    }
    this.pathCenterLayer.setPositions(bridgePathCenterTiles);

    const bridgePathEdgeTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathEdgeTransformsBySpawner.values()) {
      bridgePathEdgeTransforms.push(...transforms);
    }
    this.pathEdgeLayer.setTransforms(bridgePathEdgeTransforms);

    const bridgePathInnerCornerTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathInnerCornerTransformsBySpawner.values()) {
      bridgePathInnerCornerTransforms.push(...transforms);
    }
    this.pathInnerCornerLayer.setTransforms(bridgePathInnerCornerTransforms);

    const bridgePathOuterCornerTransforms: THREE.Matrix4[] = [];
    for (const transforms of this.bridgePathOuterCornerTransformsBySpawner.values()) {
      bridgePathOuterCornerTransforms.push(...transforms);
    }
    this.pathOuterCornerLayer.setTransforms(bridgePathOuterCornerTransforms);
    this.tilesChangedListener?.();
  }

  hasBridgePathAt(x: number, z: number) {
    const key = `${x},${z}`;
    for (const keys of this.bridgePathKeysBySpawner.values()) {
      if (keys.has(key)) return true;
    }
    return false;
  }

  private buildIslandGroundTiles(center: THREE.Vector3) {
    const out: THREE.Vector3[] = [];
    const baseX = Math.round(center.x);
    const baseZ = Math.round(center.z);
    const minOffset = -Math.floor(STAGING_ISLAND_SIZE * 0.5);
    for (let xStep = 0; xStep < STAGING_ISLAND_SIZE; xStep += 1) {
      for (let zStep = 0; zStep < STAGING_ISLAND_SIZE; zStep += 1) {
        out.push(
          new THREE.Vector3(
            baseX + minOffset + xStep,
            STAGING_PLATFORM_Y,
            baseZ + minOffset + zStep
          )
        );
      }
    }
    return out;
  }

  private buildBridgeGroundTiles(
    center: THREE.Vector3,
    towardMap: THREE.Vector3,
    reservePathStrip = true
  ) {
    const out: THREE.Vector3[] = [];
    const unique = new Set<string>();
    const tangent = new THREE.Vector3(-towardMap.z, 0, towardMap.x);
    const islandHalf = STAGING_ISLAND_SIZE * 0.5;
    const bridgeHalf = Math.max(0, Math.floor(STAGING_BRIDGE_WIDTH * 0.5));
    const pathHalf = Math.max(0, Math.floor(STAGING_BRIDGE_PATH_WIDTH * 0.5));
    for (let along = 0; along < STAGING_BRIDGE_LENGTH; along += 1) {
      const anchor = center
        .clone()
        .addScaledVector(towardMap, islandHalf + along);
      for (let lateral = 0; lateral < STAGING_BRIDGE_WIDTH; lateral += 1) {
        const lateralOffset = lateral - bridgeHalf;
        // Reserve middle strip only when a path will actually be drawn.
        if (reservePathStrip && Math.abs(lateralOffset) <= pathHalf) continue;
        const tile = anchor.clone().addScaledVector(tangent, lateralOffset);
        const x = Math.round(tile.x);
        const z = Math.round(tile.z);
        if (Math.abs(x) <= WORLD_BOUNDS && Math.abs(z) <= WORLD_BOUNDS)
          continue;
        const key = `${x},${z}`;
        if (unique.has(key)) continue;
        unique.add(key);
        out.push(new THREE.Vector3(x, STAGING_PLATFORM_Y, z));
      }
    }
    return out;
  }

  private buildBridgePathTiles(
    center: THREE.Vector3,
    towardMap: THREE.Vector3
  ) {
    const centers: THREE.Vector3[] = [];
    const edgeTransforms: THREE.Matrix4[] = [];
    const innerCornerTransforms: THREE.Matrix4[] = [];
    const outerCornerTransforms: THREE.Matrix4[] = [];
    const unique = new Set<string>();
    const tangent = new THREE.Vector3(-towardMap.z, 0, towardMap.x);
    const islandHalf = STAGING_ISLAND_SIZE * 0.5;
    const islandCenterRun = Math.floor(islandHalf);
    const pathHalf = Math.max(0, Math.floor(STAGING_BRIDGE_PATH_WIDTH * 0.5));
    const pathWidth = Math.max(1, STAGING_BRIDGE_PATH_WIDTH);
    // Extend from island center across the bridge to the map edge.
    for (
      let along = -islandCenterRun;
      along < STAGING_BRIDGE_LENGTH;
      along += 1
    ) {
      const anchor = center
        .clone()
        .addScaledVector(towardMap, islandHalf + along);
      for (let lateral = 0; lateral < pathWidth; lateral += 1) {
        const lateralOffset = lateral - pathHalf;
        const tile = anchor.clone().addScaledVector(tangent, lateralOffset);
        const x = Math.round(tile.x);
        const z = Math.round(tile.z);
        // Let map path layers own in-bounds tiles to avoid z-fighting.
        if (Math.abs(x) <= WORLD_BOUNDS && Math.abs(z) <= WORLD_BOUNDS)
          continue;
        const key = `${x},${z}`;
        if (unique.has(key)) continue;
        unique.add(key);
      }
    }
    const seamTowardMapDx = Math.sign(towardMap.x);
    const seamTowardMapDz = Math.sign(towardMap.z);
    const hasPathAt = (x: number, z: number) => {
      const key = `${x},${z}`;
      if (unique.has(key)) return true;
      // Merge seam topology with immediate in-bounds neighbors.
      if (Math.abs(x) <= WORLD_BOUNDS && Math.abs(z) <= WORLD_BOUNDS) {
        const outsideNeighborX = x - seamTowardMapDx;
        const outsideNeighborZ = z - seamTowardMapDz;
        if (unique.has(`${outsideNeighborX},${outsideNeighborZ}`)) return true;
      }
      return false;
    };
    const transform = new THREE.Matrix4();
    for (const key of unique) {
      const { x, z } = parseGridKey(key);
      const classification = classifyPathTile(x, z, hasPathAt);
      const desiredYaw = directionToYaw(
        classification.directionDx,
        classification.directionDz
      );
      const targetFacing =
        classification.variant === 'edge'
          ? this.pathEdgeLayer.getFacingYaw()
          : classification.variant === 'inner-corner'
            ? this.pathInnerCornerLayer.getFacingYaw()
            : classification.variant === 'outer-corner'
              ? this.pathOuterCornerLayer.getFacingYaw()
              : 0;
      const yawOffset =
        classification.variant === 'edge'
          ? edgeTileYawOffset
          : classification.variant === 'inner-corner' ||
              classification.variant === 'outer-corner'
            ? cornerTileYawOffset
            : 0;
      const correctedYaw = desiredYaw - targetFacing + yawOffset;
      const finalYaw =
        classification.variant === 'center'
          ? correctedYaw
          : snapYawToQuarterTurn(correctedYaw);
      if (classification.variant === 'center') {
        centers.push(new THREE.Vector3(x, STAGING_PLATFORM_Y, z));
      } else {
        transform.makeRotationY(finalYaw);
        transform.setPosition(x, STAGING_PLATFORM_Y, z);
        if (classification.variant === 'edge')
          edgeTransforms.push(transform.clone());
        if (classification.variant === 'inner-corner')
          innerCornerTransforms.push(transform.clone());
        if (classification.variant === 'outer-corner')
          outerCornerTransforms.push(transform.clone());
      }
    }
    return {
      centers,
      edgeTransforms,
      innerCornerTransforms,
      outerCornerTransforms,
      keys: unique,
    };
  }

  upsert(
    spawnerId: string,
    center: THREE.Vector3,
    normal: THREE.Vector3,
    gateOpen: boolean,
    showPath = true
  ) {
    this.remove(spawnerId);
    const group = new THREE.Group();
    const towardMap = normal.clone().multiplyScalar(-1);
    const yaw = Math.atan2(towardMap.x, towardMap.z);
    const islandHalf = STAGING_ISLAND_SIZE * 0.5;

    const bridgePath = showPath
      ? this.buildBridgePathTiles(center, towardMap)
      : {
          centers: [] as THREE.Vector3[],
          edgeTransforms: [] as THREE.Matrix4[],
          innerCornerTransforms: [] as THREE.Matrix4[],
          outerCornerTransforms: [] as THREE.Matrix4[],
          keys: new Set<string>(),
        };
    this.bridgePathKeysBySpawner.set(spawnerId, bridgePath.keys);
    const pathTileKeys = new Set<string>();
    for (const tile of bridgePath.centers) {
      pathTileKeys.add(`${tile.x},${tile.z}`);
    }
    for (const transform of bridgePath.edgeTransforms) {
      pathTileKeys.add(
        `${Math.round(transform.elements[12]!)},${Math.round(transform.elements[14]!)}`
      );
    }
    for (const transform of bridgePath.innerCornerTransforms) {
      pathTileKeys.add(
        `${Math.round(transform.elements[12]!)},${Math.round(transform.elements[14]!)}`
      );
    }
    for (const transform of bridgePath.outerCornerTransforms) {
      pathTileKeys.add(
        `${Math.round(transform.elements[12]!)},${Math.round(transform.elements[14]!)}`
      );
    }
    const groundTiles = [
      ...this.buildIslandGroundTiles(center),
      ...this.buildBridgeGroundTiles(center, towardMap, showPath),
    ].filter((tile) => !pathTileKeys.has(`${tile.x},${tile.z}`));
    this.islandGroundPositionsBySpawner.set(spawnerId, groundTiles);
    this.bridgePathCenterPositionsBySpawner.set(spawnerId, bridgePath.centers);
    this.bridgePathEdgeTransformsBySpawner.set(
      spawnerId,
      bridgePath.edgeTransforms
    );
    this.bridgePathInnerCornerTransformsBySpawner.set(
      spawnerId,
      bridgePath.innerCornerTransforms
    );
    this.bridgePathOuterCornerTransformsBySpawner.set(
      spawnerId,
      bridgePath.outerCornerTransforms
    );
    this.rebuildTileLayers();

    const gatePos = center
      .clone()
      .addScaledVector(towardMap, islandHalf - 0.35);
    const gateClosedY = STAGING_ISLAND_HEIGHT * 0.5 + 0.22;
    const gateOpenY = gateClosedY - (STAGING_ISLAND_HEIGHT + 0.55);
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(
        STAGING_BRIDGE_WIDTH + 0.3,
        STAGING_ISLAND_HEIGHT + 0.45,
        0.25
      ),
      gateOpen ? this.gateOpenMaterial : this.gateClosedMaterial
    );
    gate.position.copy(gatePos).setY(gateOpen ? gateOpenY : gateClosedY);
    gate.rotation.y = yaw;
    group.add(gate);

    scene.add(group);
    this.islands.set(spawnerId, {
      group,
      gate,
      gateClosedY,
      gateOpenY,
      gateProgress: gateOpen ? 1 : 0,
    });
  }

  setGateProgress(spawnerId: string, progress: number) {
    const entry = this.islands.get(spawnerId);
    if (!entry) return;
    const clamped = clamp(progress, 0, 1);
    entry.gateProgress = clamped;
    entry.gate.position.y = THREE.MathUtils.lerp(
      entry.gateClosedY,
      entry.gateOpenY,
      clamped
    );
    entry.gate.material =
      clamped >= 1 ? this.gateOpenMaterial : this.gateClosedMaterial;
  }

  remove(spawnerId: string) {
    const existing = this.islands.get(spawnerId);
    if (!existing) return;
    scene.remove(existing.group);
    for (const child of existing.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    this.islands.delete(spawnerId);
    this.islandGroundPositionsBySpawner.delete(spawnerId);
    this.bridgePathKeysBySpawner.delete(spawnerId);
    this.bridgePathCenterPositionsBySpawner.delete(spawnerId);
    this.bridgePathEdgeTransformsBySpawner.delete(spawnerId);
    this.bridgePathInnerCornerTransformsBySpawner.delete(spawnerId);
    this.bridgePathOuterCornerTransformsBySpawner.delete(spawnerId);
    this.rebuildTileLayers();
  }

  clear() {
    for (const spawnerId of this.islands.keys()) {
      this.remove(spawnerId);
    }
  }

  dispose() {
    this.clear();
    this.groundLayer.dispose();
    this.pathCenterLayer.dispose();
    this.pathEdgeLayer.dispose();
    this.pathInnerCornerLayer.dispose();
    this.pathOuterCornerLayer.dispose();
    this.gateClosedMaterial.dispose();
    this.gateOpenMaterial.dispose();
  }
}

class FlowFieldDebugOverlay {
  private reachableMesh: THREE.InstancedMesh | null = null;
  private goalMesh: THREE.InstancedMesh | null = null;
  private readonly tileDummy = new THREE.Object3D();

  upsert(field: CorridorFlowField) {
    this.clear();
    let reachableCount = 0;
    let goalCount = 0;
    for (let idx = 0; idx < field.distance.length; idx += 1) {
      const distance = field.distance[idx]!;
      if (distance < 0) continue;
      if (distance === 0) {
        goalCount += 1;
      } else {
        reachableCount += 1;
      }
    }
    if (reachableCount + goalCount === 0) return;

    const tileSize = field.resolution * 0.92;
    const tileGeometry = new THREE.PlaneGeometry(tileSize, tileSize);
    tileGeometry.rotateX(-Math.PI / 2);
    const reachableMaterial = new THREE.MeshBasicMaterial({
      color: 0x2baeff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const goalMaterial = new THREE.MeshBasicMaterial({
      color: 0xffef33,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.reachableMesh = new THREE.InstancedMesh(
      tileGeometry,
      reachableMaterial,
      Math.max(1, reachableCount)
    );
    this.goalMesh = new THREE.InstancedMesh(
      tileGeometry.clone(),
      goalMaterial,
      Math.max(1, goalCount)
    );
    this.reachableMesh.count = 0;
    this.goalMesh.count = 0;
    this.reachableMesh.frustumCulled = false;
    this.goalMesh.frustumCulled = false;

    const y = 0.06;
    let reachableIdx = 0;
    let goalIdx = 0;
    for (let idx = 0; idx < field.distance.length; idx += 1) {
      const distance = field.distance[idx]!;
      if (distance < 0) continue;
      const x = idx % field.width;
      const z = Math.floor(idx / field.width);
      const wx = field.minWX + x * field.resolution;
      const wz = field.minWZ + z * field.resolution;
      if (distance === 0) {
        this.tileDummy.position.set(wx, y + 0.01, wz);
        this.tileDummy.updateMatrix();
        this.goalMesh.setMatrixAt(goalIdx, this.tileDummy.matrix);
        goalIdx += 1;
      } else {
        this.tileDummy.position.set(wx, y, wz);
        this.tileDummy.updateMatrix();
        this.reachableMesh.setMatrixAt(reachableIdx, this.tileDummy.matrix);
        reachableIdx += 1;
      }
    }
    this.reachableMesh.count = reachableIdx;
    this.goalMesh.count = goalIdx;
    this.reachableMesh.instanceMatrix.needsUpdate = true;
    this.goalMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.reachableMesh);
    scene.add(this.goalMesh);
  }

  clear() {
    if (this.reachableMesh) {
      scene.remove(this.reachableMesh);
      this.reachableMesh.geometry.dispose();
      (this.reachableMesh.material as THREE.Material).dispose();
      this.reachableMesh = null;
    }
    if (this.goalMesh) {
      scene.remove(this.goalMesh);
      this.goalMesh.geometry.dispose();
      (this.goalMesh.material as THREE.Material).dispose();
      this.goalMesh = null;
    }
  }
}

const worldGrid = new WorldGrid();
const worldBorder = new WorldBorder();
const spawnContainerOverlay = new SpawnContainerOverlay();
const stagingIslandsOverlay = new StagingIslandsOverlay();
const flowFieldDebugOverlay = new FlowFieldDebugOverlay();
const groundTileLayer = new InstancedModelLayer(scene, 20_000, {
  receiveShadow: true,
  castShadow: false,
});
const pathCenterTileLayer = new InstancedModelLayer(scene, 5_000, {
  receiveShadow: true,
  castShadow: false,
  yOffset: 0.01,
});
const pathEdgeTileLayer = new InstancedModelLayer(scene, 5_000, {
  receiveShadow: true,
  castShadow: false,
  yOffset: 0.01,
});
const pathInnerCornerTileLayer = new InstancedModelLayer(scene, 5_000, {
  receiveShadow: true,
  castShadow: false,
  yOffset: 0.01,
});
const pathOuterCornerTileLayer = new InstancedModelLayer(scene, 5_000, {
  receiveShadow: true,
  castShadow: false,
  yOffset: 0.01,
});
const pathTilePositions = new Map<string, THREE.Vector3[]>();
const pathTileKeys = new Set<string>();
const tmpPathCenterTransforms: THREE.Matrix4[] = [];
const tmpPathEdgeTransforms: THREE.Matrix4[] = [];
const tmpPathInnerCornerTransforms: THREE.Matrix4[] = [];
const tmpPathOuterCornerTransforms: THREE.Matrix4[] = [];
const tmpPathTransformScratch = new THREE.Matrix4();
const cardinalGrassOffsets = [
  { key: 'north', dx: 0, dz: -1 },
  { key: 'east', dx: 1, dz: 0 },
  { key: 'south', dx: 0, dz: 1 },
  { key: 'west', dx: -1, dz: 0 },
] as const;
type PathTileVariant = 'center' | 'edge' | 'inner-corner' | 'outer-corner';
type PathTileClassification = {
  variant: PathTileVariant;
  directionDx: number;
  directionDz: number;
};
const parseGridKey = (key: string) => {
  const [xRaw = '0', zRaw = '0'] = key.split(',');
  return { x: Number(xRaw), z: Number(zRaw) };
};
const classifyPathTile = (
  x: number,
  z: number,
  hasPathAt: (x: number, z: number) => boolean
): PathTileClassification => {
  const north = hasPathAt(x, z - 1);
  const east = hasPathAt(x + 1, z);
  const south = hasPathAt(x, z + 1);
  const west = hasPathAt(x - 1, z);
  const northEast = hasPathAt(x + 1, z - 1);
  const southEast = hasPathAt(x + 1, z + 1);
  const southWest = hasPathAt(x - 1, z + 1);
  const northWest = hasPathAt(x - 1, z - 1);

  const grassCardinals = cardinalGrassOffsets.filter(
    ({ dx, dz }) => !hasPathAt(x + dx, z + dz)
  );
  if (grassCardinals.length === 1) {
    return {
      variant: 'edge',
      directionDx: grassCardinals[0]!.dx,
      directionDz: grassCardinals[0]!.dz,
    };
  }

  if (grassCardinals.length === 2) {
    const hasNorth = grassCardinals.some(({ key }) => key === 'north');
    const hasEast = grassCardinals.some(({ key }) => key === 'east');
    const hasSouth = grassCardinals.some(({ key }) => key === 'south');
    const hasWest = grassCardinals.some(({ key }) => key === 'west');
    if (hasNorth && hasEast)
      return { variant: 'outer-corner', directionDx: 1, directionDz: -1 };
    if (hasEast && hasSouth)
      return { variant: 'outer-corner', directionDx: 1, directionDz: 1 };
    if (hasSouth && hasWest)
      return { variant: 'outer-corner', directionDx: -1, directionDz: 1 };
    if (hasWest && hasNorth)
      return { variant: 'outer-corner', directionDx: -1, directionDz: -1 };
  }

  const innerCornerDirections: Array<{ dx: number; dz: number }> = [];
  if (north && east && !northEast)
    innerCornerDirections.push({ dx: 1, dz: -1 });
  if (east && south && !southEast) innerCornerDirections.push({ dx: 1, dz: 1 });
  if (south && west && !southWest)
    innerCornerDirections.push({ dx: -1, dz: 1 });
  if (west && north && !northWest)
    innerCornerDirections.push({ dx: -1, dz: -1 });
  if (innerCornerDirections.length === 1) {
    const dir = innerCornerDirections[0]!;
    return {
      variant: 'inner-corner',
      directionDx: dir.dx,
      directionDz: dir.dz,
    };
  }

  return { variant: 'center', directionDx: 0, directionDz: 1 };
};
const directionToYaw = (dx: number, dz: number) => Math.atan2(dx, dz);
const edgeTileYawOffset = -Math.PI * 0.5;
const cornerTileYawOffset = Math.PI;
const snapYawToQuarterTurn = (yaw: number) =>
  Math.round(yaw / (Math.PI * 0.5)) * (Math.PI * 0.5);
const buildPathTilesFromPoints = (
  points: readonly THREE.Vector3[],
  colliders: readonly StaticCollider[],
  worldBounds: number,
  halfWidth: number
) => {
  const navResult = buildPathTilesFromNavPoints(
    points.map((point) => ({ x: point.x, z: point.z })),
    colliders.map((collider) => ({
      center: { x: collider.center.x, z: collider.center.z },
      halfSize: { x: collider.halfSize.x, z: collider.halfSize.z },
      type: collider.type,
    })),
    worldBounds,
    halfWidth
  );
  return {
    tiles: navResult.tiles.map((tile) => new THREE.Vector3(tile.x, 0, tile.z)),
    isComplete: navResult.isComplete,
    firstRejectedCell: navResult.firstRejectedCell,
    firstRejectedReason: navResult.firstRejectedReason,
  };
};
const rebuildPathTileLayer = () => {
  tmpPathCenterTransforms.length = 0;
  tmpPathEdgeTransforms.length = 0;
  tmpPathInnerCornerTransforms.length = 0;
  tmpPathOuterCornerTransforms.length = 0;
  pathTileKeys.clear();
  const uniqueKeys = new Set<string>();
  for (const points of pathTilePositions.values()) {
    for (const point of points) {
      const key = `${point.x},${point.z}`;
      if (uniqueKeys.has(key)) continue;
      uniqueKeys.add(key);
      pathTileKeys.add(key);
    }
  }
  const hasPathAt = (x: number, z: number) =>
    pathTileKeys.has(`${x},${z}`) ||
    stagingIslandsOverlay.hasBridgePathAt(x, z);
  let nearCastleCenter = 0;
  let nearCastleEdge = 0;
  let nearCastleInnerCorner = 0;
  let nearCastleOuterCorner = 0;
  const nearCastleCornerSamples: Array<{
    x: number;
    z: number;
    variant: string;
    dx: number;
    dz: number;
  }> = [];
  for (const key of pathTileKeys) {
    const { x, z } = parseGridKey(key);
    const classification = classifyPathTile(x, z, hasPathAt);
    const nearCastle =
      Math.abs(x - castleCollider.center.x) <= 8 &&
      Math.abs(z - castleCollider.center.z) <= 8;
    if (nearCastle) {
      if (classification.variant === 'center') nearCastleCenter += 1;
      else if (classification.variant === 'edge') nearCastleEdge += 1;
      else if (classification.variant === 'inner-corner')
        nearCastleInnerCorner += 1;
      else if (classification.variant === 'outer-corner')
        nearCastleOuterCorner += 1;
      if (
        (classification.variant === 'inner-corner' ||
          classification.variant === 'outer-corner') &&
        nearCastleCornerSamples.length < 6
      ) {
        nearCastleCornerSamples.push({
          x,
          z,
          variant: classification.variant,
          dx: classification.directionDx,
          dz: classification.directionDz,
        });
      }
    }
    const targetLayer =
      classification.variant === 'edge'
        ? pathEdgeTileLayer
        : classification.variant === 'inner-corner'
          ? pathInnerCornerTileLayer
          : classification.variant === 'outer-corner'
            ? pathOuterCornerTileLayer
            : pathCenterTileLayer;
    const targetTransforms =
      classification.variant === 'edge'
        ? tmpPathEdgeTransforms
        : classification.variant === 'inner-corner'
          ? tmpPathInnerCornerTransforms
          : classification.variant === 'outer-corner'
            ? tmpPathOuterCornerTransforms
            : tmpPathCenterTransforms;
    const desiredYaw = directionToYaw(
      classification.directionDx,
      classification.directionDz
    );
    const variantYawOffset =
      classification.variant === 'edge'
        ? edgeTileYawOffset
        : classification.variant === 'inner-corner' ||
            classification.variant === 'outer-corner'
          ? cornerTileYawOffset
          : 0;
    const correctedYaw =
      desiredYaw - targetLayer.getFacingYaw() + variantYawOffset;
    const finalYaw =
      classification.variant === 'center'
        ? correctedYaw
        : snapYawToQuarterTurn(correctedYaw);
    tmpPathTransformScratch.makeRotationY(finalYaw);
    tmpPathTransformScratch.setPosition(x, 0, z);
    targetTransforms.push(tmpPathTransformScratch.clone());
  }
  pathCenterTileLayer.setTransforms(tmpPathCenterTransforms);
  pathEdgeTileLayer.setTransforms(tmpPathEdgeTransforms);
  pathInnerCornerTileLayer.setTransforms(tmpPathInnerCornerTransforms);
  pathOuterCornerTileLayer.setTransforms(tmpPathOuterCornerTransforms);
  if (lastGroundBounds) {
    const bounds = lastGroundBounds;
    lastGroundBounds = null;
    updateGroundFromBounds(bounds);
  }
};
let lastGroundBounds: GroundBounds | null = null;
const updateGroundFromBounds = (bounds: GroundBounds) => {
  const clampedBounds: GroundBounds = {
    minX: Math.max(bounds.minX, -WORLD_BOUNDS),
    maxX: Math.min(bounds.maxX, WORLD_BOUNDS),
    minZ: Math.max(bounds.minZ, -WORLD_BOUNDS),
    maxZ: Math.min(bounds.maxZ, WORLD_BOUNDS),
  };
  if (
    clampedBounds.minX > clampedBounds.maxX ||
    clampedBounds.minZ > clampedBounds.maxZ
  ) {
    return;
  }

  if (
    lastGroundBounds &&
    lastGroundBounds.minX === clampedBounds.minX &&
    lastGroundBounds.maxX === clampedBounds.maxX &&
    lastGroundBounds.minZ === clampedBounds.minZ &&
    lastGroundBounds.maxZ === clampedBounds.maxZ
  ) {
    return;
  }
  lastGroundBounds = clampedBounds;
  const width = clampedBounds.maxX - clampedBounds.minX;
  const depth = clampedBounds.maxZ - clampedBounds.minZ;
  ground.scale.set(width, depth, 1);
  ground.position.set(
    (clampedBounds.minX + clampedBounds.maxX) * 0.5,
    0,
    (clampedBounds.minZ + clampedBounds.maxZ) * 0.5
  );
  const positions: THREE.Vector3[] = [];
  const minX = Math.ceil(clampedBounds.minX / GRID_SIZE) * GRID_SIZE;
  const maxX = Math.floor(clampedBounds.maxX / GRID_SIZE) * GRID_SIZE;
  const minZ = Math.ceil(clampedBounds.minZ / GRID_SIZE) * GRID_SIZE;
  const maxZ = Math.floor(clampedBounds.maxZ / GRID_SIZE) * GRID_SIZE;
  for (let x = minX; x <= maxX; x += GRID_SIZE) {
    for (let z = minZ; z <= maxZ; z += GRID_SIZE) {
      const key = `${x},${z}`;
      if (pathTileKeys.has(key)) continue;
      positions.push(new THREE.Vector3(x, 0, z));
    }
  }
  groundTileLayer.setPositions(positions);
};

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x52a384 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.visible = false;
ground.receiveShadow = true;
scene.add(ground);
type WaterDistanceField = {
  texture: THREE.DataTexture;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
};
const waterOuterEdge = WORLD_BOUNDS + WATER_RING_OUTER_PADDING;
const buildCoastlineLandKeys = () => {
  const landKeys = new Set<string>();
  for (let x = -WORLD_BOUNDS; x <= WORLD_BOUNDS; x += GRID_SIZE) {
    for (let z = -WORLD_BOUNDS; z <= WORLD_BOUNDS; z += GRID_SIZE) {
      landKeys.add(`${x},${z}`);
    }
  }
  const stagingKeys = stagingIslandsOverlay.getLandTileKeys();
  for (const key of stagingKeys) {
    landKeys.add(key);
  }
  return landKeys;
};

const buildWaterDistanceField = (
  landTileKeys: Set<string>
): WaterDistanceField => {
  let minX = -waterOuterEdge;
  let maxX = waterOuterEdge;
  let minZ = -waterOuterEdge;
  let maxZ = waterOuterEdge;
  for (const key of landTileKeys) {
    const { x, z } = parseGridKey(key);
    minX = Math.min(minX, x - GRID_SIZE * 3);
    maxX = Math.max(maxX, x + GRID_SIZE * 3);
    minZ = Math.min(minZ, z - GRID_SIZE * 3);
    maxZ = Math.max(maxZ, z + GRID_SIZE * 3);
  }
  const sizeX = Math.max(GRID_SIZE * 2, maxX - minX);
  const sizeZ = Math.max(GRID_SIZE * 2, maxZ - minZ);
  const cellsX = Math.max(2, Math.floor(sizeX / GRID_SIZE) + 1);
  const cellsZ = Math.max(2, Math.floor(sizeZ / GRID_SIZE) + 1);
  const maxDistCells = 34;
  const dist = new Int16Array(cellsX * cellsZ);
  dist.fill(-1);
  const landMask = new Uint8Array(cellsX * cellsZ);
  const queue = new Int32Array(cellsX * cellsZ);
  let head = 0;
  let tail = 0;
  const indexOf = (tx: number, tz: number) => tz * cellsX + tx;
  const toCellX = (x: number) =>
    Math.max(0, Math.min(cellsX - 1, Math.round((x - minX) / GRID_SIZE)));
  const toCellZ = (z: number) =>
    Math.max(0, Math.min(cellsZ - 1, Math.round((z - minZ) / GRID_SIZE)));

  for (const key of landTileKeys) {
    const { x, z } = parseGridKey(key);
    const idx = indexOf(toCellX(x), toCellZ(z));
    if (landMask[idx] === 1) continue;
    landMask[idx] = 1;
  }

  // Seed from shoreline water cells (water cells directly adjacent to land),
  // so every coast emits at the same phase origin.
  for (let tz = 0; tz < cellsZ; tz += 1) {
    for (let tx = 0; tx < cellsX; tx += 1) {
      const idx = indexOf(tx, tz);
      if (landMask[idx] === 1) continue;
      let touchesLand = false;
      if (tx > 0 && landMask[idx - 1] === 1) touchesLand = true;
      if (tx + 1 < cellsX && landMask[idx + 1] === 1) touchesLand = true;
      if (tz > 0 && landMask[idx - cellsX] === 1) touchesLand = true;
      if (tz + 1 < cellsZ && landMask[idx + cellsX] === 1) touchesLand = true;
      if (!touchesLand) continue;
      dist[idx] = 0;
      queue[tail] = idx;
      tail += 1;
    }
  }

  while (head < tail) {
    const idx = queue[head]!;
    head += 1;
    const baseDist = dist[idx]!;
    if (baseDist >= maxDistCells) continue;
    const tx = idx % cellsX;
    const tz = (idx - tx) / cellsX;
    const nextDist = baseDist + 1;
    if (tx > 0) {
      const ni = idx - 1;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tx + 1 < cellsX) {
      const ni = idx + 1;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tz > 0) {
      const ni = idx - cellsX;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
    if (tz + 1 < cellsZ) {
      const ni = idx + cellsX;
      if (landMask[ni] === 0 && dist[ni] === -1) {
        dist[ni] = nextDist;
        queue[tail] = ni;
        tail += 1;
      }
    }
  }

  const data = new Uint8Array(cellsX * cellsZ * 4);
  for (let i = 0; i < dist.length; i += 1) {
    if (landMask[i] === 1) {
      const diLand = i * 4;
      data[diLand] = 0;
      data[diLand + 1] = 0;
      data[diLand + 2] = 0;
      data[diLand + 3] = 0;
      continue;
    }
    const raw = dist[i]!;
    const clamped = raw < 0 ? maxDistCells : Math.min(raw, maxDistCells);
    const normalized = clamped / maxDistCells;
    const byte = Math.round(normalized * 255);
    const di = i * 4;
    data[di] = byte;
    data[di + 1] = byte;
    data[di + 2] = byte;
    data[di + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, cellsX, cellsZ, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, minX, minZ, sizeX, sizeZ };
};

const buildWaterSurfaceGeometry = (
  landTileKeys: Set<string>,
  field: WaterDistanceField
) => {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const minX = field.minX;
  const maxX = field.minX + field.sizeX;
  const minZ = field.minZ;
  const maxZ = field.minZ + field.sizeZ;
  const startX = Math.ceil(minX / GRID_SIZE) * GRID_SIZE;
  const endX = Math.floor(maxX / GRID_SIZE) * GRID_SIZE;
  const startZ = Math.ceil(minZ / GRID_SIZE) * GRID_SIZE;
  const endZ = Math.floor(maxZ / GRID_SIZE) * GRID_SIZE;
  for (let x = startX; x <= endX; x += GRID_SIZE) {
    for (let z = startZ; z <= endZ; z += GRID_SIZE) {
      if (landTileKeys.has(`${x},${z}`)) continue;
      const x0 = x - GRID_SIZE * 0.5;
      const x1 = x + GRID_SIZE * 0.5;
      const z0 = z - GRID_SIZE * 0.5;
      const z1 = z + GRID_SIZE * 0.5;
      positions.push(
        x0,
        0,
        z0,
        x1,
        0,
        z1,
        x1,
        0,
        z0,
        x0,
        0,
        z0,
        x0,
        0,
        z1,
        x1,
        0,
        z1
      );
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
};
const initialWaterLandKeys = buildCoastlineLandKeys();
let waterDistanceField = buildWaterDistanceField(initialWaterLandKeys);
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uDistanceTex: { value: waterDistanceField.texture },
    uBounds: {
      value: new THREE.Vector4(
        waterDistanceField.minX,
        waterDistanceField.minZ,
        waterDistanceField.sizeX,
        waterDistanceField.sizeZ
      ),
    },
    uWaterColor: { value: new THREE.Color(0x3f8fb2) },
    uFoamColor: { value: new THREE.Color(0xc9f3fb) },
  },
  transparent: true,
  depthWrite: false,
  vertexShader: `
    varying vec2 vWorldXZ;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldXZ = worldPos.xz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vWorldXZ;
    uniform float uTime;
    uniform sampler2D uDistanceTex;
    uniform vec4 uBounds;
    uniform vec3 uWaterColor;
    uniform vec3 uFoamColor;

    void main() {
      vec2 uv = (vWorldXZ - uBounds.xy) / uBounds.zw;
      uv = clamp(uv, 0.0, 1.0);
      vec4 distanceSample = texture2D(uDistanceTex, uv);
      float distanceToLand = distanceSample.r;

      vec3 baseColor = uWaterColor;

      // Simplified pulse controls:
      // emitRate, travelSpeed, stroke, fadeDistance.
      float emitRate = 0.90;
      float travelSpeed = 0.08;
      float stroke = 0.028;
      float fadeDistance = 2.0;
      float cycle = fract(uTime * emitRate);

      // Start fully hidden: negative offset of half stroke + blur.
      float blur = stroke * 0.5;
      float startOffset = -(0.5 * stroke + blur);
      float center = startOffset + cycle * travelSpeed;
      float halfStroke = max(0.00075, stroke * 0.5);
      float distToCenter = abs(distanceToLand - center);
      float band = 1.0 - smoothstep(halfStroke - blur, halfStroke + blur, distToCenter);

      float lifeFade = 1.0 - cycle;
      float distanceFade = exp(-distanceToLand / max(0.0001, fadeDistance));
      float ringFoam = band * lifeFade * distanceFade;
      float foamAmount = clamp(ringFoam * 0.42, 0.0, 1.0);
      vec3 color = mix(baseColor, uFoamColor, foamAmount * 0.65);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const waterMesh = new THREE.Mesh(
  buildWaterSurfaceGeometry(initialWaterLandKeys, waterDistanceField),
  waterMaterial
);
waterMesh.position.set(0, WATER_LEVEL - 0.01, 0);
waterMesh.castShadow = false;
waterMesh.receiveShadow = false;
scene.add(waterMesh);
const updateWaterFromBounds = (_bounds: GroundBounds) => {};

const rebuildWaterDistanceField = () => {
  const nextLandKeys = buildCoastlineLandKeys();
  const next = buildWaterDistanceField(nextLandKeys);
  const nextGeometry = buildWaterSurfaceGeometry(nextLandKeys, next);
  waterMesh.geometry.dispose();
  waterMesh.geometry = nextGeometry;
  waterDistanceField.texture.dispose();
  waterDistanceField = next;
  waterMaterial.uniforms.uDistanceTex.value = next.texture;
  waterMaterial.uniforms.uBounds.value.set(
    next.minX,
    next.minZ,
    next.sizeX,
    next.sizeZ
  );
};
stagingIslandsOverlay.setTilesChangedListener(rebuildWaterDistanceField);

const castle = new THREE.Group();
castle.position.set(0, 0, 0);
scene.add(castle);
let castleContentLoaded = false;

const replaceCastleContent = (object: THREE.Object3D) => {
  while (castle.children.length > 0) {
    castle.remove(castle.children[0]!);
  }
  castle.add(object);
};

const castleCollider: StaticCollider = {
  center: new THREE.Vector3(0, 0, 0),
  halfSize: new THREE.Vector3(3.5, 0.5, 3.5),
  type: 'castle',
};
const CASTLE_FRONT_DIRECTION = new THREE.Vector2(0, 1);
const staticColliders: StaticCollider[] = [castleCollider];
const castleBankSelectionCollider: DestructibleCollider = {
  center: castleCollider.center,
  halfSize: castleCollider.halfSize,
  type: 'bank',
};
const castleBankPiles = new THREE.Group();
scene.add(castleBankPiles);

const updateCastleColliderFromObject = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const minHalfSize = GRID_SIZE * 0.5;
  const collisionPadding = 0.15;
  castleCollider.center.set(center.x, 0, center.z);
  castleCollider.halfSize.set(
    Math.max(minHalfSize, size.x * 0.5 + collisionPadding),
    0.5,
    Math.max(minHalfSize, size.z * 0.5 + collisionPadding)
  );

  const queue: THREE.Object3D[] = [object];
  let facingMarker: THREE.Object3D | null = null;
  while (queue.length > 0 && !facingMarker) {
    const child = queue.pop()!;
    const name = (child.name || '').toLowerCase();
    if (name === 'facing' || name.startsWith('facing')) {
      facingMarker = child;
      break;
    }
    for (let i = 0; i < child.children.length; i += 1) {
      queue.push(child.children[i]!);
    }
  }
  if (facingMarker) {
    const facingQuat = new THREE.Quaternion();
    facingMarker.getWorldQuaternion(facingQuat);
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(facingQuat);
    forward.y = 0;
    let len = Math.hypot(forward.x, forward.z);

    // Some exports use a different local forward axis.
    if (len <= 1e-4) {
      forward.set(0, 0, 1).applyQuaternion(facingQuat);
      forward.y = 0;
      len = Math.hypot(forward.x, forward.z);
    }
    if (len <= 1e-4) {
      forward.set(1, 0, 0).applyQuaternion(facingQuat);
      forward.y = 0;
      len = Math.hypot(forward.x, forward.z);
    }

    // Fallback for non-rotated markers: use marker position offset from center.
    if (len <= 1e-4) {
      const facingWorld = new THREE.Vector3();
      facingMarker.getWorldPosition(facingWorld);
      forward.set(facingWorld.x - center.x, 0, facingWorld.z - center.z);
      len = Math.hypot(forward.x, forward.z);
    }

    if (len > 1e-4) {
      CASTLE_FRONT_DIRECTION.set(forward.x / len, forward.z / len);
    }
  }

  invalidateCastleFlowField();
  refreshAllSpawnerPathlines();
};

const gltfLoader = new GLTFLoader();
const REQUIRED_MODEL_LOADS = 14;
let completedModelLoads = 0;
let hasFinishedLoadingAssets = false;
let hasRevealedScene = false;
let hasStartedGameLoop = false;
let startGameWhenReady: (() => void) | null = null;

const updateLoadingProgress = () => {
  const clampedProgress = Math.min(
    1,
    Math.max(0, completedModelLoads / REQUIRED_MODEL_LOADS)
  );
  const progressPercent = Math.round(clampedProgress * 100);
  loadingProgressFillEl.style.width = `${progressPercent}%`;
  loadingProgressLabelEl.textContent = `${progressPercent}%`;
};

const completeLoadingAndRevealScene = () => {
  if (hasRevealedScene) return;
  hasRevealedScene = true;
  renderer.domElement.style.visibility = 'visible';
  loadingScreenEl.classList.add('is-hidden');
  window.setTimeout(() => {
    loadingScreenEl.remove();
  }, 220);
};

const markModelLoadCompleted = () => {
  completedModelLoads = Math.min(REQUIRED_MODEL_LOADS, completedModelLoads + 1);
  updateLoadingProgress();
  if (completedModelLoads < REQUIRED_MODEL_LOADS) return;
  hasFinishedLoadingAssets = true;
  startGameWhenReady?.();
};

type ModelLoadSuccessHandler = (gltf: { scene: THREE.Object3D }) => void;
type ModelLoadErrorHandler = (error: unknown) => void;

const loadModelWithProgress = (
  modelUrl: string,
  onLoad: ModelLoadSuccessHandler,
  onError?: ModelLoadErrorHandler
) => {
  let settled = false;
  const finalize = () => {
    if (settled) return;
    settled = true;
    markModelLoadCompleted();
  };
  gltfLoader.load(
    modelUrl,
    (gltf) => {
      try {
        onLoad(gltf);
      } finally {
        finalize();
      }
    },
    undefined,
    (error) => {
      try {
        if (onError) {
          onError(error);
        } else {
          console.error(`Failed to load model: ${modelUrl}`, error);
        }
      } finally {
        finalize();
      }
    }
  );
};

updateLoadingProgress();
let towerModelTemplate: THREE.Object3D | null = null;
let arrowModelTemplate: THREE.Object3D | null = null;
let treeModelTemplate: THREE.Object3D | null = null;
let coinModelTemplate: THREE.Object3D | null = null;
let wallModelTemplate: THREE.Object3D | null = null;
const arrowFacingAnchorLocalPos = new THREE.Vector3();
const arrowFacingForwardLocal = new THREE.Vector3(0, 1, 0);
const towerBallistaRigs = new Map<Tower, BallistaVisualRig>();
type RockVisualTemplate = {
  sourceUrl: string;
  template: THREE.Object3D;
};
const rockTemplates: RockVisualTemplate[] = [];
let rockVisualsNeedFullRefresh = true;
const ROCK_TEMPLATE_EXPECTED_COUNT = 2;
const ROCK_BASE_HEIGHT = 0.5;

const getRockTemplateForPlacement = (modelIndex: number) => {
  if (rockTemplates.length === 0) return null;
  const safeIndex = Math.abs(Math.round(modelIndex)) % rockTemplates.length;
  return rockTemplates[safeIndex] ?? rockTemplates[0] ?? null;
};

const hasAllRockTemplates = () =>
  rockTemplates.length >= ROCK_TEMPLATE_EXPECTED_COUNT;

const refreshAllRockVisuals = (forceRefresh: boolean) => {
  for (const [collider, state] of structureStore.structureStates.entries()) {
    if (collider.type !== 'rock') continue;
    applyRockVisualToMesh(state.mesh, forceRefresh);
  }
};

const registerRockTemplate = (sourceUrl: string, source: THREE.Object3D) => {
  const template = prepareStaticModelPreserveScale(source);
  const entry: RockVisualTemplate = { sourceUrl, template };
  const existingIndex = rockTemplates.findIndex(
    (rock) => rock.sourceUrl === sourceUrl
  );
  if (existingIndex >= 0) {
    rockTemplates[existingIndex] = entry;
  } else {
    rockTemplates.push(entry);
  }
  rockVisualsNeedFullRefresh = true;
};

const prepareStaticModelPreserveScale = (source: THREE.Object3D) => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return model;
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  model.position.set(-center.x, -bounds.min.y, -center.z);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
};

const prepareCoinModel = (source: THREE.Object3D) => {
  const model = source.clone(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  if (initialBounds.isEmpty()) return model;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  initialBounds.getSize(size);
  initialBounds.getCenter(center);
  const largestAxis = Math.max(size.x, size.y, size.z, 0.001);
  const targetAxis = 1.2;
  const uniformScale = targetAxis / largestAxis;
  model.scale.multiplyScalar(uniformScale);
  model.position.set(
    -center.x * uniformScale,
    -center.y * uniformScale,
    -center.z * uniformScale
  );
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
};

const applyTowerVisualToMesh = (mesh: THREE.Mesh, tower?: Tower) => {
  if (!towerModelTemplate) return;
  if (mesh.userData.outlineTarget) return;
  const rig = createBallistaVisualRig(towerModelTemplate);
  const towerVisual = rig?.root ?? towerModelTemplate.clone(true);
  towerVisual.position.copy(mesh.position);
  towerVisual.position.y -= TOWER_BUILD_SIZE.y * 0.5;
  towerVisual.userData.isTowerVisual = true;
  scene.add(towerVisual);
  mesh.userData.outlineTarget = towerVisual;
  mesh.userData.linkedVisual = towerVisual;
  // Keep collision/raycast hitboxes out of render + outline passes.
  mesh.layers.set(HITBOX_LAYER);
  if (tower && rig) {
    towerBallistaRigs.set(tower, rig);
  }
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

const applyTreeVisualToMesh = (mesh: THREE.Mesh) => {
  if (!treeModelTemplate) return;
  if (mesh.userData.outlineTarget) return;
  const footprint = clampTreeFootprint(
    Number(mesh.userData.treeFootprint ?? DEFAULT_TREE_FOOTPRINT)
  );
  const footprintScale = getTreeScaleForFootprint(footprint);
  const treeVisual = treeModelTemplate.clone(true);
  treeVisual.position.copy(mesh.position);
  treeVisual.position.y -= TREE_BUILD_SIZE.y * 0.5 * footprintScale;
  treeVisual.scale.setScalar(footprintScale);
  treeVisual.userData.isTreeVisual = true;
  scene.add(treeVisual);
  mesh.userData.outlineTarget = treeVisual;
  mesh.userData.linkedVisual = treeVisual;
  // Keep collision/raycast hitboxes out of render + outline passes.
  mesh.layers.set(HITBOX_LAYER);
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

const applyRockVisualToMesh = (mesh: THREE.Mesh, forceRefresh = false) => {
  const modelIndex = (mesh.userData.rockModelIndex as number | undefined) ?? 0;
  const template = getRockTemplateForPlacement(modelIndex);
  if (!template) return;
  if (mesh.userData.outlineTarget && !forceRefresh) return;
  if (forceRefresh) {
    const existingVisual = mesh.userData.linkedVisual as
      | THREE.Object3D
      | undefined;
    if (existingVisual) {
      existingVisual.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        if (Array.isArray(node.material)) {
          for (const material of node.material) material.dispose();
        } else {
          node.material.dispose();
        }
      });
      scene.remove(existingVisual);
    }
    delete mesh.userData.linkedVisual;
    delete mesh.userData.outlineTarget;
  }
  const yawQuarterTurns =
    (mesh.userData.rockYawQuarterTurns as number | undefined) ?? 0;
  const yaw = yawQuarterTurns * (Math.PI * 0.5);
  const footprintX = Math.max(1, Number(mesh.userData.rockFootprintX ?? 1));
  const footprintZ = Math.max(1, Number(mesh.userData.rockFootprintZ ?? 1));
  const quarterTurns = ((Math.round(yawQuarterTurns) % 4) + 4) % 4;
  const isQuarterTurn = quarterTurns % 2 === 1;
  const visualScaleX = isQuarterTurn ? footprintZ : footprintX;
  const visualScaleZ = isQuarterTurn ? footprintX : footprintZ;
  const verticalScale = Math.max(
    0.65,
    Number(mesh.userData.rockVerticalScale ?? 1)
  );
  const mirrorX = mesh.userData.rockMirrorX === true;
  const mirrorZ = mesh.userData.rockMirrorZ === true;
  const rockVisual = template.template.clone(true);
  rockVisual.position.copy(mesh.position);
  rockVisual.position.y = 0;
  rockVisual.scale.set(
    visualScaleX * (mirrorX ? -1 : 1),
    verticalScale,
    visualScaleZ * (mirrorZ ? -1 : 1)
  );
  rockVisual.rotation.y = yaw;
  rockVisual.userData.isRockVisual = true;
  scene.add(rockVisual);
  mesh.userData.outlineTarget = rockVisual;
  mesh.userData.linkedVisual = rockVisual;
  mesh.layers.set(HITBOX_LAYER);
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

const applyWallVisualToMesh = (mesh: THREE.Mesh) => {
  if (!wallModelTemplate) return;
  if (mesh.userData.outlineTarget) return;
  const wallVisual = wallModelTemplate.clone(true);
  wallVisual.position.copy(mesh.position);
  wallVisual.position.y -= 0.5;
  wallVisual.userData.isWallVisual = true;
  scene.add(wallVisual);
  mesh.userData.outlineTarget = wallVisual;
  mesh.userData.linkedVisual = wallVisual;
  // Keep collision/raycast hitboxes out of render + outline passes.
  mesh.layers.set(HITBOX_LAYER);
  const hitboxMaterial = mesh.material as THREE.MeshStandardMaterial;
  hitboxMaterial.transparent = true;
  hitboxMaterial.opacity = 0;
  hitboxMaterial.colorWrite = false;
  hitboxMaterial.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
};

const setStructureVisualScale = (mesh: THREE.Mesh, scale: number) => {
  mesh.scale.setScalar(scale);
  const linkedVisual = mesh.userData.linkedVisual as THREE.Object3D | undefined;
  if (linkedVisual) {
    linkedVisual.scale.setScalar(scale);
  }
};

const DAMAGE_TINT = new THREE.Color(0xff5d5d);
const DEATH_FLASH_TINT = new THREE.Color(0xff2a2a);
const TEMP_BASE_COLOR = new THREE.Color();

const applyStructureDamageVisuals = () => {
  for (const [collider, state] of structureStore.structureStates) {
    if (collider.type !== 'wall' && collider.type !== 'tower') continue;
    const hpRatio = state.maxHp <= 0 ? 1 : state.hp / state.maxHp;
    const missingRatio = 1 - clamp(hpRatio, 0, 1);
    const tintStrength =
      missingRatio >= REPAIR_WARNING_HP_RATIO
        ? missingRatio
        : missingRatio * 0.65;
    const applyTintToMesh = (target: THREE.Mesh) => {
      const material = target.material;
      const applyTint = (mat: THREE.Material) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;
        const storedBaseColorHex = mat.userData.damageTintBaseColorHex as
          | number
          | undefined;
        if (storedBaseColorHex === undefined) {
          mat.userData.damageTintBaseColorHex = mat.color.getHex();
        }
        const baseColorHex =
          (mat.userData.damageTintBaseColorHex as number | undefined) ??
          mat.color.getHex();
        TEMP_BASE_COLOR.setHex(baseColorHex);
        mat.color.copy(TEMP_BASE_COLOR).lerp(DAMAGE_TINT, tintStrength);
      };
      if (Array.isArray(material)) {
        for (const mat of material) applyTint(mat);
        return;
      }
      applyTint(material);
    };
    applyTintToMesh(state.mesh);
    const linkedVisual = state.mesh.userData.linkedVisual as
      | THREE.Object3D
      | undefined;
    if (linkedVisual) {
      linkedVisual.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        applyTintToMesh(node);
      });
    }
  }
};

const syncHudCoinModel = () => {
  coinHudRoot.clear();
  if (!coinModelTemplate) return;
  const hudCoin = coinModelTemplate.clone(true);
  hudCoin.scale.multiplyScalar(0.85);
  hudCoin.rotation.y = Math.PI / 7;
  coinHudRoot.add(hudCoin);
};

loadModelWithProgress(
  groundModelUrl,
  (gltf) => {
    groundTileLayer.setTemplate(gltf.scene);
    stagingIslandsOverlay.setGroundTemplate(gltf.scene);
    ground.visible = false;
    if (lastGroundBounds) {
      const bounds = lastGroundBounds;
      lastGroundBounds = null;
      updateGroundFromBounds(bounds);
    }
  },
  (error) => {
    console.error('Failed to load ground model:', error);
  }
);

loadModelWithProgress(
  pathModelUrl,
  (gltf) => {
    pathCenterTileLayer.setTemplate(gltf.scene);
    stagingIslandsOverlay.setPathTemplate(gltf.scene);
    rebuildPathTileLayer();
  },
  (error) => {
    console.error('Failed to load path model:', error);
  }
);

loadModelWithProgress(
  pathEdgeModelUrl,
  (gltf) => {
    pathEdgeTileLayer.setTemplate(gltf.scene);
    stagingIslandsOverlay.setPathEdgeTemplate(gltf.scene);
    rebuildPathTileLayer();
  },
  (error) => {
    console.error('Failed to load path edge model:', error);
  }
);

loadModelWithProgress(
  pathCornerInnerModelUrl,
  (gltf) => {
    pathInnerCornerTileLayer.setTemplate(gltf.scene);
    stagingIslandsOverlay.setPathInnerCornerTemplate(gltf.scene);
    rebuildPathTileLayer();
  },
  (error) => {
    console.error('Failed to load path inner corner model:', error);
  }
);

loadModelWithProgress(
  pathCornerOuterModelUrl,
  (gltf) => {
    pathOuterCornerTileLayer.setTemplate(gltf.scene);
    stagingIslandsOverlay.setPathOuterCornerTemplate(gltf.scene);
    rebuildPathTileLayer();
  },
  (error) => {
    console.error('Failed to load path outer corner model:', error);
  }
);

loadModelWithProgress(
  towerBallistaModelUrl,
  (gltf) => {
    towerModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
    for (const tower of towers) {
      applyTowerVisualToMesh(tower.mesh, tower);
    }
  },
  (error) => {
    console.error('Failed to load tower model:', error);
  }
);

loadModelWithProgress(
  arrowModelUrl,
  (gltf) => {
    arrowModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
    updateArrowFacingFromTemplate(arrowModelTemplate);
  },
  (error) => {
    console.error('Failed to load arrow model:', error);
  }
);

loadModelWithProgress(
  treeModelUrl,
  (gltf) => {
    treeModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
    for (const [collider, state] of structureStore.structureStates.entries()) {
      if (collider.type !== 'tree') continue;
      applyTreeVisualToMesh(state.mesh);
    }
  },
  (error) => {
    console.error('Failed to load tree model:', error);
  }
);

loadModelWithProgress(
  rockModelUrl,
  (gltf) => {
    registerRockTemplate(rockModelUrl, gltf.scene);
    refreshAllRockVisuals(hasAllRockTemplates());
  },
  (error) => {
    console.error('Failed to load rock model:', error);
  }
);

loadModelWithProgress(
  rock2ModelUrl,
  (gltf) => {
    registerRockTemplate(rock2ModelUrl, gltf.scene);
    refreshAllRockVisuals(hasAllRockTemplates());
  },
  (error) => {
    console.error('Failed to load secondary rock model:', error);
  }
);

loadModelWithProgress(
  wallModelUrl,
  (gltf) => {
    wallModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
    for (const wallMesh of structureStore.wallMeshes) {
      applyWallVisualToMesh(wallMesh);
    }
  },
  (error) => {
    console.error('Failed to load wall model:', error);
  }
);

loadModelWithProgress(
  coinModelUrl,
  (gltf) => {
    coinModelTemplate = prepareCoinModel(gltf.scene);
    syncHudCoinModel();
    setCoinParticleTemplate(coinModelTemplate);
  },
  (error) => {
    console.error('Failed to load coin model:', error);
  }
);

loadModelWithProgress(
  mobModelUrl,
  (gltf) => {
    applyMobVisualTemplate(gltf.scene);
  },
  (error) => {
    console.error('Failed to load mob model:', error);
  }
);

loadModelWithProgress(
  castleModelUrl,
  (gltf) => {
    if (castleContentLoaded) return;
    castleContentLoaded = true;
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    replaceCastleContent(model);
    updateCastleColliderFromObject(model);
    updateCastleBankPilesVisual();
    refreshAllSpawnerPathlines();
  },
  (error) => {
    if (castleContentLoaded) return;
    castleContentLoaded = true;
    console.error('Failed to load castle model:', error);
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshStandardMaterial({ color: 0xe0c34a })
    );
    fallback.rotation.x = -Math.PI / 2;
    fallback.position.set(0, 0.02, 0);
    fallback.castShadow = true;
    fallback.receiveShadow = true;
    replaceCastleContent(fallback);
    updateCastleColliderFromObject(fallback);
    updateCastleBankPilesVisual();
    refreshAllSpawnerPathlines();
  }
);
const mobs: MobEntity[] = [];
const towers: Tower[] = [];
const activeArrowProjectiles: ArrowProjectile[] = [];
type PlayerArrowProjectile = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: THREE.Vector3;
  gravityDelay: number;
  radius: number;
  ttl: number;
  damage: number;
};
const activePlayerArrowProjectiles: PlayerArrowProjectile[] = [];
let selectedTower: Tower | null = null;
const structureStore = new StructureStore(
  scene,
  staticColliders,
  towers,
  (tower) => {
    if (selectedTower === tower) selectedTower = null;
    for (let i = activeArrowProjectiles.length - 1; i >= 0; i -= 1) {
      const projectile = activeArrowProjectiles[i]!;
      if (projectile.sourceTower !== tower) continue;
      scene.remove(projectile.mesh);
      activeArrowProjectiles.splice(i, 1);
    }
  },
  (added, removed = []) => applyObstacleDelta(added, removed)
);

const markPersistentMapFeature = (mesh: THREE.Mesh) => {
  mesh.userData.persistOnReset = true;
};

// Initialize spatial grid and lane path caches
const spatialGrid = new SpatialGrid(SPATIAL_GRID_CELL_SIZE);
const getCastleEntryGoals = () => {
  const snapToGrid = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;
  const x = snapToGrid(castleCollider.center.x);
  const z = snapToGrid(castleCollider.center.z);
  const hx = castleCollider.halfSize.x;
  const hz = castleCollider.halfSize.z;
  // Keep the front entry goal beyond the castle flow-field blocker inflation.
  const approachOffset = GRID_SIZE * 3;
  const useX =
    Math.abs(CASTLE_FRONT_DIRECTION.x) >= Math.abs(CASTLE_FRONT_DIRECTION.y);
  const dirX = useX ? Math.sign(CASTLE_FRONT_DIRECTION.x || 1) : 0;
  const dirZ = useX ? 0 : Math.sign(CASTLE_FRONT_DIRECTION.y || 1);
  const tangentX = -dirZ;
  const tangentZ = dirX;
  const goalX = x + dirX * (hx + approachOffset);
  const goalZ = z + dirZ * (hz + approachOffset);
  const goals: THREE.Vector3[] = [];
  const lateralOrder: number[] = [0];
  for (
    let lateral = 1;
    lateral <= CASTLE_ENTRY_GOAL_STRIP_HALF_WIDTH_CELLS;
    lateral += 1
  ) {
    lateralOrder.push(-lateral, lateral);
  }
  const rawGoals: Array<{ x: number; z: number }> = [];
  const snappedGoals: Array<{ x: number; z: number }> = [];
  for (const lateral of lateralOrder) {
    const rawX = goalX + tangentX * lateral * GRID_SIZE;
    const rawZ = goalZ + tangentZ * lateral * GRID_SIZE;
    const snappedX = snapToGrid(rawX);
    const snappedZ = snapToGrid(rawZ);
    rawGoals.push({ x: rawX, z: rawZ });
    snappedGoals.push({ x: snappedX, z: snappedZ });
    goals.push(new THREE.Vector3(snappedX, 0, snappedZ));
  }
  return goals;
};
const borderDoors = getAllBorderDoors(WORLD_BOUNDS);
const activeWaveSpawners: WaveSpawner[] = [];
const spawnerById = new Map<string, WaveSpawner>();
const spawnerPathlineCache = new Map<string, LanePathResult>();
let castleFlowField: CorridorFlowField | null = null;
let isCastleFlowFieldDirty = true;
const pendingSpawnerPathRefresh = new Set<string>();
const pendingSpawnerPathOrder: string[] = [];
const PATHLINE_REFRESH_BUDGET_PER_FRAME = 2;
const collisionNearbyScratch: Entity[] = [];
const rangeCandidateScratch: Entity[] = [];
const spawnerRouteOverlay = new SpawnerPathOverlay(scene);

const mobInstanceMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(MOB_WIDTH, MOB_HEIGHT, MOB_WIDTH),
  new THREE.MeshStandardMaterial({ color: 0xff7a7a }),
  MOB_INSTANCE_CAP
);
mobInstanceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mobInstanceMesh.frustumCulled = false;
mobInstanceMesh.castShadow = true;
mobInstanceMesh.receiveShadow = true;
scene.add(mobInstanceMesh);
const mobHitFlashMesh = new THREE.InstancedMesh(
  mobInstanceMesh.geometry,
  new THREE.MeshBasicMaterial({
    color: 0xff3f3f,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    depthTest: false,
  }),
  MOB_INSTANCE_CAP
);
mobHitFlashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mobHitFlashMesh.frustumCulled = false;
mobHitFlashMesh.castShadow = false;
mobHitFlashMesh.receiveShadow = false;
mobHitFlashMesh.renderOrder = 1000;
scene.add(mobHitFlashMesh);
const mobFacingQuaternionScratch = new THREE.Quaternion();
const mobFacingDirectionScratch = new THREE.Vector3();
const mobInstanceBaseMatrix = new THREE.Matrix4();
const mobInstanceGroundOffsetY = -MOB_HEIGHT * 0.5;
let mobInstanceHeadingOffset = 0;
let mobDeathVisualTemplate: THREE.Object3D | null = null;

const computeFacingYawFromTemplate = (source: THREE.Object3D) => {
  const facing = source.getObjectByName('Facing');
  if (!facing) return 0;
  facing.getWorldQuaternion(mobFacingQuaternionScratch);
  // Mob Facing empty is authored as an arrow; exported forward is local +Y.
  mobFacingDirectionScratch
    .set(0, 1, 0)
    .applyQuaternion(mobFacingQuaternionScratch);
  mobFacingDirectionScratch.y = 0;
  if (mobFacingDirectionScratch.lengthSq() < 1e-9) return 0;
  mobFacingDirectionScratch.normalize();
  return Math.atan2(mobFacingDirectionScratch.x, mobFacingDirectionScratch.z);
};

const getObjectByNameCaseInsensitive = (
  source: THREE.Object3D,
  targetName: string
) => {
  const direct = source.getObjectByName(targetName);
  if (direct) return direct;
  const lowered = targetName.toLowerCase();
  let match: THREE.Object3D | null = null;
  source.traverse((child) => {
    if (match) return;
    if ((child.name || '').toLowerCase() !== lowered) return;
    match = child;
  });
  return match;
};

const findFacingMarker = (source: THREE.Object3D) => {
  const exact = getObjectByNameCaseInsensitive(source, 'Facing');
  if (exact) return exact;
  let prefixMatch: THREE.Object3D | null = null;
  source.traverse((child) => {
    if (prefixMatch) return;
    const name = (child.name || '').toLowerCase();
    if (!name.startsWith('facing')) return;
    prefixMatch = child;
  });
  return prefixMatch;
};

const updateArrowFacingFromTemplate = (source: THREE.Object3D) => {
  source.updateMatrixWorld(true);
  const facing = findFacingMarker(source);
  if (!facing) {
    arrowFacingAnchorLocalPos.set(0, 0, 0);
    arrowFacingForwardLocal.set(0, 1, 0);
    return;
  }
  const sourceInverse = new THREE.Matrix4().copy(source.matrixWorld).invert();
  const facingLocalMatrix = new THREE.Matrix4().multiplyMatrices(
    sourceInverse,
    facing.matrixWorld
  );
  const facingLocalQuaternion = new THREE.Quaternion();
  const facingLocalScale = new THREE.Vector3();
  facingLocalMatrix.decompose(
    arrowFacingAnchorLocalPos,
    facingLocalQuaternion,
    facingLocalScale
  );
  const directionFromPosition = arrowFacingAnchorLocalPos.clone();
  const directionFromRotation = new THREE.Vector3(0, 1, 0).applyQuaternion(
    facingLocalQuaternion
  );
  if (directionFromPosition.lengthSq() > 1e-9) {
    arrowFacingForwardLocal.copy(directionFromPosition).normalize();
  } else if (directionFromRotation.lengthSq() > 1e-9) {
    arrowFacingForwardLocal.copy(directionFromRotation).normalize();
  } else {
    arrowFacingForwardLocal.set(0, 1, 0);
  }
};

const applyMobVisualTemplate = (source: THREE.Object3D) => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) {
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    // Keep authored bottom alignment while centering footprint around entity origin.
    model.position.set(-center.x, 0, -center.z);
  }
  model.updateMatrixWorld(true);
  mobInstanceHeadingOffset = -computeFacingYawFromTemplate(model) + Math.PI;
  mobDeathVisualTemplate = model.clone(true);
  const meshNode = model.getObjectByProperty('isMesh', true);
  if (!(meshNode instanceof THREE.Mesh)) return;
  mobInstanceBaseMatrix.copy(meshNode.matrixWorld);
  const previousGeometry = mobInstanceMesh.geometry;
  mobInstanceMesh.geometry = meshNode.geometry;
  mobHitFlashMesh.geometry = meshNode.geometry;
  previousGeometry.dispose();
  if (Array.isArray(mobInstanceMesh.material)) {
    for (const material of mobInstanceMesh.material) material.dispose();
  } else {
    mobInstanceMesh.material.dispose();
  }
  mobInstanceMesh.material = Array.isArray(meshNode.material)
    ? meshNode.material.map((material) => material.clone())
    : meshNode.material.clone();
};
const mobLogicGeometry = new THREE.BoxGeometry(
  MOB_WIDTH,
  MOB_HEIGHT,
  MOB_WIDTH
);
const mobLogicMaterial = new THREE.MeshBasicMaterial({ visible: false });
const mobInstanceDummy = new THREE.Object3D();

const getSpawnerOutwardNormal = (pos: THREE.Vector3) => {
  if (Math.abs(pos.x) >= Math.abs(pos.z)) {
    return new THREE.Vector3(Math.sign(pos.x || 1), 0, 0);
  }
  return new THREE.Vector3(0, 0, Math.sign(pos.z || 1));
};

const getSpawnerTangent = (pos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(pos);
  return new THREE.Vector3(-normal.z, 0, normal.x);
};

const getSpawnerEntryPoint = (pos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(pos);
  const insetDistance = GRID_SIZE * SPAWNER_ENTRY_INSET_CELLS;
  const x = Math.round(pos.x - normal.x * insetDistance);
  const z = Math.round(pos.z - normal.z * insetDistance);
  return new THREE.Vector3(
    clamp(x, -WORLD_BOUNDS + insetDistance, WORLD_BOUNDS - insetDistance),
    0,
    clamp(z, -WORLD_BOUNDS + insetDistance, WORLD_BOUNDS - insetDistance)
  );
};

const getStagingIslandCenter = (spawnerPos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(spawnerPos);
  return spawnerPos.clone().addScaledVector(normal, STAGING_ISLAND_DISTANCE);
};

const getSpawnerAnchorId = (spawnerPos: THREE.Vector3) =>
  `anchor-${Math.round(spawnerPos.x)},${Math.round(spawnerPos.z)}`;

const getSpawnerTowardMap = (spawnerPos: THREE.Vector3) => {
  return getSpawnerOutwardNormal(spawnerPos).multiplyScalar(-1);
};

const getSpawnerGatePoint = (spawnerPos: THREE.Vector3) => {
  const center = getStagingIslandCenter(spawnerPos);
  const towardMap = getSpawnerTowardMap(spawnerPos);
  const islandHalf = STAGING_ISLAND_SIZE * 0.5;
  return center.addScaledVector(towardMap, islandHalf - 0.35);
};

const getSpawnerBridgeExitPoint = (spawnerPos: THREE.Vector3) => {
  const towardMap = getSpawnerTowardMap(spawnerPos);
  return spawnerPos.clone().addScaledVector(towardMap, GRID_SIZE * 0.35);
};

const buildLaneWaypointsForSpawner = (
  spawner: WaveSpawner,
  lanePathPoints: THREE.Vector3[] | undefined
) => {
  if (!lanePathPoints || lanePathPoints.length === 0) return undefined;
  const entryPoint = getSpawnerEntryPoint(spawner.position);
  return [
    getSpawnerGatePoint(spawner.position),
    getSpawnerBridgeExitPoint(spawner.position),
    entryPoint.clone(),
    ...lanePathPoints.slice(1).map((point) => point.clone()),
  ];
};

const getForwardWaypointIndex = (
  pos: THREE.Vector3,
  waypoints: THREE.Vector3[],
  minIndex = 0
): number => {
  if (waypoints.length <= 1) return 0;
  let bestIdx = clamp(Math.floor(minIndex), 0, waypoints.length - 1);
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = bestIdx; i < waypoints.length; i += 1) {
    const wp = waypoints[i]!;
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }
  // Keep current forward progress without skipping route corners.
  return bestIdx;
};


const getSpawnContainerCorners = (spawnerPos: THREE.Vector3) => {
  const normal = getSpawnerOutwardNormal(spawnerPos);
  const tangent = getSpawnerTangent(spawnerPos);
  const center = getStagingIslandCenter(spawnerPos);
  const half = STAGING_ISLAND_SIZE * 0.5 - 0.8;
  return [
    center
      .clone()
      .addScaledVector(tangent, -half)
      .addScaledVector(normal, -half),
    center
      .clone()
      .addScaledVector(tangent, half)
      .addScaledVector(normal, -half),
    center.clone().addScaledVector(tangent, half).addScaledVector(normal, half),
    center
      .clone()
      .addScaledVector(tangent, -half)
      .addScaledVector(normal, half),
  ];
};

const renderAllCardinalStagingIslands = () => {
  for (const door of borderDoors) {
    stagingIslandsOverlay.upsert(
      getSpawnerAnchorId(door),
      getStagingIslandCenter(door),
      getSpawnerOutwardNormal(door),
      false,
      false
    );
  }
};

const clampStagedMobToSpawnerIsland = (mob: MobEntity) => {
  if (!mob.staged || !mob.spawnerId) return;
  const spawner = spawnerById.get(mob.spawnerId);
  if (!spawner) return;
  const center = getStagingIslandCenter(spawner.position);
  const half = STAGING_ISLAND_SIZE * 0.5 - mob.radius - 0.25;
  mob.mesh.position.x = clamp(
    mob.mesh.position.x,
    center.x - half,
    center.x + half
  );
  mob.mesh.position.z = clamp(
    mob.mesh.position.z,
    center.z - half,
    center.z + half
  );
};

const toCastleDisplayPoints = (points: THREE.Vector3[]) =>
  toCastleDisplayRoute(points, {
    castleCenter: castleCollider.center,
    castleHalfSize: { x: castleCollider.halfSize.x, z: castleCollider.halfSize.z },
    gridSize: GRID_SIZE,
    castleFrontDirection: CASTLE_FRONT_DIRECTION,
  });

const invalidateCastleFlowField = () => {
  isCastleFlowFieldDirty = true;
};

const getCastleFlowField = () => {
  if (!castleFlowField || isCastleFlowFieldDirty) {
    castleFlowField = buildCastleFlowField({
      goals: getCastleEntryGoals(),
      colliders: staticColliders,
      worldBounds: WORLD_BOUNDS,
      resolution: GRID_SIZE,
      corridorHalfWidthCells: CASTLE_ROUTE_HALF_WIDTH_CELLS,
    });
    if (debugViewState.flowField) {
      flowFieldDebugOverlay.upsert(castleFlowField);
    }
    isCastleFlowFieldDirty = false;
  }
  return castleFlowField;
};

const refreshSpawnerPathline = (spawner: WaveSpawner) => {
  const entry = getSpawnerEntryPoint(spawner.position);
  const flow = getCastleFlowField();
  const route = tracePathFromSpawner(flow, { start: entry });
  const displayPoints = toCastleDisplayPoints(route.points);
  const stagingPreviewPoints = [
    getStagingIslandCenter(spawner.position),
    getSpawnerGatePoint(spawner.position),
    getSpawnerBridgeExitPoint(spawner.position),
  ];
  const fullDisplayPoints = [...stagingPreviewPoints, ...displayPoints];
  const corridor = buildPathTilesFromPoints(
    displayPoints,
    staticColliders,
    WORLD_BOUNDS,
    CASTLE_ROUTE_HALF_WIDTH_CELLS
  );
  const connector = buildPathTilesFromPoints(
    [
      getSpawnerBridgeExitPoint(spawner.position),
      getSpawnerEntryPoint(spawner.position),
    ],
    staticColliders,
    WORLD_BOUNDS,
    CASTLE_ROUTE_HALF_WIDTH_CELLS
  );
  // Route validity should follow the width-aware flow field result directly.
  // Tile stamping includes extra square-corner caps for visuals and can reject cells
  // near blockers even when a valid 3-wide centerline route exists.
  const routeState: LanePathResult['state'] = route.state;
  spawner.routeState = routeState;
  spawnerPathlineCache.set(spawner.id, {
    points: displayPoints,
    state: routeState,
  });
  if (routeState === 'reachable') {
    const merged = new Map<string, THREE.Vector3>();
    for (const tile of connector.tiles) {
      merged.set(`${tile.x},${tile.z}`, tile);
    }
    for (const tile of corridor.tiles) {
      merged.set(`${tile.x},${tile.z}`, tile);
    }
    const mergedTiles = Array.from(merged.values());
    pathTilePositions.set(spawner.id, mergedTiles);
  } else {
    pathTilePositions.set(spawner.id, []);
  }
  stagingIslandsOverlay.upsert(
    getSpawnerAnchorId(spawner.position),
    getStagingIslandCenter(spawner.position),
    getSpawnerOutwardNormal(spawner.position),
    spawner.gateOpen,
    spawner.totalCount > 0
  );
  rebuildPathTileLayer();
  spawnerRouteOverlay.upsert(spawner.id, fullDisplayPoints, routeState);
  spawnContainerOverlay.upsert(
    spawner.id,
    getSpawnContainerCorners(spawner.position)
  );
  for (const mob of mobs) {
    if (mob.spawnerId !== spawner.id) continue;
    mob.laneBlocked = routeState !== 'reachable';
    if (mob.staged) {
      mob.waypoints = undefined;
      mob.waypointIndex = undefined;
      mob.laneBlocked = true;
      continue;
    }
    const laneWaypoints =
      routeState === 'reachable'
        ? buildLaneWaypointsForSpawner(spawner, displayPoints)
        : undefined;
    mob.waypoints = laneWaypoints;
    const startsInMap =
      Math.abs(mob.mesh.position.x) <= WORLD_BOUNDS &&
      Math.abs(mob.mesh.position.z) <= WORLD_BOUNDS;
    mob.waypointIndex = laneWaypoints
      ? getForwardWaypointIndex(
          mob.mesh.position,
          laneWaypoints,
          startsInMap ? 2 : 0
        )
      : undefined;
  }
};

const enqueueSpawnerPathRefresh = (spawnerId: string) => {
  if (pendingSpawnerPathRefresh.has(spawnerId)) return;
  pendingSpawnerPathRefresh.add(spawnerId);
  pendingSpawnerPathOrder.push(spawnerId);
};

const processSpawnerPathlineQueue = (
  budget = PATHLINE_REFRESH_BUDGET_PER_FRAME
) => {
  let processed = 0;
  while (processed < budget && pendingSpawnerPathOrder.length > 0) {
    const spawnerId = pendingSpawnerPathOrder.shift()!;
    pendingSpawnerPathRefresh.delete(spawnerId);
    const spawner = spawnerById.get(spawnerId);
    if (!spawner) continue;
    refreshSpawnerPathline(spawner);
    processed += 1;
  }
};

const refreshAllSpawnerPathlines = () => {
  if (isServerAuthoritative()) return;
  for (const spawner of activeWaveSpawners) {
    refreshSpawnerPathline(spawner);
  }
};

const applyObstacleDelta = (
  added: StaticCollider[],
  removed: StaticCollider[] = []
) => {
  if (isServerAuthoritative()) return;
  if (added.length === 0 && removed.length === 0) return;
  if (activeWaveSpawners.length === 0) return;

  const deltas = [...added, ...removed].filter(
    (collider) => collider.type !== 'castle'
  );
  if (deltas.length === 0) return;
  invalidateCastleFlowField();
  for (const spawner of activeWaveSpawners) {
    enqueueSpawnerPathRefresh(spawner.id);
  }
  // Force an immediate reroute on build/destruction so mobs do not keep stale lanes.
  processSpawnerPathlineQueue(Number.MAX_SAFE_INTEGER);
};

const arrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(),
  0.001,
  0x4ad1ff
);
scene.add(arrow);

const selectionArrowGroup = new THREE.Group();
const selectionArrowCameraRightScratch = new THREE.Vector3();
const selectionArrowCameraUpScratch = new THREE.Vector3();
const selectionArrowCameraForwardScratch = new THREE.Vector3();
const selectionArrowBasisMatrixScratch = new THREE.Matrix4();
const arrowShaftLength = 1.0;
const arrowHeadLength = 0.6;
const arrowHeadRadius = 0.5;
const arrowShaftRadius = 0.08;
const shaftGeometry = new THREE.CylinderGeometry(
  arrowShaftRadius,
  arrowShaftRadius,
  arrowShaftLength,
  8
);
const shaftMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
// Cone is rotated 180deg (pointing down)
// In THREE.js ConeGeometry, tip is at y=0, base at y=-height
// After rotation and positioning, tip is at head.position.y
// Shaft should start at tip and extend upward
shaft.position.y = -arrowHeadLength + arrowShaftLength / 2;
selectionArrowGroup.add(shaft);
const headGeometry = new THREE.ConeGeometry(
  arrowHeadRadius,
  arrowHeadLength,
  8
);
const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const head = new THREE.Mesh(headGeometry, headMaterial);
head.rotation.x = Math.PI;
head.position.y = -arrowHeadLength;
selectionArrowGroup.add(head);
selectionArrowGroup.visible = false;
const selectionArrow = selectionArrowGroup;
scene.add(selectionArrow);

const towerRangeMaterial = new THREE.MeshBasicMaterial({
  color: 0x7ad1ff,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
});
const playerShootRangeRing = new THREE.Mesh(
  new THREE.RingGeometry(PLAYER_SHOOT_RANGE - 0.12, PLAYER_SHOOT_RANGE, 64),
  towerRangeMaterial
);
playerShootRangeRing.rotation.x = -Math.PI / 2;
playerShootRangeRing.position.set(0, 0.02, 0);
playerShootRangeRing.visible = debugViewState.playerShootRange;
scene.add(playerShootRangeRing);

const raycaster = new THREE.Raycaster();
raycaster.layers.enable(HITBOX_LAYER);
const pointer = new THREE.Vector2();

const makeCapsule = (color: number) => {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      PLAYER_WIDTH * 0.5,
      PLAYER_HEIGHT - PLAYER_WIDTH,
      4,
      10
    ),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const player: PlayerEntity = {
  mesh: makeCapsule(0x62ff9a),
  radius: PLAYER_COLLISION_RADIUS,
  speed: PLAYER_SPEED,
  velocity: new THREE.Vector3(),
  target: new THREE.Vector3(0, 0, 0),
  kind: 'player',
  baseY: PLAYER_HEIGHT * 0.5,
  username: '',
};
player.mesh.position.set(
  DEFAULT_PLAYER_SPAWN.x,
  player.baseY,
  DEFAULT_PLAYER_SPAWN.z
);
player.target.set(player.mesh.position.x, 0, player.mesh.position.z);
scene.add(player.mesh);

const npcs: NpcEntity[] = [];
const makeNpc = (pos: THREE.Vector3, color: number, username: string) => {
  const npc: NpcEntity = {
    mesh: makeCapsule(color),
    radius: PLAYER_COLLISION_RADIUS,
    speed: NPC_SPEED,
    velocity: new THREE.Vector3(),
    target: pos.clone(),
    kind: 'npc',
    baseY: PLAYER_HEIGHT * 0.5,
    username,
  };
  npc.mesh.position.copy(pos).setY(npc.baseY);
  scene.add(npc.mesh);
  npcs.push(npc);
  return npc;
};

let authoritativeBridge: Awaited<
  ReturnType<typeof connectAuthoritativeBridge>
> | null = null;
let authoritativeInitialDataReady = false;
let authoritativeSelfPlayerId = '';
let lastNetworkHeartbeatAt = 0;
let lastMoveIntentSentAt = 0;
const MOVE_INTENT_MIN_INTERVAL_MS = 100;
const MOVE_INTENT_TARGET_EPSILON = 0.75;
const lastMoveIntentTarget = { x: 0, z: 0 };
const remotePlayersById = new Map<string, NpcEntity>();
const serverStructureById = new Map<string, DestructibleCollider>();
const serverMobsById = new Map<string, MobEntity>();
const serverMobInterpolationById = new Map<
  string,
  {
    from: THREE.Vector3;
    to: THREE.Vector3;
    velocity: THREE.Vector3;
    t0: number;
    t1: number;
  }
>();
const serverMobSampleById = new Map<
  string,
  {
    serverTimeMs: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    receivedAtPerfMs: number;
  }
>();
const serverMobSeenIdsScratch = new Set<string>();
const serverMobRemovalScratch: string[] = [];
const serverMobDeltaPosScratch = new THREE.Vector3();
const serverMobDeltaVelScratch = new THREE.Vector3();
let serverWaveActive = false;
let serverLastAckSeq = 0;
const isServerAuthoritative = () => authoritativeBridge !== null;
const SERVER_MOB_INTERPOLATION_BACKTIME_MS = 150;
const SERVER_MOB_EXTRAPOLATION_MAX_MS = 900;
const SERVER_MOB_DEAD_STALE_REMOVE_MS = 1000;
const SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS = 8000;
const SERVER_MOB_POST_WAVE_STALE_REMOVE_MS = 4000;
const SERVER_MOB_HARD_STALE_REMOVE_MS = 15000;
const SERVER_MOB_FROZEN_REMOVE_MS = SERVER_MOB_EXTRAPOLATION_MAX_MS + 350;
const SERVER_HEARTBEAT_INTERVAL_MS = 200;
let serverClockSkewMs = 0;
let serverClockSkewInitialized = false;
const syncServerClockSkew = (serverEpochMs: number) => {
  const sample = serverEpochMs - Date.now();
  if (!serverClockSkewInitialized) {
    serverClockSkewMs = sample;
    serverClockSkewInitialized = true;
    return;
  }
  serverClockSkewMs = serverClockSkewMs * 0.9 + sample * 0.1;
};
const toPerfTime = (serverEpochMs: number) =>
  performance.now() + (serverEpochMs - (Date.now() + serverClockSkewMs));


const upsertRemoteNpc = (
  playerId: string,
  username: string,
  position: { x: number; z: number }
) => {
  if (playerId === authoritativeSelfPlayerId) return;
  const existing = remotePlayersById.get(playerId);
  if (existing) {
    existing.username = username;
    existing.target.set(position.x, 0, position.z);
    return;
  }
  const npc = makeNpc(
    new THREE.Vector3(position.x, 0, position.z),
    0xffc857,
    username
  );
  remotePlayersById.set(playerId, npc);
};

const removeRemoteNpc = (playerId: string) => {
  const npc = remotePlayersById.get(playerId);
  if (!npc) return;
  scene.remove(npc.mesh);
  const index = npcs.indexOf(npc);
  if (index >= 0) {
    npcs.splice(index, 1);
  }
  remotePlayersById.delete(playerId);
};

const syncServerWaveSpawners = (wave: SharedWaveState) => {
  syncAuthoritativeWaveSpawners({
    wave,
    worldBounds: WORLD_BOUNDS,
    castleRouteHalfWidthCells: CASTLE_ROUTE_HALF_WIDTH_CELLS,
    staticColliders,
    activeWaveSpawners,
    spawnerById,
    spawnerPathlineCache,
    pathTilePositions,
    clearWaveOverlays,
    rebuildPathTileLayer,
    toCastleDisplayPoints,
    getStagingIslandCenter,
    getSpawnerGatePoint,
    getSpawnerBridgeExitPoint,
    getSpawnerEntryPoint,
    getSpawnContainerCorners,
    getSpawnerAnchorId,
    getSpawnerOutwardNormal,
    upsertSpawnerRouteOverlay: (spawnerId, points, routeState) => {
      spawnerRouteOverlay.upsert(spawnerId, points, routeState);
    },
    upsertSpawnContainerOverlay: (spawnerId, corners) => {
      spawnContainerOverlay.upsert(spawnerId, corners);
    },
    upsertStagingIslandsOverlay: (
      anchorId,
      center,
      outwardNormal,
      gateOpen,
      hasMobs
    ) => {
      stagingIslandsOverlay.upsert(
        anchorId,
        center,
        outwardNormal,
        gateOpen,
        hasMobs
      );
    },
  });
};

const syncServerMeta = (
  wave: SharedWaveState,
  world: SharedWorldState['meta']
) => {
  gameState.wave = wave.wave;
  gameState.lives = world.lives;
  gameState.energy = Math.max(0, Math.min(ENERGY_CAP, world.energy));
  serverWaveActive = wave.active;
  gameState.nextWaveAt =
    wave.nextWaveAtMs > 0 ? toPerfTime(wave.nextWaveAtMs) : 0;
  syncServerWaveSpawners(wave);
};

const removeServerStructure = (structureId: string) => {
  const collider = serverStructureById.get(structureId);
  if (!collider) return;
  selectedStructures.delete(collider);
  structureStore.removeStructureCollider(collider);
  serverStructureById.delete(structureId);
};

const upsertServerStructure = (entry: SharedStructureState) => {
  const existingCollider = serverStructureById.get(entry.structureId);
  const targetCenter = new THREE.Vector3(entry.center.x, 0, entry.center.z);
  if (existingCollider) {
    const state = structureStore.structureStates.get(existingCollider);
    if (state) {
      state.hp = entry.hp;
      state.maxHp = entry.maxHp;
      state.mesh.position.set(
        targetCenter.x,
        state.mesh.position.y,
        targetCenter.z
      );
      existingCollider.center.set(
        targetCenter.x,
        existingCollider.center.y,
        targetCenter.z
      );
    }
    return;
  }

  if (entry.type === 'wall') {
    const size = getBuildSizeForMode('wall');
    const half = size.clone().multiplyScalar(0.5);
    const center = snapCenterToBuildGrid(targetCenter, size);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color: 0x8b8b8b })
    );
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (wallModelTemplate) {
      applyWallVisualToMesh(mesh);
    }
    const collider = structureStore.addWallCollider(
      center,
      half,
      mesh,
      entry.maxHp,
      {
        playerBuilt: true,
        createdAtMs: entry.createdAtMs,
        lastDecayTickMs: entry.createdAtMs,
      }
    );
    const state = structureStore.structureStates.get(collider);
    if (state) {
      state.hp = entry.hp;
      state.maxHp = entry.maxHp;
    }
    serverStructureById.set(entry.structureId, collider);
    return;
  }

  if (entry.type === 'tower') {
    const size = getBuildSizeForMode('tower');
    const half = size.clone().multiplyScalar(0.5);
    const center = snapCenterToBuildGrid(targetCenter, size);
    const tower = createTowerAt(center, 'base', entry.ownerId || 'Server');
    const collider = structureStore.addTowerCollider(
      center,
      half,
      tower.mesh,
      tower,
      entry.maxHp,
      {
        playerBuilt: true,
        createdAtMs: entry.createdAtMs,
        lastDecayTickMs: entry.createdAtMs,
      }
    );
    const state = structureStore.structureStates.get(collider);
    if (state) {
      state.hp = entry.hp;
      state.maxHp = entry.maxHp;
    }
    serverStructureById.set(entry.structureId, collider);
    return;
  }

  if (entry.type === 'tree') {
    const treeFootprint = clampTreeFootprint(entry.metadata?.treeFootprint ?? 2);
    const size = getTreeBuildSizeForFootprint(treeFootprint);
    const half = size.clone().multiplyScalar(0.5);
    const center = snapCenterToBuildGrid(targetCenter, size);
    const hitboxMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f8f46,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    hitboxMaterial.colorWrite = false;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      hitboxMaterial
    );
    mesh.position.copy(center);
    mesh.userData.treeFootprint = treeFootprint;
    mesh.layers.set(HITBOX_LAYER);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (treeModelTemplate) {
      applyTreeVisualToMesh(mesh);
    }
    scene.add(mesh);
    const collider = structureStore.addTreeCollider(center, half, mesh, entry.maxHp, {
      playerBuilt: entry.ownerId !== 'Map',
      createdAtMs: entry.createdAtMs,
      lastDecayTickMs: entry.createdAtMs,
    });
    const state = structureStore.structureStates.get(collider);
    if (state) {
      state.hp = entry.hp;
      state.maxHp = entry.maxHp;
    }
    serverStructureById.set(entry.structureId, collider);
    return;
  }

  if (entry.type === 'rock') {
    const rockMeta = entry.metadata?.rock;
    const placement: RockPlacement = {
      x: targetCenter.x,
      z: targetCenter.z,
      footprintX: Math.max(1, rockMeta?.footprintX ?? 1),
      footprintZ: Math.max(1, rockMeta?.footprintZ ?? 1),
      yawQuarterTurns: rockMeta?.yawQuarterTurns ?? 0,
      modelIndex: rockMeta?.modelIndex ?? 0,
      mirrorX: rockMeta?.mirrorX ?? false,
      mirrorZ: rockMeta?.mirrorZ ?? false,
      verticalScale: rockMeta?.verticalScale ?? 1,
    };
    const size = new THREE.Vector3(
      Math.max(1, placement.footprintX),
      ROCK_BASE_HEIGHT,
      Math.max(1, placement.footprintZ)
    );
    const half = size.clone().multiplyScalar(0.5);
    const snapped = snapCenterToBuildGrid(targetCenter, size);
    const colliderCenter = snapped.clone().setY(half.y);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color: 0x646d79 })
    );
    mesh.position.copy(colliderCenter);
    mesh.userData.rockModelIndex = placement.modelIndex;
    mesh.userData.rockYawQuarterTurns = placement.yawQuarterTurns;
    mesh.userData.rockFootprintX = placement.footprintX;
    mesh.userData.rockFootprintZ = placement.footprintZ;
    mesh.userData.rockMirrorX = placement.mirrorX;
    mesh.userData.rockMirrorZ = placement.mirrorZ;
    mesh.userData.rockVerticalScale = placement.verticalScale;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    applyRockVisualToMesh(mesh);
    scene.add(mesh);
    const collider = structureStore.addRockCollider(
      colliderCenter,
      half,
      mesh,
      entry.maxHp,
      {
        playerBuilt: entry.ownerId !== 'Map',
        createdAtMs: entry.createdAtMs,
        lastDecayTickMs: entry.createdAtMs,
      }
    );
    const state = structureStore.structureStates.get(collider);
    if (state) {
      state.hp = entry.hp;
      state.maxHp = entry.maxHp;
    }
    serverStructureById.set(entry.structureId, collider);
    return;
  }
};

const applyServerStructureDelta = (delta: StructureDelta) => {
  for (const structureId of delta.removes) {
    removeServerStructure(structureId);
  }
  for (const structure of delta.upserts) {
    upsertServerStructure(structure);
  }
  if (delta.requiresPathRefresh && !isServerAuthoritative()) {
    refreshAllSpawnerPathlines();
  }
};

const removeServerMobById = (mobId: string) => {
  const mob = serverMobsById.get(mobId);
  const index = mob
    ? mobs.indexOf(mob)
    : mobs.findIndex((entry) => entry.mobId === mobId);
  if (index >= 0) {
    mobs.splice(index, 1);
  }
  serverMobsById.delete(mobId);
  serverMobInterpolationById.delete(mobId);
  serverMobSampleById.delete(mobId);
};

const upsertServerMobFromSnapshot = (mobState: SharedMobState) => {
  const existing = serverMobsById.get(mobState.mobId);
  if (existing) {
    existing.mesh.position.set(
      mobState.position.x,
      existing.baseY,
      mobState.position.z
    );
    existing.target.set(mobState.position.x, 0, mobState.position.z);
    existing.velocity.set(mobState.velocity.x, 0, mobState.velocity.z);
    existing.hp = mobState.hp;
    existing.maxHp = mobState.maxHp;
    return;
  }
  const mesh = new THREE.Mesh(mobLogicGeometry, mobLogicMaterial);
  mesh.position.set(mobState.position.x, MOB_HEIGHT * 0.5, mobState.position.z);
  const mob: MobEntity = {
    mesh,
    radius: MOB_WIDTH * 0.5,
    speed: MOB_SPEED,
    velocity: new THREE.Vector3(mobState.velocity.x, 0, mobState.velocity.z),
    target: new THREE.Vector3(mobState.position.x, 0, mobState.position.z),
    kind: 'mob',
    mobId: mobState.mobId,
    hp: mobState.hp,
    maxHp: mobState.maxHp,
    baseY: MOB_HEIGHT * 0.5,
    staged: false,
    siegeAttackCooldown: 0,
    unreachableTime: 0,
    berserkMode: false,
    berserkTarget: null,
    laneBlocked: false,
  };
  mobs.push(mob);
  serverMobsById.set(mobState.mobId, mob);
};

const applyServerMobUpdate = (
  item: EntityDelta['mobs'][number],
  delta: EntityDelta
) => {
  const existing = serverMobsById.get(item.mobId);
  if (!existing) {
    upsertServerMobFromSnapshot({
      mobId: item.mobId,
      position: item.position,
      velocity: item.velocity,
      hp: item.hp,
      maxHp: item.maxHp,
      spawnerId: '',
      routeIndex: 0,
    });
    serverMobSampleById.set(item.mobId, {
      serverTimeMs: delta.serverTimeMs,
      position: new THREE.Vector3(item.position.x, MOB_HEIGHT * 0.5, item.position.z),
      velocity: new THREE.Vector3(item.velocity.x, 0, item.velocity.z),
      receivedAtPerfMs: performance.now(),
    });
    return;
  }

  existing.hp = item.hp;
  existing.maxHp = item.maxHp;
  const prev = serverMobSampleById.get(item.mobId);
  const currentPos = serverMobDeltaPosScratch.set(
    item.position.x,
    existing.baseY,
    item.position.z
  );
  const currentVel = serverMobDeltaVelScratch.set(item.velocity.x, 0, item.velocity.z);
  const hasPrev =
    !!prev &&
    Number.isFinite(prev.serverTimeMs) &&
    delta.serverTimeMs > prev.serverTimeMs;
  const fromServerMs = hasPrev
    ? prev.serverTimeMs
    : delta.serverTimeMs - Math.max(1, delta.tickMs);
  const toServerMs = delta.serverTimeMs;

  const interpolation = serverMobInterpolationById.get(item.mobId);
  if (interpolation) {
    if (hasPrev && prev) {
      interpolation.from.copy(prev.position);
    } else {
      interpolation.from
        .copy(currentPos)
        .addScaledVector(currentVel, -delta.tickMs / 1000);
    }
    interpolation.to.copy(currentPos);
    interpolation.velocity.copy(currentVel);
    interpolation.t0 = toPerfTime(fromServerMs);
    interpolation.t1 = toPerfTime(toServerMs);
  } else {
    serverMobInterpolationById.set(item.mobId, {
      from:
        hasPrev && prev
          ? prev.position.clone()
          : currentPos.clone().addScaledVector(currentVel, -delta.tickMs / 1000),
      to: currentPos.clone(),
      velocity: currentVel.clone(),
      t0: toPerfTime(fromServerMs),
      t1: toPerfTime(toServerMs),
    });
  }

  const sample = serverMobSampleById.get(item.mobId);
  if (sample) {
    sample.serverTimeMs = delta.serverTimeMs;
    sample.position.copy(currentPos);
    sample.velocity.copy(currentVel);
    sample.receivedAtPerfMs = performance.now();
  } else {
    serverMobSampleById.set(item.mobId, {
      serverTimeMs: delta.serverTimeMs,
      position: currentPos.clone(),
      velocity: currentVel.clone(),
      receivedAtPerfMs: performance.now(),
    });
  }
};

const applyServerMobDelta = (delta: EntityDelta) => {
  syncServerClockSkew(delta.serverTimeMs);
  serverMobSeenIdsScratch.clear();
  for (const item of delta.mobs) {
    if (serverMobSeenIdsScratch.has(item.mobId)) continue;
    serverMobSeenIdsScratch.add(item.mobId);
    applyServerMobUpdate(item, delta);
  }
  // Full list already contains all entities; avoid extra pass over priority buckets.
  if (!delta.fullMobList) {
    const priority = delta.priorityMobs;
    if (priority) {
      for (const item of priority.nearPlayers) {
        if (serverMobSeenIdsScratch.has(item.mobId)) continue;
        serverMobSeenIdsScratch.add(item.mobId);
        applyServerMobUpdate(item, delta);
      }
      for (const item of priority.castleThreats) {
        if (serverMobSeenIdsScratch.has(item.mobId)) continue;
        serverMobSeenIdsScratch.add(item.mobId);
        applyServerMobUpdate(item, delta);
      }
      for (const item of priority.recentlyDamaged) {
        if (serverMobSeenIdsScratch.has(item.mobId)) continue;
        serverMobSeenIdsScratch.add(item.mobId);
        applyServerMobUpdate(item, delta);
      }
    }
  }
  if (delta.fullMobList) {
    serverMobRemovalScratch.length = 0;
    for (const mobId of serverMobsById.keys()) {
      if (serverMobSeenIdsScratch.has(mobId)) continue;
      serverMobRemovalScratch.push(mobId);
    }
    for (const mobId of serverMobRemovalScratch) {
      removeServerMobById(mobId);
    }
  }
  for (const mobId of delta.despawnedMobIds) {
    const mob = serverMobsById.get(mobId);
    if (mob) {
      spawnMobDeathVisual(mob);
    }
    removeServerMobById(mobId);
  }
};

const applyServerWaveDelta = (delta: WaveDelta) => {
  gameState.wave = delta.wave.wave;
  serverWaveActive = delta.wave.active;
  gameState.nextWaveAt =
    delta.wave.nextWaveAtMs > 0 ? toPerfTime(delta.wave.nextWaveAtMs) : 0;
  syncServerWaveSpawners(delta.wave);
};

const applyServerSnapshot = (snapshot: SharedWorldState) => {
  syncServerMeta(snapshot.wave, snapshot.meta);

  const snapshotStructureIds = new Set(Object.keys(snapshot.structures));
  for (const structureId of Array.from(serverStructureById.keys())) {
    if (!snapshotStructureIds.has(structureId)) {
      removeServerStructure(structureId);
    }
  }
  for (const structure of Object.values(snapshot.structures)) {
    upsertServerStructure(structure);
  }

  const snapshotMobIds = new Set(Object.keys(snapshot.mobs));
  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    const mob = mobs[i]!;
    const mobId = mob.mobId;
    if (mobId && snapshotMobIds.has(mobId)) continue;
    mobs.splice(i, 1);
  }
  serverMobsById.clear();
  serverMobInterpolationById.clear();
  serverMobSampleById.clear();
  for (const mob of Object.values(snapshot.mobs)) {
    upsertServerMobFromSnapshot(mob);
    serverMobSampleById.set(mob.mobId, {
      serverTimeMs: snapshot.meta.lastTickMs,
      position: new THREE.Vector3(mob.position.x, MOB_HEIGHT * 0.5, mob.position.z),
      velocity: new THREE.Vector3(mob.velocity.x, 0, mob.velocity.z),
      receivedAtPerfMs: performance.now(),
    });
  }
};

const updateServerMobInterpolation = (now: number) => {
  const staleMobIds: string[] = [];
  for (const [mobId, sample] of serverMobSampleById.entries()) {
    const mob = serverMobsById.get(mobId);
    if (!mob) {
      staleMobIds.push(mobId);
      continue;
    }
    const staleMs = now - sample.receivedAtPerfMs;
    const sampleIsFinite =
      Number.isFinite(sample.position.x) &&
      Number.isFinite(sample.position.z) &&
      Number.isFinite(sample.velocity.x) &&
      Number.isFinite(sample.velocity.z);
    if (!sampleIsFinite) {
      staleMobIds.push(mobId);
      continue;
    }
    // If a mob has not received fresh authoritative samples past the
    // extrapolation horizon, prefer removing it over showing a frozen ghost.
    if (staleMs > SERVER_MOB_FROZEN_REMOVE_MS) {
      staleMobIds.push(mobId);
      continue;
    }
    if (staleMs > SERVER_MOB_HARD_STALE_REMOVE_MS) {
      staleMobIds.push(mobId);
      continue;
    }
    if ((mob.hp ?? 1) <= 0 && staleMs > SERVER_MOB_DEAD_STALE_REMOVE_MS) {
      staleMobIds.push(mobId);
      continue;
    }
    if (serverWaveActive && staleMs > SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS) {
      staleMobIds.push(mobId);
      continue;
    }
    if (!serverWaveActive && staleMs > SERVER_MOB_POST_WAVE_STALE_REMOVE_MS) {
      staleMobIds.push(mobId);
    }
  }
  for (const mobId of staleMobIds) {
    removeServerMobById(mobId);
  }

  const renderNow = now - SERVER_MOB_INTERPOLATION_BACKTIME_MS;
  for (const [mobId, entry] of serverMobInterpolationById.entries()) {
    const mob = serverMobsById.get(mobId);
    if (!mob) continue;
    const duration = Math.max(1, entry.t1 - entry.t0);
    const t = THREE.MathUtils.clamp((renderNow - entry.t0) / duration, 0, 1);
    mob.mesh.position.lerpVectors(entry.from, entry.to, t);
    if (renderNow > entry.t1) {
      const extrapolationMs = Math.min(
        SERVER_MOB_EXTRAPOLATION_MAX_MS,
        renderNow - entry.t1
      );
      if (extrapolationMs > 0) {
        mob.mesh.position.x += entry.velocity.x * (extrapolationMs / 1000);
        mob.mesh.position.z += entry.velocity.z * (extrapolationMs / 1000);
      }
    }
    mob.target.set(entry.to.x, 0, entry.to.z);
    const vx = (entry.to.x - entry.from.x) / (duration / 1000);
    const vz = (entry.to.z - entry.from.z) / (duration / 1000);
    mob.velocity.set(
      Number.isFinite(vx) ? vx : 0,
      0,
      Number.isFinite(vz) ? vz : 0
    );
  }
};

const setupAuthoritativeBridge = async () => {
  if (authoritativeBridge) {
    return;
  }
  try {
    authoritativeBridge = await connectAuthoritativeBridge({
      onSnapshot: (snapshot) => {
        syncServerClockSkew(snapshot.meta.lastTickMs);
        applyServerSnapshot(snapshot);
        authoritativeInitialDataReady = true;
        startGameWhenReady?.();
      },
      onSelfReady: (playerId, username, position) => {
        authoritativeSelfPlayerId = playerId;
        player.username = username;
        player.mesh.position.set(position.x, player.baseY, position.z);
        player.target.set(position.x, 0, position.z);
        lastMoveIntentTarget.x = position.x;
        lastMoveIntentTarget.z = position.z;
      },
      onRemoteJoin: (playerId, username, position) => {
        upsertRemoteNpc(playerId, username, position);
      },
      onRemoteLeave: (playerId) => {
        removeRemoteNpc(playerId);
      },
      onPlayerMove: (playerId, username, next) => {
        if (playerId === authoritativeSelfPlayerId) {
          return;
        }
        upsertRemoteNpc(playerId, username, next);
      },
      onMobDelta: (delta) => {
        applyServerMobDelta(delta);
      },
      onStructureDelta: (delta) => {
        applyServerStructureDelta(delta);
      },
      onWaveDelta: (delta) => {
        applyServerWaveDelta(delta);
      },
      onAck: (_tickSeq, _worldVersion, ackSeq) => {
        serverLastAckSeq = Math.max(serverLastAckSeq, ackSeq);
      },
      onCoinBalance: (coins) => {
        gameState.energy = Math.max(0, Math.min(ENERGY_CAP, coins));
      },
      onResyncRequired: () => {
        if (!authoritativeBridge) return;
        void authoritativeBridge.resync().catch((error) => {
          console.error('Failed to resync authoritative snapshot', error);
        });
      },
    });
    void syncCastleCoinsFromServer();
  } catch (error) {
    console.error('Failed to connect authoritative bridge', error);
    authoritativeInitialDataReady = false;
  } finally {
    startGameWhenReady?.();
  }
};

const selection = createSelectionState();
const selectedStructures = selection.selectedStructures;
let activePointerId: number | null = null;
const syncSelectedStructureOutline = () => {
  const structureSelectedObjects: THREE.Object3D[] = [];
  for (const collider of selectedStructures) {
    if (collider.type === 'bank') {
      structureSelectedObjects.push(castle);
      if (castleBankPiles.children.length > 0) {
        structureSelectedObjects.push(castleBankPiles);
      }
      continue;
    }
    const mesh = structureStore.structureStates.get(collider)?.mesh;
    if (!mesh) continue;
    const outlineTarget = mesh.userData.outlineTarget as
      | THREE.Object3D
      | undefined;
    structureSelectedObjects.push(outlineTarget ?? mesh);
  }
  structureOutlinePass.selectedObjects = structureSelectedObjects;
  treeOutlinePass.selectedObjects = [];
};

const applyTowerUpgrade = (tower: Tower, upgradeId: TowerUpgradeId) => {
  if (upgradeId === 'range') {
    tower.rangeLevel += 1;
    tower.range += 1;
  } else if (upgradeId === 'damage') {
    tower.damageLevel += 1;
    tower.damage += 1;
  } else if (upgradeId === 'speed') {
    tower.speedLevel += 1;
    const shotsPerSecond = 4 + tower.speedLevel * 2;
    tower.shootCadence = 1 / shotsPerSecond;
  }
  tower.rangeRing.geometry.dispose();
  tower.rangeRing.geometry = new THREE.RingGeometry(
    tower.range - 0.12,
    tower.range,
    32
  );
};

const createTowerAt = (
  snapped: THREE.Vector3,
  typeId: TowerTypeId,
  builtBy: string
): Tower => {
  const typeConfig = getTowerType(typeId);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      TOWER_BUILD_SIZE.x,
      TOWER_BUILD_SIZE.y,
      TOWER_BUILD_SIZE.z
    ),
    new THREE.MeshStandardMaterial({
      color: typeConfig.color,
      transparent: true,
      opacity: towerModelTemplate ? 0.01 : 1,
    })
  );
  mesh.position.copy(snapped);
  if (!towerModelTemplate) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  scene.add(mesh);

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(typeConfig.range - 0.12, typeConfig.range, 32),
    towerRangeMaterial
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.set(snapped.x, 0.02, snapped.z);
  rangeRing.visible = false;
  scene.add(rangeRing);

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
    rangeRing,
    typeId,
    level: typeConfig.level,
  };
  if (towerModelTemplate) {
    applyTowerVisualToMesh(mesh, tower);
  }
  towers.push(tower);
  return tower;
};


const gameState = createGameState(ENERGY_CAP);
let isDraggingWall = false;
let wallDragStart: THREE.Vector3 | null = null;
let wallDragEnd: THREE.Vector3 | null = null;
let wallDragValidPositions: THREE.Vector3[] = [];
const inputController = createInputController();
const keyboardForward = new THREE.Vector3();
const keyboardRight = new THREE.Vector3();
const keyboardMoveDir = new THREE.Vector3();
let wasKeyboardMoving = false;
const EVENT_BANNER_DURATION = 2.4;

type EnergyTrail = {
  mesh: THREE.Object3D;
  materials: THREE.Material[];
  startX: number;
  startY: number;
  control1X: number;
  control1Y: number;
  control2X: number;
  control2Y: number;
  endX: number;
  endY: number;
  elapsed: number;
  duration: number;
  reward: number;
  spinStartDeg: number;
  spinTotalDeg: number;
  pitchStartDeg: number;
  pitchTotalDeg: number;
  rollStartDeg: number;
  rollTotalDeg: number;
  baseScale: number;
};

type FloatingDamageText = {
  el: HTMLDivElement;
  target: Entity | null;
  worldPos: THREE.Vector3;
  elapsed: number;
  duration: number;
  driftX: number;
};

type TreeRegrowCandidate = {
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
  dueAtMs: number;
};

type GrowingTree = {
  mesh: THREE.Mesh;
  startedAtMs: number;
};

type MobDeathVisual = {
  root: THREE.Object3D;
  materials: THREE.Material[];
  age: number;
  heading: number;
  fallSign: number;
  startX: number;
  startZ: number;
  startY: number;
  knockbackX: number;
  knockbackZ: number;
};

const getUpgradeEnergyCost = (upgradeId: TowerUpgradeId): number => {
  if (upgradeId === 'range') return ENERGY_COST_UPGRADE_RANGE;
  if (upgradeId === 'damage') return ENERGY_COST_UPGRADE_DAMAGE;
  return ENERGY_COST_UPGRADE_SPEED;
};

const getDeleteEnergyCost = (collider: DestructibleCollider): number => {
  if (collider.type === 'bank') return 0;
  return collider.type === 'tower'
    ? ENERGY_COST_DELETE_TOWER
    : ENERGY_COST_DELETE_WALL;
};

const treeRegrowQueue: TreeRegrowCandidate[] = [];
const growingTrees: GrowingTree[] = [];

const getRepairCost = (state: {
  hp: number;
  maxHp: number;
  cumulativeBuildCost?: number;
}) => {
  if (state.maxHp <= 0 || state.hp >= state.maxHp) return 0;
  const missingRatio = clamp((state.maxHp - state.hp) / state.maxHp, 0, 1);
  const cumulativeBuildCost = Math.max(0, state.cumulativeBuildCost ?? 0);
  return Math.max(
    1,
    Math.ceil(cumulativeBuildCost * REPAIR_DISCOUNT_RATE * missingRatio)
  );
};

const getRepairStatus = (
  hp: number,
  maxHp: number
): 'healthy' | 'needs_repair' | 'critical' => {
  if (maxHp <= 0) return 'healthy';
  const hpRatio = hp / maxHp;
  if (hpRatio <= REPAIR_CRITICAL_HP_RATIO) return 'critical';
  if (hpRatio < REPAIR_WARNING_HP_RATIO) return 'needs_repair';
  return 'healthy';
};

const queueTreeRegrow = (collider: DestructibleCollider) => {
  if (collider.type !== 'tree') return;
  const hasPending = treeRegrowQueue.some(
    (entry) => entry.center.distanceToSquared(collider.center) < 0.001
  );
  if (hasPending) return;
  treeRegrowQueue.push({
    center: collider.center.clone(),
    halfSize: collider.halfSize.clone(),
    dueAtMs: Date.now() + TREE_REGROW_MS,
  });
};

const particleSystem = createParticleSystem(scene);
const spawnCubeEffects = particleSystem.spawnCubeEffects;
const setCoinParticleTemplate = particleSystem.setCoinParticleTemplate;
const updateParticles = particleSystem.updateParticles;

// Health bars and username labels using HTML overlays
const healthBarContainer = document.createElement('div');
healthBarContainer.style.position = 'fixed';
healthBarContainer.style.top = '0';
healthBarContainer.style.left = '0';
healthBarContainer.style.width = '100%';
healthBarContainer.style.height = '100%';
healthBarContainer.style.pointerEvents = 'none';
healthBarContainer.style.zIndex = '999';
app.appendChild(healthBarContainer);

const usernameContainer = document.createElement('div');
usernameContainer.style.position = 'fixed';
usernameContainer.style.top = '0';
usernameContainer.style.left = '0';
usernameContainer.style.width = '100%';
usernameContainer.style.height = '100%';
usernameContainer.style.pointerEvents = 'none';
usernameContainer.style.zIndex = '1001';
app.appendChild(usernameContainer);

const damageTextContainer = document.createElement('div');
damageTextContainer.style.position = 'fixed';
damageTextContainer.style.top = '0';
damageTextContainer.style.left = '0';
damageTextContainer.style.width = '100%';
damageTextContainer.style.height = '100%';
damageTextContainer.style.pointerEvents = 'none';
damageTextContainer.style.zIndex = '1200';
app.appendChild(damageTextContainer);

const activeEnergyTrails: EnergyTrail[] = [];
const activeDamageTexts: FloatingDamageText[] = [];
const activeMobDeathVisuals: MobDeathVisual[] = [];
const CRIT_CHANCE = 1 / 8;
const CRIT_MULTIPLIER = 2;

const clearMobDeathVisuals = () => {
  for (const visual of activeMobDeathVisuals) {
    scene.remove(visual.root);
    for (const material of visual.materials) {
      material.dispose();
    }
  }
  activeMobDeathVisuals.length = 0;
};

const spawnMobDeathVisual = (mob: MobEntity) => {
  if (!mobDeathVisualTemplate) return;
  const deathRoot = new THREE.Group();
  const corpse = mobDeathVisualTemplate.clone(true);
  const corpseBounds = new THREE.Box3().setFromObject(corpse);
  if (!corpseBounds.isEmpty()) {
    // Force the local pivot to the model's bottom, so tipping hinges at ground contact.
    corpse.position.y -= corpseBounds.min.y;
  }
  deathRoot.add(corpse);
  deathRoot.position.copy(mob.mesh.position);
  const DEATH_VISUAL_LIFT_Y = 0.3;
  deathRoot.position.y += mobInstanceGroundOffsetY + DEATH_VISUAL_LIFT_Y;
  const startX = deathRoot.position.x;
  const startZ = deathRoot.position.z;
  const startY = deathRoot.position.y;
  const headingSpeedSq =
    mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z;
  let heading =
    headingSpeedSq > 1e-6
      ? Math.atan2(mob.velocity.x, mob.velocity.z) + mobInstanceHeadingOffset
      : mobInstanceHeadingOffset;
  const fallSignFallback =
    ((mob.mesh.id * 2654435761) >>> 0) % 2 === 0 ? 1 : -1;
  let fallSign = fallSignFallback;
  let knockbackX = 0;
  let knockbackZ = 0;
  if (mob.lastHitDirection) {
    const hitDirX = mob.lastHitDirection.x;
    const hitDirZ = mob.lastHitDirection.z;
    const hitLenSq = hitDirX * hitDirX + hitDirZ * hitDirZ;
    if (hitLenSq > 1e-8) {
      const hitLenInv = 1 / Math.sqrt(hitLenSq);
      const normalizedHitDirX = hitDirX * hitLenInv;
      const normalizedHitDirZ = hitDirZ * hitLenInv;
      // Align yaw so local +Z faces the hit direction, then tip front/back.
      heading =
        Math.atan2(normalizedHitDirX, normalizedHitDirZ) +
        mobInstanceHeadingOffset;
      // Rig pitch orientation is mirrored; this sign tips along local +Z.
      fallSign = -1;
      const DEATH_KNOCKBACK_DISTANCE = 2.6;
      knockbackX = normalizedHitDirX * DEATH_KNOCKBACK_DISTANCE;
      knockbackZ = normalizedHitDirZ * DEATH_KNOCKBACK_DISTANCE;
    }
  }
  deathRoot.rotation.y = heading;

  const deathMaterials: THREE.Material[] = [];
  corpse.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const clonedMaterial = Array.isArray(node.material)
      ? node.material.map((material) => material.clone())
      : node.material.clone();
    const asArray = Array.isArray(clonedMaterial)
      ? clonedMaterial
      : [clonedMaterial];
    for (const material of asArray) {
      material.transparent = true;
      material.opacity = 1;
      material.depthWrite = false;
      const tintableMaterial = material as THREE.Material & {
        color?: THREE.Color;
      };
      if (tintableMaterial.color) {
        tintableMaterial.userData.deathFlashBaseColorHex =
          tintableMaterial.color.getHex();
      }
      deathMaterials.push(material);
    }
    node.material = clonedMaterial;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  scene.add(deathRoot);

  activeMobDeathVisuals.push({
    root: deathRoot,
    materials: deathMaterials,
    age: 0,
    heading,
    fallSign,
    startX,
    startZ,
    startY,
    knockbackX,
    knockbackZ,
  });
};

const updateMobDeathVisuals = (delta: number) => {
  const FALL_DURATION = 0.5;
  const HOLD_DURATION = 1.15;
  const FADE_DURATION = 1.0;
  const HIT_FLASH_HOLD_DURATION = 0.32;
  const HIT_FLASH_LERP_OUT_DURATION = 0.2;
  const KNOCKBACK_DURATION = 0.38;
  const TOTAL_DURATION = FALL_DURATION + HOLD_DURATION + FADE_DURATION;
  const MAX_FALL_ANGLE = Math.PI * 0.56;
  const SINK_DISTANCE = 0.85;
  const MIN_DEATH_Y = -2;
  for (let i = activeMobDeathVisuals.length - 1; i >= 0; i -= 1) {
    const visual = activeMobDeathVisuals[i]!;
    visual.age += delta;
    const clampedFallT = clamp(visual.age / FALL_DURATION, 0, 1);
    const easedFall = 1 - (1 - clampedFallT) * (1 - clampedFallT);
    const knockbackT = clamp(visual.age / KNOCKBACK_DURATION, 0, 1);
    const knockbackEase =
      1 - (1 - knockbackT) * (1 - knockbackT) * (1 - knockbackT);
    visual.root.position.x = visual.startX + visual.knockbackX * knockbackEase;
    visual.root.position.z = visual.startZ + visual.knockbackZ * knockbackEase;
    visual.root.rotation.set(0, visual.heading, 0);
    visual.root.rotateX(visual.fallSign * MAX_FALL_ANGLE * easedFall);
    const hitFlashStrength =
      visual.age <= HIT_FLASH_HOLD_DURATION
        ? 1
        : clamp(
            1 -
              (visual.age - HIT_FLASH_HOLD_DURATION) /
                HIT_FLASH_LERP_OUT_DURATION,
            0,
            1
          );
    const fadeStart = FALL_DURATION + HOLD_DURATION;
    const fadeT = clamp((visual.age - fadeStart) / FADE_DURATION, 0, 1);
    const sinkEase = 1 - (1 - fadeT) * (1 - fadeT);
    visual.root.position.y = Math.max(
      visual.startY - SINK_DISTANCE * sinkEase,
      MIN_DEATH_Y
    );
    const opacity = 1 - fadeT;
    for (const material of visual.materials) {
      const tintableMaterial = material as THREE.Material & {
        color?: THREE.Color;
      };
      if (tintableMaterial.color) {
        const baseColorHex = tintableMaterial.userData
          .deathFlashBaseColorHex as number | undefined;
        if (baseColorHex !== undefined) {
          TEMP_BASE_COLOR.setHex(baseColorHex);
          tintableMaterial.color
            .copy(TEMP_BASE_COLOR)
            .lerp(DEATH_FLASH_TINT, hitFlashStrength);
        }
      }
      material.opacity = opacity;
    }
    if (visual.age >= TOTAL_DURATION) {
      scene.remove(visual.root);
      for (const material of visual.materials) {
        material.dispose();
      }
      activeMobDeathVisuals.splice(i, 1);
    }
  }
};

const updateCoinHudView = (delta: number) => {
  const rect = coinHudCanvasEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  coinHudRenderer.setSize(width, height, false);
  coinHudCamera.aspect = width / height;
  coinHudCamera.updateProjectionMatrix();
  if (coinHudRoot.children.length > 0) {
    const spinSpeed = 1.75;
    coinHudRoot.rotation.y += delta * spinSpeed;
  }
  coinHudRenderer.render(coinHudScene, coinHudCamera);
};

const syncCoinTrailViewport = () => {
  coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false);
  coinTrailCamera.left = 0;
  coinTrailCamera.right = window.innerWidth;
  coinTrailCamera.top = window.innerHeight;
  coinTrailCamera.bottom = 0;
  coinTrailCamera.updateProjectionMatrix();
};

const syncMinimapCanvasSize = () => {
  const rect = minimapCanvasEl.getBoundingClientRect();
  const pixelRatioCap =
    isMinimapExpanded || minimapEmbellishAlpha > 0.02 ? 3.5 : 2;
  const pixelRatio = Math.max(
    1,
    Math.min(window.devicePixelRatio, pixelRatioCap)
  );
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (minimapCanvasEl.width !== width || minimapCanvasEl.height !== height) {
    minimapCanvasEl.width = width;
    minimapCanvasEl.height = height;
  }
};

const drawMinimap = () => {
  if (!minimapCtx) return;
  const width = minimapCanvasEl.width;
  const height = minimapCanvasEl.height;
  if (width <= 0 || height <= 0) return;
  const minDimension = Math.min(width, height);
  const baseMarkerScale = Math.max(1, minDimension / 84);
  const markerScale = isMinimapExpanded
    ? baseMarkerScale * 0.5
    : baseMarkerScale;

  minimapCtx.clearRect(0, 0, width, height);
  minimapCtx.fillStyle = 'rgba(224, 202, 156, 0.96)';
  minimapCtx.fillRect(0, 0, width, height);

  // Keep minimap orientation aligned with the camera view.
  const forward3 = camera.getWorldDirection(new THREE.Vector3());
  const forward2 = new THREE.Vector2(forward3.x, forward3.z);
  if (forward2.lengthSq() <= 1e-5) {
    forward2.set(0, -1);
  } else {
    forward2.normalize();
  }
  const right2 = new THREE.Vector2(-forward2.y, forward2.x);
  const axisExtent = WORLD_BOUNDS * Math.SQRT2;

  const worldToMap = (x: number, z: number) => {
    const rx = (x * right2.x + z * right2.y) / axisExtent;
    const ry = (x * forward2.x + z * forward2.y) / axisExtent;
    return {
      x: clamp((rx + 1) * 0.5, 0, 1) * width,
      y: clamp(1 - (ry + 1) * 0.5, 0, 1) * height,
    };
  };

  const center = worldToMap(0, 0);
  const castleIconSize = Math.max(10, 10 * markerScale);
  if (minimapCastleIcon.complete && minimapCastleIcon.naturalWidth > 0) {
    minimapCtx.drawImage(
      minimapCastleIcon,
      center.x - castleIconSize * 0.5,
      center.y - castleIconSize * 0.5,
      castleIconSize,
      castleIconSize
    );
  } else {
    // Fallback marker before the icon asset has loaded.
    minimapCtx.fillStyle = '#f0d066';
    minimapCtx.fillRect(
      center.x - castleIconSize * 0.35,
      center.y - castleIconSize * 0.35,
      castleIconSize * 0.7,
      castleIconSize * 0.7
    );
  }

  const playerPoint = worldToMap(
    player.mesh.position.x,
    player.mesh.position.z
  );
  minimapCtx.fillStyle = '#62ff9a';
  minimapCtx.beginPath();
  minimapCtx.arc(
    playerPoint.x,
    playerPoint.y,
    Math.max(2.6, 2.6 * markerScale),
    0,
    Math.PI * 2
  );
  minimapCtx.fill();

  minimapCtx.fillStyle = '#ff6a6a';
  for (const mob of mobs) {
    const point = worldToMap(mob.mesh.position.x, mob.mesh.position.z);
    minimapCtx.beginPath();
    minimapCtx.arc(
      point.x,
      point.y,
      Math.max(1.8, 1.8 * markerScale),
      0,
      Math.PI * 2
    );
    minimapCtx.fill();
  }

  for (const [collider, state] of structureStore.structureStates.entries()) {
    if (collider.type !== 'wall' && collider.type !== 'tower') continue;
    if (state.playerBuilt !== true) continue;
    const hpRatio = state.maxHp <= 0 ? 1 : state.hp / state.maxHp;
    if (hpRatio >= REPAIR_WARNING_HP_RATIO) continue;
    const point = worldToMap(collider.center.x, collider.center.z);
    minimapCtx.fillStyle =
      hpRatio <= REPAIR_CRITICAL_HP_RATIO ? '#ff6a6a' : '#ffcf73';
    minimapCtx.beginPath();
    minimapCtx.arc(
      point.x,
      point.y,
      Math.max(1.4, 1.4 * markerScale),
      0,
      Math.PI * 2
    );
    minimapCtx.fill();
  }
};

const worldToScreen = (
  worldPos: THREE.Vector3
): { x: number; y: number } | null => {
  const vector = worldPos.clone();
  vector.project(camera);
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
  return { x, y };
};

const updateViewportFogCenter = () => {
  const anchor = worldToScreen(player.mesh.position.clone().setY(player.baseY));
  if (!anchor) return;
  const xPct = Math.max(0, Math.min(100, (anchor.x / window.innerWidth) * 100));
  const yPct = Math.max(
    0,
    Math.min(100, (anchor.y / window.innerHeight) * 100)
  );
  viewportFogEl.style.setProperty('--fog-center-x', `${xPct}%`);
  viewportFogEl.style.setProperty('--fog-center-y', `${yPct}%`);
};

const addEnergy = (amount: number, withPop = false) => {
  if (isServerAuthoritative()) return;
  gameState.energy = Math.min(ENERGY_CAP, gameState.energy + amount);
  if (withPop) {
    gameState.energyPopTimer = 0.2;
  }
};

const spendEnergy = (amount: number) => {
  if (isServerAuthoritative()) return false;
  if (gameState.energy < amount) return false;
  gameState.energy = Math.max(0, gameState.energy - amount);
  return true;
};

const getSelectedBankInRange = () => {
  const [collider] = selectedStructures.values();
  if (!collider || collider.type !== 'bank') return null;
  if (!isColliderInRange(collider, SELECTION_RADIUS)) return null;
  return collider;
};

const disposeObjectMeshes = (object: THREE.Object3D) => {
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    if (Array.isArray(node.material)) {
      for (const material of node.material) material.dispose();
      return;
    }
    node.material.dispose();
  });
};

const getCoinPileCylinderCount = (bankEnergy: number) => {
  const safeBank = Math.max(0, bankEnergy);
  const growthLevel = Math.max(0, Math.floor(Math.log2(safeBank + 1)));
  return Math.min(COIN_PILE_CYLINDER_MAX, COIN_PILE_CYLINDER_MIN + growthLevel);
};

const getCoinPileClusterCountPerCorner = (bankEnergy: number) => {
  const safeBank = Math.max(0, bankEnergy);
  const growthLevel = Math.max(0, Math.floor(Math.log2(safeBank + 1)));
  return Math.min(
    COIN_PILE_CLUSTER_MAX_PER_CORNER,
    1 + Math.floor(growthLevel / 4)
  );
};

const getCoinPileHeightScale = (bankEnergy: number) => {
  const safeBank = Math.max(1, bankEnergy);
  return Math.min(2.6, 1 + Math.log10(safeBank) * 0.28);
};

const buildCoinPileVisual = (
  bankEnergy: number,
  densityScale = 1,
  spreadScale = 1,
  phaseOffset = 0,
  heightScale = 1
) => {
  const group = new THREE.Group();
  const safeBank = Math.max(0, bankEnergy);
  const baseCount = getCoinPileCylinderCount(safeBank);
  const cylinderCount = Math.max(1, Math.floor(baseCount * densityScale));
  const growthLevel = Math.max(0, Math.floor(Math.log2(safeBank + 1)));
  for (let i = 0; i < cylinderCount; i += 1) {
    const t = (i + 0.5) / cylinderCount;
    const radiusFromCenter = Math.sqrt(t) * COIN_PILE_MAX_RADIUS * spreadScale;
    const angle = (i + phaseOffset) * 2.399963229728653;
    const height = Math.min(
      5.5,
      (0.35 + growthLevel * 0.06 + (i % 5) * 0.08) * heightScale
    );
    const topRadius = 0.12 + ((i * 17) % 5) * 0.012;
    const bottomRadius = topRadius + 0.05;
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(topRadius, bottomRadius, height, 10),
      new THREE.MeshStandardMaterial({
        color: i % 3 === 0 ? 0xf4d35e : i % 3 === 1 ? 0xe8c547 : 0xffda66,
        metalness: 0.3,
        roughness: 0.35,
      })
    );
    cylinder.position.set(
      Math.cos(angle) * radiusFromCenter,
      height * 0.5,
      Math.sin(angle) * radiusFromCenter
    );
    cylinder.castShadow = true;
    cylinder.receiveShadow = true;
    group.add(cylinder);
  }
  return group;
};

const updateCastleBankPilesVisual = () => {
  for (const child of Array.from(castleBankPiles.children)) {
    castleBankPiles.remove(child);
    disposeObjectMeshes(child);
  }
  if (gameState.bankEnergy <= 0) return;
  const cx = castleCollider.center.x;
  const cz = castleCollider.center.z;
  const offsetX = castleCollider.halfSize.x + 0.28;
  const offsetZ = castleCollider.halfSize.z + 0.28;
  const corners = [
    new THREE.Vector3(cx + offsetX, 0, cz + offsetZ),
    new THREE.Vector3(cx + offsetX, 0, cz - offsetZ),
    new THREE.Vector3(cx - offsetX, 0, cz + offsetZ),
    new THREE.Vector3(cx - offsetX, 0, cz - offsetZ),
  ];
  const safeBank = Math.max(0, gameState.bankEnergy);
  const clustersPerCorner = getCoinPileClusterCountPerCorner(safeBank);
  const totalClusters = Math.max(1, corners.length * clustersPerCorner);
  const perClusterEnergy = safeBank / totalClusters;
  const heightScale = getCoinPileHeightScale(safeBank);
  for (let i = 0; i < corners.length; i += 1) {
    const corner = corners[i]!;
    for (let clusterIdx = 0; clusterIdx < clustersPerCorner; clusterIdx += 1) {
      const pile = buildCoinPileVisual(
        perClusterEnergy,
        0.78,
        0.34,
        i * 29 + clusterIdx * 7,
        heightScale
      );
      if (clusterIdx === 0) {
        pile.position.copy(corner);
      } else {
        const ringLayer = Math.floor((clusterIdx - 1) / 6);
        const ringIndex = (clusterIdx - 1) % 6;
        const ringRadius = 0.22 + ringLayer * 0.16;
        const angle = (Math.PI * 2 * ringIndex) / 6 + i * 0.31;
        pile.position.set(
          corner.x + Math.cos(angle) * ringRadius,
          0,
          corner.z + Math.sin(angle) * ringRadius
        );
      }
      castleBankPiles.add(pile);
    }
  }
};

const syncCastleCoinsFromServer = async () => {
  const castleCoins = await fetchCastleCoinsBalance();
  if (castleCoins === null) return;
  gameState.bankEnergy = castleCoins;
  updateCastleBankPilesVisual();
};

const depositToCastle = async (requestedAmount: number) => {
  const authoritative = isServerAuthoritative();
  const transfer = authoritative
    ? Math.max(0, Math.floor(requestedAmount))
    : Math.min(
        Math.max(0, Math.floor(requestedAmount)),
        Math.max(0, Math.floor(gameState.energy))
      );
  if (transfer <= 0) return false;
  if (!authoritative) {
    const previousBank = gameState.bankEnergy;
    const previousEnergy = gameState.energy;
    gameState.bankEnergy += transfer;
    gameState.energy = Math.max(0, gameState.energy - transfer);
    updateCastleBankPilesVisual();
    const response = await requestCastleCoinsDeposit(transfer);
    if (response === null) {
      gameState.bankEnergy = previousBank;
      gameState.energy = previousEnergy;
      updateCastleBankPilesVisual();
      triggerEventBanner('Deposit failed');
      return false;
    }
    gameState.bankEnergy = Number.isFinite(response.castleCoins)
      ? Math.max(0, Math.floor(response.castleCoins))
      : gameState.bankEnergy;
    updateCastleBankPilesVisual();
    triggerEventBanner(`Deposited ${Math.floor(transfer)} coins`);
    return true;
  }
  const response = await requestCastleCoinsDeposit(transfer);
  if (response === null) {
    triggerEventBanner('Deposit failed');
    return false;
  }
  gameState.bankEnergy = Number.isFinite(response.castleCoins)
    ? Math.max(0, Math.floor(response.castleCoins))
    : gameState.bankEnergy;
  updateCastleBankPilesVisual();
  void authoritativeBridge?.heartbeat({
    x: player.mesh.position.x,
    z: player.mesh.position.z,
  });
  triggerEventBanner(`Deposited ${Math.floor(response.deposited)} coins`);
  return true;
};

const withdrawFromCastle = async (requestedAmount: number) => {
  const authoritative = isServerAuthoritative();
  const missing = Math.max(0, ENERGY_CAP - gameState.energy);
  const transfer = Math.min(
    Math.max(0, Math.floor(requestedAmount)),
    Math.max(0, Math.floor(gameState.bankEnergy)),
    authoritative ? Number.POSITIVE_INFINITY : missing
  );
  if (transfer <= 0) return false;
  if (!authoritative) {
    const previousBank = gameState.bankEnergy;
    const previousEnergy = gameState.energy;
    gameState.bankEnergy = Math.max(0, gameState.bankEnergy - transfer);
    addEnergy(transfer, true);
    updateCastleBankPilesVisual();
    const response = await requestCastleCoinsWithdraw(transfer);
    if (response === null) {
      gameState.bankEnergy = previousBank;
      gameState.energy = previousEnergy;
      updateCastleBankPilesVisual();
      triggerEventBanner('Withdraw failed');
      return false;
    }
    gameState.bankEnergy = Number.isFinite(response.castleCoins)
      ? Math.max(0, Math.floor(response.castleCoins))
      : gameState.bankEnergy;
    updateCastleBankPilesVisual();
    triggerEventBanner(`Withdrew ${Math.floor(response.withdrawn)} coins`);
    return true;
  }
  const response = await requestCastleCoinsWithdraw(transfer);
  if (response === null) {
    triggerEventBanner('Withdraw failed');
    return false;
  }
  gameState.bankEnergy = Number.isFinite(response.castleCoins)
    ? Math.max(0, Math.floor(response.castleCoins))
    : gameState.bankEnergy;
  updateCastleBankPilesVisual();
  void authoritativeBridge?.heartbeat({
    x: player.mesh.position.x,
    z: player.mesh.position.z,
  });
  triggerEventBanner(`Withdrew ${Math.floor(response.withdrawn)} coins`);
  return true;
};

const updateEnergyTrails = (delta: number) => {
  for (let i = activeEnergyTrails.length - 1; i >= 0; i -= 1) {
    const trail = activeEnergyTrails[i]!;
    trail.elapsed += delta;
    const t = Math.min(1, trail.elapsed / trail.duration);
    const easeT = 1 - Math.pow(1 - t, 2);
    const u = 1 - easeT;
    const x =
      u * u * u * trail.startX +
      3 * u * u * easeT * trail.control1X +
      3 * u * easeT * easeT * trail.control2X +
      easeT * easeT * easeT * trail.endX;
    const y =
      u * u * u * trail.startY +
      3 * u * u * easeT * trail.control1Y +
      3 * u * easeT * easeT * trail.control2Y +
      easeT * easeT * easeT * trail.endY;
    const rotation = trail.spinStartDeg + trail.spinTotalDeg * easeT;
    const pitch = trail.pitchStartDeg + trail.pitchTotalDeg * easeT;
    const roll = trail.rollStartDeg + trail.rollTotalDeg * easeT;
    const scale = trail.baseScale * (1 - t * 0.05);
    trail.mesh.position.set(x, window.innerHeight - y, 0);
    trail.mesh.rotation.set(
      THREE.MathUtils.degToRad(pitch),
      THREE.MathUtils.degToRad(rotation),
      THREE.MathUtils.degToRad(roll)
    );
    trail.mesh.scale.setScalar(scale);
    for (const material of trail.materials) {
      if ('opacity' in material) {
        (material as THREE.Material & { opacity: number }).opacity = 1;
      }
    }
    if (t >= 1) {
      coinTrailScene.remove(trail.mesh);
      for (const material of trail.materials) {
        material.dispose();
      }
      activeEnergyTrails.splice(i, 1);
      addEnergy(trail.reward, true);
    }
  }
};

const towerArrowGravity = new THREE.Vector3(0, -BALLISTA_ARROW_GRAVITY, 0);
const towerLaunchPosScratch = new THREE.Vector3();
const towerLaunchQuatScratch = new THREE.Quaternion();
const towerTargetPosScratch = new THREE.Vector3();
const towerAimPointScratch = new THREE.Vector3();
const playerLaunchPosScratch = new THREE.Vector3();
const playerTargetPosScratch = new THREE.Vector3();
const projectilePrevPosScratch = new THREE.Vector3();
const projectileStepScratch = new THREE.Vector3();
const projectileClosestPointScratch = new THREE.Vector3();
const projectileDeltaScratch = new THREE.Vector3();
const projectileMobCenterScratch = new THREE.Vector3();
const projectileHitPointScratch = new THREE.Vector3();
const projectileHitDirectionScratch = new THREE.Vector3();
const projectileMidpointScratch = new THREE.Vector3();
const projectileBroadphaseCandidatesScratch: Entity[] = [];
const frameStageSamples: Array<{
  totalMs: number;
  spatialMs: number;
  targetingMs: number;
  projectileMs: number;
  renderMs: number;
}> = [];
let nextFrameProfileLogAtMs = 0;
let tickFrameCounter = 0;
let cachedSelectedMob: Entity | null = null;
const cachedTowerTargets = new WeakMap<Tower, Entity | null>();
const trackedDynamicEntities = new Set<Entity>();
const MOB_HIT_FLASH_MS = 120;
const arrowFacingDirectionScratch = new THREE.Vector3();
const arrowOrientSourceAxisScratch = new THREE.Vector3();
const arrowDesiredFacingQuaternionScratch = new THREE.Quaternion();
const arrowOffsetWorldScratch = new THREE.Vector3();

const orientArrowToVelocity = (
  object: THREE.Object3D,
  velocity: THREE.Vector3
) => {
  if (velocity.lengthSq() < 1e-8) return;
  arrowFacingDirectionScratch.copy(velocity).normalize();
  // Runtime logs show authored Facing +Y is opposite travel; invert basis once here.
  arrowOrientSourceAxisScratch.copy(arrowFacingForwardLocal).multiplyScalar(-1);
  arrowDesiredFacingQuaternionScratch.setFromUnitVectors(
    arrowOrientSourceAxisScratch,
    arrowFacingDirectionScratch
  );
  object.quaternion.copy(arrowDesiredFacingQuaternionScratch);
};

const placeArrowMeshAtFacing = (
  object: THREE.Object3D,
  facingPosition: THREE.Vector3
) => {
  arrowOffsetWorldScratch
    .copy(arrowFacingAnchorLocalPos)
    .applyQuaternion(object.quaternion);
  object.position.copy(facingPosition).sub(arrowOffsetWorldScratch);
};

const setMobLastHitDirection = (
  mob: MobEntity,
  primaryDirection: THREE.Vector3,
  fallbackDirection?: THREE.Vector3
) => {
  projectileHitDirectionScratch.set(primaryDirection.x, 0, primaryDirection.z);
  if (projectileHitDirectionScratch.lengthSq() <= 1e-8 && fallbackDirection) {
    projectileHitDirectionScratch.set(
      fallbackDirection.x,
      0,
      fallbackDirection.z
    );
  }
  if (projectileHitDirectionScratch.lengthSq() <= 1e-8) return;
  mob.lastHitDirection = projectileHitDirectionScratch.normalize().clone();
};

const markMobHitFlash = (mob: MobEntity) => {
  mob.hitFlashUntilMs = performance.now() + MOB_HIT_FLASH_MS;
};

const solveBallisticIntercept = (
  start: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  speed: number,
  gravity: THREE.Vector3,
  gravityDelay: number,
  maxTime: number
) => {
  const gravityDisplacementAt = (time: number) => {
    const activeGravityTime = Math.max(0, time - gravityDelay);
    return 0.5 * activeGravityTime * activeGravityTime;
  };
  const evaluate = (time: number) => {
    towerAimPointScratch
      .copy(targetPos)
      .addScaledVector(targetVelocity, time)
      .sub(start)
      .addScaledVector(gravity, -gravityDisplacementAt(time));
    return towerAimPointScratch.lengthSq() - speed * speed * time * time;
  };

  const minTime = 0.06;
  const step = 0.04;
  let prevTime = minTime;
  let prevValue = evaluate(prevTime);
  if (Math.abs(prevValue) < 1e-3) {
    const hitTime = prevTime;
    const interceptPoint = targetPos
      .clone()
      .addScaledVector(targetVelocity, hitTime);
    const velocity = interceptPoint
      .clone()
      .sub(start)
      .addScaledVector(gravity, -gravityDisplacementAt(hitTime))
      .divideScalar(hitTime);
    return { hitTime, interceptPoint, velocity };
  }

  for (let t = minTime + step; t <= maxTime; t += step) {
    const value = evaluate(t);
    if (prevValue === 0 || value === 0 || prevValue * value < 0) {
      let lo = prevTime;
      let hi = t;
      let loValue = prevValue;
      for (let i = 0; i < 16; i += 1) {
        const mid = (lo + hi) * 0.5;
        const midValue = evaluate(mid);
        if (Math.abs(midValue) < 1e-4) {
          lo = mid;
          hi = mid;
          break;
        }
        if (loValue * midValue <= 0) {
          hi = mid;
        } else {
          lo = mid;
          loValue = midValue;
        }
      }
      const hitTime = (lo + hi) * 0.5;
      const interceptPoint = targetPos
        .clone()
        .addScaledVector(targetVelocity, hitTime);
      const velocity = interceptPoint
        .clone()
        .sub(start)
        .addScaledVector(gravity, -gravityDisplacementAt(hitTime))
        .divideScalar(hitTime);
      return { hitTime, interceptPoint, velocity };
    }
    prevTime = t;
    prevValue = value;
  }
  return null;
};

const computeFallbackBallisticVelocity = (
  start: THREE.Vector3,
  targetPos: THREE.Vector3,
  gravity: THREE.Vector3,
  gravityDelay: number,
  speed: number,
  maxTime: number
) => {
  const travelTime = THREE.MathUtils.clamp(
    start.distanceTo(targetPos) / Math.max(speed, 0.001),
    0.08,
    maxTime
  );
  const activeGravityTime = Math.max(0, travelTime - gravityDelay);
  const gravityDisplacement = 0.5 * activeGravityTime * activeGravityTime;
  return targetPos
    .clone()
    .sub(start)
    .addScaledVector(gravity, -gravityDisplacement)
    .divideScalar(travelTime);
};

const rollAttackDamage = (baseDamage: number) => {
  const isCrit = Math.random() < CRIT_CHANCE;
  return {
    damage: isCrit ? baseDamage * CRIT_MULTIPLIER : baseDamage,
    isCrit,
  };
};

const spawnFloatingDamageText = (
  mob: Entity,
  damage: number,
  source: 'player' | 'tower',
  isCrit = false
) => {
  if (damage <= 0) return;
  const text = document.createElement('div');
  const classes = ['floating-damage-text'];
  if (source === 'player') {
    classes.push('floating-damage-text--player');
  } else {
    classes.push('floating-damage-text--tower');
  }
  if (isCrit) classes.push('floating-damage-text--crit');
  text.className = classes.join(' ');
  text.textContent = `${Math.round(damage)}${isCrit ? '!' : ''}`;
  damageTextContainer.appendChild(text);
  activeDamageTexts.push({
    el: text,
    target: mob,
    worldPos: mob.mesh.position.clone().setY(mob.baseY + 1.1),
    elapsed: 0,
    duration: 0.65,
    driftX: (Math.random() - 0.5) * 20,
  });
};

const updateFloatingDamageTexts = (delta: number) => {
  for (let i = activeDamageTexts.length - 1; i >= 0; i -= 1) {
    const text = activeDamageTexts[i]!;
    text.elapsed += delta;
    const t = Math.min(1, text.elapsed / text.duration);
    const easeOut = 1 - Math.pow(1 - t, 2);

    if (text.target !== null) {
      text.worldPos
        .copy(text.target.mesh.position)
        .setY(text.target.baseY + 1.1);
    }

    const liftedWorldPos = text.worldPos
      .clone()
      .setY(text.worldPos.y + easeOut * 0.55);
    const screenPos = worldToScreen(liftedWorldPos);
    if (screenPos) {
      const swayX = Math.sin(t * Math.PI) * text.driftX;
      text.el.style.left = `${screenPos.x + swayX}px`;
      text.el.style.top = `${screenPos.y}px`;
      text.el.style.opacity = String(1 - t);
      text.el.style.transform = `translate(-50%, -100%) scale(${1 + (1 - t) * 0.2})`;
    }

    if (t >= 1) {
      text.el.remove();
      activeDamageTexts.splice(i, 1);
    }
  }
};

const updateHealthBars = () => {
  // Clear existing health bars
  healthBarContainer.innerHTML = '';
  for (const [collider, state] of structureStore.structureStates.entries()) {
    if (collider.type !== 'wall' && collider.type !== 'tower') continue;
    if (state.maxHp <= 0 || state.hp >= state.maxHp) continue;
    const barAnchor = new THREE.Vector3(
      collider.center.x,
      collider.center.y + collider.halfSize.y + 0.55,
      collider.center.z
    );
    const screenPos = worldToScreen(barAnchor);
    if (!screenPos) continue;

    const hpRatio = Math.max(0, Math.min(1, state.hp / state.maxHp));
    const shell = document.createElement('div');
    shell.style.position = 'absolute';
    shell.style.left = `${screenPos.x}px`;
    shell.style.top = `${screenPos.y}px`;
    shell.style.transform = 'translate(-50%, -100%)';
    shell.style.width = '42px';
    shell.style.height = '6px';
    shell.style.border = '1px solid rgba(255,255,255,0.85)';
    shell.style.borderRadius = '999px';
    shell.style.background = 'rgba(0,0,0,0.55)';
    shell.style.overflow = 'hidden';
    shell.style.pointerEvents = 'none';

    const fill = document.createElement('div');
    fill.style.width = `${Math.max(0, Math.round(hpRatio * 100))}%`;
    fill.style.height = '100%';
    fill.style.background =
      hpRatio < 0.35 ? '#e35a5a' : hpRatio < 0.75 ? '#e0bf50' : '#5dd37a';
    fill.style.transition = 'width 80ms linear';
    shell.appendChild(fill);
    healthBarContainer.appendChild(shell);
  }
};

const updateUsernameLabels = () => {
  // Clear existing labels
  usernameContainer.innerHTML = '';

  const entities = [player, ...npcs];
  for (const entity of entities) {
    if (!entity.username) continue;
    const screenPos = worldToScreen(
      entity.mesh.position.clone().setY(entity.baseY + 1.0)
    );
    if (!screenPos) continue;

    const label = document.createElement('div');
    label.textContent = entity.username;
    label.style.position = 'absolute';
    label.style.left = `${screenPos.x}px`;
    label.style.top = `${screenPos.y}px`;
    label.style.transform = 'translate(-50%, -100%)';
    label.style.color = '#fff';
    label.style.fontFamily = 'inherit';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
    label.style.whiteSpace = 'nowrap';
    label.style.pointerEvents = 'none';

    usernameContainer.appendChild(label);
  }
};

const buildPreview = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x66ff66,
    transparent: true,
    opacity: 0.4,
  })
);
buildPreview.visible = false;
scene.add(buildPreview);

const canAffordBuildMode = (mode: BuildMode) => {
  if (mode === 'wall') return gameState.energy >= ENERGY_COST_WALL;
  if (mode === 'tower') return gameState.energy >= ENERGY_COST_TOWER;
  return true;
};

const setBuildMode = (mode: BuildMode) => {
  if (mode !== 'off' && !canAffordBuildMode(mode)) {
    triggerEventBanner('Not enough coins');
    return;
  }
  if (gameState.buildMode === mode) {
    // Toggle off if clicking same button
    gameState.buildMode = 'off';
  } else {
    gameState.buildMode = mode;
  }
  buildWallBtn.classList.toggle('active', gameState.buildMode === 'wall');
  buildTowerBtn.classList.toggle('active', gameState.buildMode === 'tower');
  buildPreview.visible = gameState.buildMode !== 'off';
  if (gameState.buildMode !== 'off') {
    clearSelectionState(selection);
    selectedTower = selection.selectedTower;
  }
  isDraggingWall = false;
  wallDragStart = null;
  wallDragEnd = null;
  wallDragValidPositions = [];
};

let isMinimapExpanded = false;
let minimapEmbellishAlpha = 0;
let minimapEmbellishTargetAlpha = 0;
const MINIMAP_EMBELLISH_FADE_SPEED = 11;

const setMinimapExpanded = (expanded: boolean) => {
  if (isMinimapExpanded === expanded) return;
  isMinimapExpanded = expanded;
  minimapEmbellishTargetAlpha = expanded ? 1 : 0;
  minimapWrapEl.classList.toggle('is-expanded', expanded);
  hudStatusStackEl.style.display = expanded ? 'none' : '';
  hudEnergyEl.style.display = expanded ? 'none' : '';
  hudActionsEl.style.display = expanded ? 'none' : '';
  minimapToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  minimapToggleBtn.setAttribute(
    'aria-label',
    expanded ? 'Minimap expanded' : 'Expand minimap'
  );
  // Wait for the CSS size transition frame so the canvas can resize to the new bounds.
  window.requestAnimationFrame(() => {
    syncMinimapCanvasSize();
  });
  window.setTimeout(() => {
    syncMinimapCanvasSize();
  }, 260);
};

const updateMinimapEmbellishAlpha = (delta: number) => {
  const blend = Math.min(1, delta * MINIMAP_EMBELLISH_FADE_SPEED);
  minimapEmbellishAlpha +=
    (minimapEmbellishTargetAlpha - minimapEmbellishAlpha) * blend;
  if (Math.abs(minimapEmbellishTargetAlpha - minimapEmbellishAlpha) <= 0.002) {
    minimapEmbellishAlpha = minimapEmbellishTargetAlpha;
  }
  minimapWrapEl.style.setProperty(
    '--hud-minimap-embellish-alpha',
    minimapEmbellishAlpha.toFixed(3)
  );
};

const setSelectedStructures = (colliders: DestructibleCollider[]) => {
  setSelectedStructuresState(selection, colliders, structureStore);
  selectedTower = selection.selectedTower;
};

const clearSelection = () => {
  clearSelectionState(selection);
  selectedTower = selection.selectedTower;
};

const isColliderInRange = (collider: DestructibleCollider, range: number) => {
  return isColliderInRangeFromState(player, collider, range);
};

const getSelectedInRange = () =>
  getSelectedInRangeFromState(selection, player, SELECTION_RADIUS);

const getSingleSelectedTower = (): Tower | null => {
  return getSingleSelectedTowerFromState(selection, structureStore);
};

const getSelectionTowerTypeId = (): TowerTypeId | null => {
  return getSelectionTowerTypeIdFromState(selection, structureStore);
};

const selectionDialog = new SelectionDialog(
  app,
  {
    selectedCount: 0,
    inRangeCount: 0,
    isBankSelected: false,
    selectedTowerTypeId: null,
    selectedStructureLabel: 'Wall',
    bankTotal: null,
    canBankAdd1: false,
    canBankAdd10: false,
    canBankRemove1: false,
    canBankRemove10: false,
    showRepair: true,
    buildingCoords: null,
    buildingHealth: null,
    upgradeOptions: [],
    towerDetails: null,
    canRepair: false,
    canDelete: false,
    repairCost: null,
    repairStatus: null,
  },
  {
    onDelete: () => {
      const colliders = getSelectedInRange();
      if (colliders.length === 0) return;
      if (colliders.some((collider) => collider.type === 'bank')) return;
      const deleteCost = colliders.reduce(
        (sum, collider) => sum + getDeleteEnergyCost(collider),
        0
      );
      if (!spendEnergy(deleteCost)) {
        triggerEventBanner(`Need ${deleteCost} coins`);
        return;
      }
      for (const collider of colliders) {
        queueTreeRegrow(collider);
        structureStore.removeStructureCollider(collider);
      }
      clearSelection();
    },
    onUpgrade: (upgradeId) => {
      const tower = getSingleSelectedTower();
      if (!tower) return;
      const [collider] = selectedStructures.values();
      if (!isColliderInRange(collider, SELECTION_RADIUS)) return;
      const upgradeCost = getUpgradeEnergyCost(upgradeId);
      if (!spendEnergy(upgradeCost)) {
        triggerEventBanner(`Need ${upgradeCost} coins`);
        return;
      }
      applyTowerUpgrade(tower, upgradeId);
      const state = structureStore.structureStates.get(collider);
      if (state) {
        state.cumulativeBuildCost =
          Math.max(0, state.cumulativeBuildCost ?? ENERGY_COST_TOWER) +
          upgradeCost;
      }
      triggerEventBanner('Upgraded');
    },
    onRepair: () => {
      const [collider] = selectedStructures.values();
      if (!collider) return;
      if (
        collider.type === 'tree' ||
        collider.type === 'rock' ||
        collider.type === 'bank'
      )
        return;
      if (!isColliderInRange(collider, SELECTION_RADIUS)) return;
      const state = structureStore.structureStates.get(collider);
      if (!state) return;
      if (state.hp >= state.maxHp) return;
      const repairCost = getRepairCost(state);
      if (!spendEnergy(repairCost)) {
        triggerEventBanner(`Need ${repairCost} coins`);
        return;
      }
      state.hp = state.maxHp;
      state.lastDecayTickMs = Date.now();
      state.graceUntilMs = Date.now() + DECAY_GRACE_MS;
      triggerEventBanner('Repaired');
    },
    onBankAdd1: () => {
      if (!getSelectedBankInRange()) return;
      void depositToCastle(1);
    },
    onBankAdd10: () => {
      if (!getSelectedBankInRange()) return;
      void depositToCastle(10);
    },
    onBankRemove1: () => {
      if (!getSelectedBankInRange()) return;
      void withdrawFromCastle(1);
    },
    onBankRemove10: () => {
      if (!getSelectedBankInRange()) return;
      void withdrawFromCastle(10);
    },
  }
);

let isDebugMenuOpen = false;
const debugMenuRoot = document.createElement('div');
debugMenuRoot.className = 'debug-menu';
debugMenuRoot.innerHTML = `
  <div class="debug-menu__header">Debug Views <span class="debug-menu__hint">[&#96;]</span></div>
  <label class="debug-menu__row">
    <input type="checkbox" data-debug-toggle="flowField" />
    <span>Flow Field Debug</span>
  </label>
  <label class="debug-menu__row">
    <input type="checkbox" data-debug-toggle="playerShootRange" />
    <span>Player Shoot Range</span>
  </label>
  <label class="debug-menu__row">
    <input type="checkbox" data-debug-toggle="worldGrid" />
    <span>World Grid</span>
  </label>
  <button type="button" class="debug-menu__action" data-debug-action="resetGame">
    Reset Game
  </button>
`;
app.appendChild(debugMenuRoot);

const debugFlowFieldInput = debugMenuRoot.querySelector<HTMLInputElement>(
  'input[data-debug-toggle="flowField"]'
);
const debugPlayerRangeInput = debugMenuRoot.querySelector<HTMLInputElement>(
  'input[data-debug-toggle="playerShootRange"]'
);
const debugWorldGridInput = debugMenuRoot.querySelector<HTMLInputElement>(
  'input[data-debug-toggle="worldGrid"]'
);
const debugResetGameButton = debugMenuRoot.querySelector<HTMLButtonElement>(
  'button[data-debug-action="resetGame"]'
);
const requestResetGameFromDebugMenu = async (): Promise<string | null> => {
  const endpoints = ['/api/game/reset', '/internal/menu/reset-game'];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        typeof payload.showToast === 'string'
      ) {
        return payload.showToast;
      }
    } catch {
      // Try the next endpoint before surfacing failure.
    }
  }
  return null;
};

const applyDebugViewState = () => {
  playerShootRangeRing.visible = debugViewState.playerShootRange;
  worldGrid.setVisible(debugViewState.worldGrid);
  if (!debugViewState.flowField) {
    flowFieldDebugOverlay.clear();
  } else if (castleFlowField) {
    flowFieldDebugOverlay.upsert(castleFlowField);
  }
};

const syncDebugMenuInputs = () => {
  if (debugFlowFieldInput)
    debugFlowFieldInput.checked = debugViewState.flowField;
  if (debugPlayerRangeInput)
    debugPlayerRangeInput.checked = debugViewState.playerShootRange;
  if (debugWorldGridInput)
    debugWorldGridInput.checked = debugViewState.worldGrid;
};

const setDebugMenuOpen = (open: boolean) => {
  isDebugMenuOpen = open;
  debugMenuRoot.classList.toggle('is-open', open);
};

const toggleDebugMenu = () => {
  setDebugMenuOpen(!isDebugMenuOpen);
};

debugFlowFieldInput?.addEventListener('change', () => {
  debugViewState.flowField = debugFlowFieldInput.checked;
  applyDebugViewState();
});
debugPlayerRangeInput?.addEventListener('change', () => {
  debugViewState.playerShootRange = debugPlayerRangeInput.checked;
  applyDebugViewState();
});
debugWorldGridInput?.addEventListener('change', () => {
  debugViewState.worldGrid = debugWorldGridInput.checked;
  applyDebugViewState();
});
debugResetGameButton?.addEventListener('click', () => {
  if (debugResetGameButton.disabled) return;
  debugResetGameButton.disabled = true;
  void requestResetGameFromDebugMenu()
    .then((toast) => {
      if (toast) {
        triggerEventBanner(toast, 3.6);
        return;
      }
      triggerEventBanner('Failed to reset game');
    })
    .finally(() => {
      debugResetGameButton.disabled = false;
    });
});

syncDebugMenuInputs();
applyDebugViewState();
setDebugMenuOpen(false);

const SELECTION_DIALOG_UPDATE_INTERVAL_MS = 100;
let nextSelectionDialogUpdateAt = 0;

const updateSelectionDialog = () => {
  const selectedCount = selectedStructures.size;
  if (selectedCount === 0) {
    hudActionsEl.style.display = isMinimapExpanded ? 'none' : '';
    selectionDialog.update({
      selectedCount: 0,
      inRangeCount: 0,
      isBankSelected: false,
      selectedTowerTypeId: null,
      selectedStructureLabel: 'Wall',
      bankTotal: null,
      canBankAdd1: false,
      canBankAdd10: false,
      canBankRemove1: false,
      canBankRemove10: false,
      showRepair: false,
      buildingCoords: null,
      buildingHealth: null,
      upgradeOptions: [],
      towerDetails: null,
      canRepair: false,
      canDelete: false,
      repairCost: null,
      repairStatus: null,
    });
    return;
  }
  const inRange = getSelectedInRange();
  hudActionsEl.style.display = isMinimapExpanded
    ? 'none'
    : selectedCount > 0 && inRange.length > 0
      ? 'none'
      : '';
  const tower = getSingleSelectedTower();
  const [selectedCollider] = selectedStructures.values();
  const selectedStructureState = selectedCollider
    ? (structureStore.structureStates.get(selectedCollider) ?? null)
    : null;
  const selectedType = selectedCollider?.type;
  const isBankSelected = selectedType === 'bank';
  const maxDepositable = Math.max(0, Math.floor(gameState.energy));
  const maxWithdrawable = Math.max(
    0,
    Math.min(
      Math.floor(gameState.bankEnergy),
      Math.floor(ENERGY_CAP - gameState.energy)
    )
  );
  const canDeposit = isBankSelected && inRange.length > 0 && maxDepositable > 0;
  const canWithdraw =
    isBankSelected && inRange.length > 0 && maxWithdrawable > 0;
  const isNatureSelected = selectedType === 'tree' || selectedType === 'rock';
  const selectedIsPlayerBuilt = selectedStructureState?.playerBuilt === true;
  const selectedHpRounded = selectedStructureState
    ? Math.max(0, Math.ceil(selectedStructureState.hp))
    : null;
  const selectedBankTotalRounded = isBankSelected
    ? Math.floor(gameState.bankEnergy)
    : null;
  const deleteCost = inRange
    .filter((collider) => collider.type !== 'bank')
    .reduce((sum, collider) => sum + getDeleteEnergyCost(collider), 0);
  const selectedTowerTypeId = getSelectionTowerTypeId();
  const selectedStructureLabel =
    selectedType === 'tree'
      ? 'Tree'
      : selectedType === 'rock'
        ? 'Rock'
        : selectedType === 'bank'
          ? 'Castle'
          : 'Wall';
  const upgradeOptions =
    !isBankSelected && tower
      ? getTowerUpgradeOptions(tower).map((option) => ({
          id: option.id,
          label: option.label,
          deltaText: getTowerUpgradeDeltaText(option.id),
          cost: getUpgradeEnergyCost(option.id),
          canAfford: gameState.energy >= getUpgradeEnergyCost(option.id),
        }))
      : [];
  const repairCost =
    selectedStructureState &&
    selectedHpRounded !== null &&
    !isNatureSelected &&
    selectedIsPlayerBuilt
      ? getRepairCost({
          hp: selectedHpRounded,
          maxHp: selectedStructureState.maxHp,
          cumulativeBuildCost: selectedStructureState.cumulativeBuildCost,
        })
      : null;
  const repairStatus =
    selectedStructureState && selectedHpRounded !== null && !isNatureSelected
      ? getRepairStatus(selectedHpRounded, selectedStructureState.maxHp)
      : null;

  selectionDialog.update({
    selectedCount,
    inRangeCount: inRange.length,
    isBankSelected,
    selectedTowerTypeId,
    selectedStructureLabel,
    bankTotal: selectedBankTotalRounded,
    canBankAdd1: canDeposit,
    canBankAdd10: canDeposit,
    canBankRemove1: canWithdraw,
    canBankRemove10: canWithdraw,
    showRepair: !isNatureSelected,
    buildingCoords: selectedCollider
      ? {
          x: Math.round(selectedCollider.center.x),
          z: Math.round(selectedCollider.center.z),
        }
      : null,
    buildingHealth:
      selectedStructureState &&
      selectedHpRounded !== null &&
      !isNatureSelected &&
      !isBankSelected
        ? {
            hp: selectedHpRounded,
            maxHp: selectedStructureState.maxHp,
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
          speedLevel: tower.speedLevel,
        }
      : null,
    canRepair:
      !isNatureSelected &&
      !isBankSelected &&
      selectedStructureState !== null &&
      selectedStructureState.hp < selectedStructureState.maxHp &&
      selectedIsPlayerBuilt &&
      inRange.length > 0 &&
      repairCost !== null &&
      gameState.energy >= repairCost,
    canDelete:
      !isBankSelected && inRange.length > 0 && gameState.energy >= deleteCost,
    repairCost,
    repairStatus,
  });
};

buildWallBtn.addEventListener('click', () => setBuildMode('wall'));
buildTowerBtn.addEventListener('click', () => setBuildMode('tower'));
minimapToggleBtn.addEventListener('click', () => {
  if (isMinimapExpanded) return;
  clearSelection();
  setMinimapExpanded(true);
});
minimapWrapEl.addEventListener('transitionend', (event) => {
  if (event.propertyName !== 'width' && event.propertyName !== 'height') return;
  syncMinimapCanvasSize();
});
window.addEventListener('pointerdown', () => {
  if (!isMinimapExpanded) return;
  setMinimapExpanded(false);
});

shootButton.addEventListener('pointerdown', () => {
  gameState.isShooting = true;
});
shootButton.addEventListener('pointerup', () => {
  gameState.isShooting = false;
});
shootButton.addEventListener('pointerleave', () => {
  gameState.isShooting = false;
});

window.addEventListener('keydown', (event) => {
  const isEditableTarget =
    event.target instanceof HTMLElement &&
    (event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable);
  if (inputController.handleKeyDown(event, isEditableTarget)) {
    event.preventDefault();
  } else if (event.code === 'Space') {
    event.preventDefault();
    gameState.isShooting = true;
  } else if (event.code === 'Escape') {
    event.preventDefault();
    setBuildMode('off');
  } else if (event.code === 'Backquote') {
    event.preventDefault();
    toggleDebugMenu();
  }
});

window.addEventListener('keyup', (event) => {
  const isEditableTarget =
    event.target instanceof HTMLElement &&
    (event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.isContentEditable);
  if (inputController.handleKeyUp(event, isEditableTarget)) {
    event.preventDefault();
  } else if (event.code === 'Space') {
    event.preventDefault();
    gameState.isShooting = false;
  }
});

window.addEventListener('blur', () => {
  inputController.clearMovement();
  gameState.isShooting = false;
});

const updatePointer = (event: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
};

const getGroundPoint = (event: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  return screenToWorldOnGround(
    event.clientX,
    event.clientY,
    rect,
    camera,
    groundPlane
  );
};

const getStructureHit = (event: PointerEvent): DestructibleCollider | null => {
  const meshes = Array.from(structureStore.structureMeshToCollider.keys());
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  let closestStructureHit: {
    collider: DestructibleCollider;
    distance: number;
  } | null = null;
  if (meshes.length > 0) {
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const mesh = hits[0]!.object as THREE.Mesh;
      const collider = structureStore.structureMeshToCollider.get(mesh) ?? null;
      if (collider) {
        closestStructureHit = { collider, distance: hits[0]!.distance };
      }
    }
  }
  const castleHits = raycaster.intersectObject(castle, true);
  const pileHits = raycaster.intersectObject(castleBankPiles, true);
  const closestBankDistance = Math.min(
    castleHits[0]?.distance ?? Number.POSITIVE_INFINITY,
    pileHits[0]?.distance ?? Number.POSITIVE_INFINITY
  );
  if (closestBankDistance < Number.POSITIVE_INFINITY) {
    if (
      !closestStructureHit ||
      closestBankDistance <= closestStructureHit.distance
    ) {
      return castleBankSelectionCollider;
    }
  }
  return closestStructureHit?.collider ?? null;
};

const canPlace = (
  center: THREE.Vector3,
  halfSize: THREE.Vector3,
  allowTouchingStructures = false
) => {
  return canPlaceAt(center, halfSize, staticColliders, allowTouchingStructures);
};

const placeBuilding = (center: THREE.Vector3) => {
  if (authoritativeBridge && gameState.buildMode !== 'off') {
    void authoritativeBridge.sendBuildStructure({
      structureId: `${gameState.buildMode}-${Date.now()}-${Math.round(center.x)}-${Math.round(center.z)}`,
      type: gameState.buildMode === 'tower' ? 'tower' : 'wall',
      center: { x: center.x, z: center.z },
    });
    return true;
  }
  const result = placeBuildingAt(
    center,
    gameState.buildMode,
    gameState.energy,
    {
      staticColliders,
      structureStore,
      scene,
      createTowerAt: (snapped) =>
        createTowerAt(snapped, 'base', player.username ?? 'Player'),
      applyObstacleDelta,
    }
  );
  gameState.energy = Math.max(0, gameState.energy - result.energySpent);
  if (result.placed && wallModelTemplate && gameState.buildMode === 'wall') {
    for (const wallMesh of structureStore.wallMeshes) {
      applyWallVisualToMesh(wallMesh);
    }
  }
  return result.placed;
};

const WALL_LINE_SIZE = new THREE.Vector3(1, 1, 1);
const WALL_LINE_HALF = WALL_LINE_SIZE.clone().multiplyScalar(0.5);

const getWallLinePlacement = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  availableEnergy: number
) => {
  return computeWallLinePlacement(start, end, availableEnergy, staticColliders);
};

const placeWallLine = (start: THREE.Vector3, end: THREE.Vector3) => {
  if (authoritativeBridge) {
    const { validPositions } = getWallLinePlacement(start, end, gameState.energy);
    if (validPositions.length === 0) return false;
    const now = Date.now();
    void authoritativeBridge.sendBuildStructures(
      validPositions.map((center, i) => ({
        structureId: `wall-line-${now}-${i}-${Math.round(center.x)}-${Math.round(center.z)}`,
        type: 'wall',
        center: { x: center.x, z: center.z },
      }))
    );
    return true;
  }
  const placed = placeWallSegment(start, end, gameState.energy, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta,
  });
  gameState.energy = Math.max(0, gameState.energy - placed * ENERGY_COST_WALL);
  if (placed > 0 && wallModelTemplate) {
    for (const wallMesh of structureStore.wallMeshes) {
      applyWallVisualToMesh(wallMesh);
    }
  }
  return placed > 0;
};

const placeWallSegments = (positions: THREE.Vector3[]) => {
  if (authoritativeBridge && positions.length > 0) {
    const now = Date.now();
    void authoritativeBridge.sendBuildStructures(
      positions.map((center, i) => ({
        structureId: `wall-segments-${now}-${i}-${Math.round(center.x)}-${Math.round(center.z)}`,
        type: 'wall',
        center: { x: center.x, z: center.z },
      }))
    );
    return true;
  }
  const placed = placeWallSegmentsAt(positions, gameState.energy, {
    scene,
    structureStore,
    staticColliders,
    applyObstacleDelta,
  });
  gameState.energy = Math.max(0, gameState.energy - placed * ENERGY_COST_WALL);
  if (placed > 0 && wallModelTemplate) {
    for (const wallMesh of structureStore.wallMeshes) {
      applyWallVisualToMesh(wallMesh);
    }
  }
  return placed > 0;
};

const addMapTree = (
  center: THREE.Vector3,
  initialScale = 1,
  footprint: TreeFootprint = DEFAULT_TREE_FOOTPRINT
) => {
  const treeFootprint = clampTreeFootprint(footprint);
  const size = getTreeBuildSizeForFootprint(treeFootprint);
  const half = size.clone().multiplyScalar(0.5);
  const snapped = snapCenterToBuildGrid(center, size);
  if (!canPlaceAt(snapped, half, staticColliders)) return false;
  const hitboxMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f8f46,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  hitboxMaterial.colorWrite = false;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    hitboxMaterial
  );
  mesh.position.copy(snapped);
  mesh.userData.treeFootprint = treeFootprint;
  // Keep tree collider hitboxes out of the render passes from frame one.
  mesh.layers.set(HITBOX_LAYER);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  markPersistentMapFeature(mesh);
  if (treeModelTemplate) {
    applyTreeVisualToMesh(mesh);
  }
  if (initialScale !== 1) {
    setStructureVisualScale(mesh, initialScale);
  }
  scene.add(mesh);
  const nowMs = Date.now();
  structureStore.addTreeCollider(snapped, half, mesh, WALL_HP, {
    playerBuilt: false,
    createdAtMs: nowMs,
    lastDecayTickMs: nowMs,
  });
  return true;
};

rockVisualsNeedFullRefresh = true;
renderAllCardinalStagingIslands();

const setMoveTarget = (pos: THREE.Vector3) => {
  const clamped = new THREE.Vector3(
    clamp(pos.x, -WORLD_BOUNDS, WORLD_BOUNDS),
    0,
    clamp(pos.z, -WORLD_BOUNDS, WORLD_BOUNDS)
  );
  player.target.copy(clamped);
  if (authoritativeBridge) {
    const nowMs = performance.now();
    const dx = clamped.x - lastMoveIntentTarget.x;
    const dz = clamped.z - lastMoveIntentTarget.z;
    const targetDelta = Math.hypot(dx, dz);
    if (
      nowMs - lastMoveIntentSentAt >= MOVE_INTENT_MIN_INTERVAL_MS &&
      targetDelta >= MOVE_INTENT_TARGET_EPSILON
    ) {
      lastMoveIntentSentAt = nowMs;
      lastMoveIntentTarget.x = clamped.x;
      lastMoveIntentTarget.z = clamped.z;
      void authoritativeBridge.sendMoveIntent(
        { x: player.mesh.position.x, z: player.mesh.position.z },
        { x: clamped.x, z: clamped.z }
      );
    }
  }
};

const hasPlayerReachedBlockedTarget = () => {
  for (const collider of staticColliders) {
    const targetInsideCollider =
      Math.abs(player.target.x - collider.center.x) <= collider.halfSize.x &&
      Math.abs(player.target.z - collider.center.z) <= collider.halfSize.z;
    if (!targetInsideCollider) continue;
    if (
      distanceToColliderSurface(
        player.mesh.position,
        player.radius,
        collider
      ) <= 0.05
    ) {
      return true;
    }
  }
  return false;
};

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
    mobStagingBoundsPadding: MOB_STAGING_BOUNDS_PADDING,
    gridSize: GRID_SIZE,
  },
  random,
  spawnCubeEffects,
  onStructureDestroyed: (collider) => {
    queueTreeRegrow(collider);
  },
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('#hud, .selection-dialog')) return;
  activePointerId = event.pointerId;
  renderer.domElement.setPointerCapture(event.pointerId);
  if (gameState.buildMode !== 'off') {
    const point = getGroundPoint(event);
    if (!point) return;
    if (gameState.buildMode === 'wall') {
      isDraggingWall = true;
      wallDragStart = point.clone();
      wallDragEnd = point.clone();
      wallDragValidPositions = [];
    } else {
      // Tower: place and exit
      if (placeBuilding(point)) {
        setBuildMode('off');
      }
    }
    return;
  }
  const structureHit = getStructureHit(event);
  if (structureHit) {
    setSelectedStructures([structureHit]);
    setMoveTarget(structureHit.center);
    return;
  }
  const point = getGroundPoint(event);
  if (!point) return;
  clearSelection();
  setMoveTarget(point);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (gameState.buildMode === 'off') return;
  const point = getGroundPoint(event);
  if (!point) return;

  if (gameState.buildMode === 'wall' && isDraggingWall && wallDragStart) {
    wallDragEnd = point.clone();

    // Show one continuous preview mesh for the wall segment.
    const availableWallPreview = gameState.energy;
    const { validPositions, blockedPosition } = getWallLinePlacement(
      wallDragStart,
      wallDragEnd,
      availableWallPreview
    );
    wallDragValidPositions = validPositions;

    if (validPositions.length > 0) {
      const first = validPositions[0]!;
      const last = validPositions[validPositions.length - 1]!;
      const length = validPositions.length;
      const isHorizontal =
        Math.abs(last.x - first.x) >= Math.abs(last.z - first.z);
      const previewSizeX = isHorizontal ? length * GRID_SIZE : GRID_SIZE;
      const previewSizeZ = isHorizontal ? GRID_SIZE : length * GRID_SIZE;

      buildPreview.scale.set(previewSizeX, WALL_LINE_SIZE.y, previewSizeZ);
      buildPreview.position.set(
        (first.x + last.x) * 0.5,
        WALL_LINE_HALF.y,
        (first.z + last.z) * 0.5
      );
      (buildPreview.material as THREE.MeshStandardMaterial).color.setHex(
        0x66ff66
      );
      buildPreview.visible = true;
    } else if (blockedPosition) {
      buildPreview.scale.set(
        WALL_LINE_SIZE.x,
        WALL_LINE_SIZE.y,
        WALL_LINE_SIZE.z
      );
      buildPreview.position.copy(blockedPosition);
      (buildPreview.material as THREE.MeshStandardMaterial).color.setHex(
        0xff6666
      );
      buildPreview.visible = true;
    } else {
      buildPreview.visible = false;
    }
  } else {
    const isTower = gameState.buildMode === 'tower';
    const size = getBuildSizeForMode(isTower ? 'tower' : 'wall');
    const half = size.clone().multiplyScalar(0.5);
    const snapped = snapCenterToBuildGrid(point, size);
    const energyCost = isTower ? ENERGY_COST_TOWER : ENERGY_COST_WALL;
    const ok = canPlace(snapped, half, true) && gameState.energy >= energyCost;
    buildPreview.scale.set(size.x, size.y, size.z);
    buildPreview.position.copy(snapped);
    (buildPreview.material as THREE.MeshStandardMaterial).color.setHex(
      ok ? 0x66ff66 : 0xff6666
    );
    buildPreview.visible = true;
  }
});

window.addEventListener('pointerup', (event) => {
  if (activePointerId !== null && event.pointerId === activePointerId) {
    renderer.domElement.releasePointerCapture(activePointerId);
    activePointerId = null;
  }
  gameState.isShooting = false;
  if (
    gameState.buildMode === 'wall' &&
    isDraggingWall &&
    wallDragStart &&
    wallDragEnd
  ) {
    if (wallDragValidPositions.length > 0) {
      placeWallSegments(wallDragValidPositions);
    } else {
      placeWallLine(wallDragStart, wallDragEnd);
    }
    setBuildMode('off');
  }
});

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -orthoSize * aspect;
  camera.right = orthoSize * aspect;
  camera.top = orthoSize;
  camera.bottom = -orthoSize;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  syncCoinTrailViewport();
  syncMinimapCanvasSize();
});

const updateEntityMotion = (entity: Entity, delta: number) => {
  motionSystem.updateEntityMotion(entity, delta);
};

const updateNpcTargets = () => {
  motionSystem.updateNpcTargets();
};

const triggerEventBanner = (text: string, duration = EVENT_BANNER_DURATION) => {
  eventBannerEl.textContent = '';
  const line = document.createElement('div');
  line.className = 'event-banner__single';
  line.textContent = text;
  eventBannerEl.appendChild(line);
  eventBannerEl.classList.remove('stack');
  eventBannerEl.classList.add('single');
  eventBannerEl.style.setProperty('--banner-duration', `${duration}s`);
  eventBannerEl.classList.remove('show');
  void eventBannerEl.offsetWidth;
  eventBannerEl.classList.add('show');
  gameState.eventBannerTimer = duration;
};

const clearWaveOverlays = () => {
  spawnerRouteOverlay.clear();
  spawnerPathlineCache.clear();
  pathTilePositions.clear();
  rebuildPathTileLayer();
  spawnContainerOverlay.clear();
  stagingIslandsOverlay.clear();
  renderAllCardinalStagingIslands();
  pendingSpawnerPathRefresh.clear();
  pendingSpawnerPathOrder.length = 0;
};

const pickMobInRange = (center: THREE.Vector3, radius: number) => {
  let best: Entity | null = null;
  let bestDistToBase = Number.POSITIVE_INFINITY;
  const candidates = spatialGrid.getNearbyInto(
    center,
    radius,
    rangeCandidateScratch
  );
  for (const mob of candidates) {
    if (mob.kind !== 'mob') continue;
    if (mob.staged) continue;
    if ((mob.hp ?? 0) <= 0) continue;
    const distToCenter = mob.mesh.position.distanceTo(center);
    if (distToCenter > radius) continue;
    const distToBase = mob.mesh.position.length();
    if (distToBase < bestDistToBase) {
      best = mob;
      bestDistToBase = distToBase;
    }
  }
  return best;
};

const pickSelectedMob = () =>
  pickMobInRange(player.mesh.position, PLAYER_SHOOT_RANGE);

const getProjectileMobCandidates = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  out: Entity[]
) => {
  if (!ENABLE_PROJECTILE_BROADPHASE) {
    out.length = 0;
    for (const mob of mobs) out.push(mob);
    return out;
  }
  projectileMidpointScratch.copy(from).add(to).multiplyScalar(0.5);
  const segmentLength = from.distanceTo(to);
  const queryRadius = segmentLength * 0.5 + radius + MOB_WIDTH;
  return spatialGrid.getNearbyInto(
    projectileMidpointScratch,
    queryRadius,
    out
  );
};

const getTowerLaunchTransform = (
  tower: Tower,
  rig: BallistaVisualRig | undefined,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion
) => {
  if (rig) {
    rig.root.updateMatrixWorld(true);
    getBallistaArrowLaunchTransform(rig, outPosition, outQuaternion);
    return;
  }
  outPosition.copy(tower.mesh.position);
  outPosition.y += TOWER_HEIGHT * 0.5;
  outQuaternion.identity();
};

const spawnTowerArrowProjectile = (
  tower: Tower,
  launchPos: THREE.Vector3,
  launchQuaternion: THREE.Quaternion,
  launchVelocity: THREE.Vector3
) => {
  if (!arrowModelTemplate) return;
  const mesh = arrowModelTemplate.clone(true);
  mesh.quaternion.copy(launchQuaternion);
  orientArrowToVelocity(mesh, launchVelocity);
  placeArrowMeshAtFacing(mesh, launchPos);
  scene.add(mesh);
  activeArrowProjectiles.push({
    mesh,
    position: launchPos.clone(),
    velocity: launchVelocity.clone(),
    gravity: towerArrowGravity,
    gravityDelay: BALLISTA_ARROW_GRAVITY_DELAY,
    radius: BALLISTA_ARROW_RADIUS,
    ttl: BALLISTA_ARROW_MAX_LIFETIME,
    damage: tower.damage,
    sourceTower: tower,
  });
};

const updateTowerArrowProjectiles = (delta: number) => {
  const serverAuthoritative = isServerAuthoritative();
  for (let i = activeArrowProjectiles.length - 1; i >= 0; i -= 1) {
    const projectile = activeArrowProjectiles[i]!;
    projectile.ttl -= delta;
    if (projectile.ttl <= 0) {
      scene.remove(projectile.mesh);
      activeArrowProjectiles.splice(i, 1);
      continue;
    }

    projectilePrevPosScratch.copy(projectile.position);
    let gravityDt = delta;
    if (projectile.gravityDelay > 0) {
      const delayStep = Math.min(projectile.gravityDelay, delta);
      projectile.gravityDelay -= delayStep;
      gravityDt = delta - delayStep;
    }
    if (gravityDt > 0) {
      projectile.velocity.addScaledVector(projectile.gravity, gravityDt);
    }
    projectile.position.addScaledVector(projectile.velocity, delta);
    orientArrowToVelocity(projectile.mesh, projectile.velocity);
    placeArrowMeshAtFacing(projectile.mesh, projectile.position);

    projectileStepScratch
      .copy(projectile.position)
      .sub(projectilePrevPosScratch);
    const segmentLenSq = projectileStepScratch.lengthSq();
    let hitMob: MobEntity | null = null;
    let bestT = Number.POSITIVE_INFINITY;

    const projectileCandidates = getProjectileMobCandidates(
      projectilePrevPosScratch,
      projectile.position,
      projectile.radius,
      projectileBroadphaseCandidatesScratch
    );
    for (const mob of projectileCandidates) {
      if (mob.kind !== 'mob') continue;
      if (mob.staged) continue;
      if ((mob.hp ?? 0) <= 0) continue;
      projectileMobCenterScratch.copy(mob.mesh.position).setY(mob.baseY + 0.3);
      const combinedRadius = mob.radius + projectile.radius;
      let t = 0;
      if (segmentLenSq > 1e-8) {
        projectileDeltaScratch
          .copy(projectileMobCenterScratch)
          .sub(projectilePrevPosScratch);
        t = THREE.MathUtils.clamp(
          projectileDeltaScratch.dot(projectileStepScratch) / segmentLenSq,
          0,
          1
        );
      }
      projectileClosestPointScratch
        .copy(projectilePrevPosScratch)
        .addScaledVector(projectileStepScratch, t);
      if (
        projectileClosestPointScratch.distanceToSquared(
          projectileMobCenterScratch
        ) >
        combinedRadius * combinedRadius
      )
        continue;
      if (t < bestT) {
        bestT = t;
        hitMob = mob;
        projectileHitPointScratch.copy(projectileClosestPointScratch);
      }
    }

    if (!hitMob) continue;
    projectile.position.copy(projectileHitPointScratch);
    placeArrowMeshAtFacing(projectile.mesh, projectile.position);
    setMobLastHitDirection(hitMob, projectileStepScratch, projectile.velocity);
    if (serverAuthoritative) {
      markMobHitFlash(hitMob);
      scene.remove(projectile.mesh);
      activeArrowProjectiles.splice(i, 1);
      continue;
    }
    const attack = rollAttackDamage(projectile.damage);
    const prevHp = hitMob.hp ?? 1;
    const nextHp = prevHp - attack.damage;
    hitMob.hp = nextHp;
    markMobHitFlash(hitMob);
    hitMob.lastHitBy = 'tower';
    spawnFloatingDamageText(hitMob, attack.damage, 'tower', attack.isCrit);
    if (prevHp > 0 && nextHp <= 0) {
      projectile.sourceTower.killCount += 1;
    }
    scene.remove(projectile.mesh);
    activeArrowProjectiles.splice(i, 1);
  }
};

const spawnPlayerArrowProjectile = (
  launchPos: THREE.Vector3,
  launchVelocity: THREE.Vector3
) => {
  if (!arrowModelTemplate) return;
  const mesh = arrowModelTemplate.clone(true);
  orientArrowToVelocity(mesh, launchVelocity);
  placeArrowMeshAtFacing(mesh, launchPos);
  scene.add(mesh);
  activePlayerArrowProjectiles.push({
    mesh,
    position: launchPos.clone(),
    velocity: launchVelocity.clone(),
    gravity: towerArrowGravity,
    gravityDelay: BALLISTA_ARROW_GRAVITY_DELAY,
    radius: BALLISTA_ARROW_RADIUS,
    ttl: BALLISTA_ARROW_MAX_LIFETIME,
    damage: SHOOT_DAMAGE,
  });
};

const updatePlayerArrowProjectiles = (delta: number) => {
  const serverAuthoritative = isServerAuthoritative();
  for (let i = activePlayerArrowProjectiles.length - 1; i >= 0; i -= 1) {
    const projectile = activePlayerArrowProjectiles[i]!;
    projectile.ttl -= delta;
    if (projectile.ttl <= 0) {
      scene.remove(projectile.mesh);
      activePlayerArrowProjectiles.splice(i, 1);
      continue;
    }

    projectilePrevPosScratch.copy(projectile.position);
    let gravityDt = delta;
    if (projectile.gravityDelay > 0) {
      const delayStep = Math.min(projectile.gravityDelay, delta);
      projectile.gravityDelay -= delayStep;
      gravityDt = delta - delayStep;
    }
    if (gravityDt > 0) {
      projectile.velocity.addScaledVector(projectile.gravity, gravityDt);
    }
    projectile.position.addScaledVector(projectile.velocity, delta);
    orientArrowToVelocity(projectile.mesh, projectile.velocity);
    placeArrowMeshAtFacing(projectile.mesh, projectile.position);

    projectileStepScratch
      .copy(projectile.position)
      .sub(projectilePrevPosScratch);
    const segmentLenSq = projectileStepScratch.lengthSq();
    let hitMob: MobEntity | null = null;
    let bestT = Number.POSITIVE_INFINITY;

    const projectileCandidates = getProjectileMobCandidates(
      projectilePrevPosScratch,
      projectile.position,
      projectile.radius,
      projectileBroadphaseCandidatesScratch
    );
    for (const mob of projectileCandidates) {
      if (mob.kind !== 'mob') continue;
      if (mob.staged) continue;
      if ((mob.hp ?? 0) <= 0) continue;
      projectileMobCenterScratch.copy(mob.mesh.position).setY(mob.baseY + 0.3);
      const combinedRadius = mob.radius + projectile.radius;
      let t = 0;
      if (segmentLenSq > 1e-8) {
        projectileDeltaScratch
          .copy(projectileMobCenterScratch)
          .sub(projectilePrevPosScratch);
        t = THREE.MathUtils.clamp(
          projectileDeltaScratch.dot(projectileStepScratch) / segmentLenSq,
          0,
          1
        );
      }
      projectileClosestPointScratch
        .copy(projectilePrevPosScratch)
        .addScaledVector(projectileStepScratch, t);
      if (
        projectileClosestPointScratch.distanceToSquared(
          projectileMobCenterScratch
        ) >
        combinedRadius * combinedRadius
      )
        continue;
      if (t < bestT) {
        bestT = t;
        hitMob = mob;
        projectileHitPointScratch.copy(projectileClosestPointScratch);
      }
    }

    if (!hitMob) continue;
    projectile.position.copy(projectileHitPointScratch);
    placeArrowMeshAtFacing(projectile.mesh, projectile.position);
    setMobLastHitDirection(hitMob, projectileStepScratch, projectile.velocity);
    if (serverAuthoritative) {
      markMobHitFlash(hitMob);
      scene.remove(projectile.mesh);
      activePlayerArrowProjectiles.splice(i, 1);
      continue;
    }
    const attack = rollAttackDamage(projectile.damage);
    hitMob.hp = (hitMob.hp ?? 0) - attack.damage;
    markMobHitFlash(hitMob);
    hitMob.lastHitBy = 'player';
    spawnFloatingDamageText(hitMob, attack.damage, 'player', attack.isCrit);
    scene.remove(projectile.mesh);
    activePlayerArrowProjectiles.splice(i, 1);
  }
};

const updateMobInstanceRender = (now: number) => {
  renderVisibleMobInstances({
    mobs,
    camera,
    mobInstanceMesh,
    mobHitFlashMesh,
    mobInstanceDummy,
    mobInstanceBaseMatrix,
    mobInstanceGroundOffsetY,
    mobInstanceHeadingOffset,
    nowMs: now,
    maxVisibleMobInstances: MAX_VISIBLE_MOB_INSTANCES,
    mobInstanceCap: MOB_INSTANCE_CAP,
    lodNearDistance: ENABLE_MOB_RENDER_LOD ? MOB_LOD_NEAR_DISTANCE : 1_000_000,
    lodFarDistance: ENABLE_MOB_RENDER_LOD ? MOB_LOD_FAR_DISTANCE : 1_000_000,
    lodMidAnimationStepMs: MOB_LOD_MID_ANIMATION_STEP_MS,
    lodFarAnimationStepMs: MOB_LOD_FAR_ANIMATION_STEP_MS,
    disableFarWiggle: ENABLE_MOB_RENDER_LOD && MOB_LOD_DISABLE_FAR_WIGGLE,
  });
};

const applyStructureDecay = (nowMs: number) => {
  const decayPerMs = DECAY_HP_PER_HOUR / (60 * 60 * 1000);
  const toRemove: DestructibleCollider[] = [];
  for (const [collider, state] of structureStore.structureStates.entries()) {
    if (collider.type !== 'wall' && collider.type !== 'tower') continue;
    if (state.playerBuilt !== true) continue;
    const graceUntilMs =
      state.graceUntilMs ?? (state.createdAtMs ?? nowMs) + DECAY_GRACE_MS;
    if (nowMs < graceUntilMs) continue;
    const lastTickMs = state.lastDecayTickMs ?? graceUntilMs;
    const elapsedMs = Math.max(0, nowMs - lastTickMs);
    if (elapsedMs <= 0) continue;
    state.hp = Math.max(0, state.hp - elapsedMs * decayPerMs);
    state.lastDecayTickMs = nowMs;
    if (state.hp <= 0) {
      toRemove.push(collider as DestructibleCollider);
    }
  }
  for (const collider of toRemove) {
    structureStore.removeStructureCollider(collider);
  }
};

const processTreeRegrowth = (nowMs: number) => {
  for (let i = treeRegrowQueue.length - 1; i >= 0; i -= 1) {
    const candidate = treeRegrowQueue[i]!;
    if (nowMs < candidate.dueAtMs) continue;
    if (!canPlaceAt(candidate.center, candidate.halfSize, staticColliders)) {
      candidate.dueAtMs = nowMs + 2000;
      continue;
    }
    const didRegrow = addMapTree(candidate.center, 0.2);
    if (didRegrow) {
      const collider = structureStore
        .getDestructibleColliders()
        .find(
          (entry) =>
            entry.type === 'tree' &&
            entry.center.distanceToSquared(candidate.center) < 0.001
        );
      const state = collider
        ? structureStore.structureStates.get(collider)
        : null;
      if (state) {
        growingTrees.push({ mesh: state.mesh, startedAtMs: nowMs });
      }
      treeRegrowQueue.splice(i, 1);
    } else {
      candidate.dueAtMs = nowMs + 2000;
    }
  }
};

const updateGrowingTrees = (nowMs: number) => {
  for (let i = growingTrees.length - 1; i >= 0; i -= 1) {
    const entry = growingTrees[i]!;
    if (!structureStore.structureMeshToCollider.has(entry.mesh)) {
      growingTrees.splice(i, 1);
      continue;
    }
    const t = clamp((nowMs - entry.startedAtMs) / TREE_GROWTH_MS, 0, 1);
    const scale = 0.2 + t * 0.8;
    setStructureVisualScale(entry.mesh, scale);
    if (t >= 1) {
      growingTrees.splice(i, 1);
    }
  }
};

const tick = (now: number, delta: number) => {
  tickFrameCounter += 1;
  const framePerfStartMs = performance.now();
  let frameSpatialMs = 0;
  let frameTargetingMs = 0;
  let frameProjectileMs = 0;
  let frameRenderMs = 0;
  const serverAuthoritative = isServerAuthoritative();
  if (rockVisualsNeedFullRefresh && hasAllRockTemplates()) {
    refreshAllRockVisuals(true);
    rockVisualsNeedFullRefresh = false;
  }
  const waterTime = now * 0.001;
  const bobOffset =
    Math.sin(waterTime * WATER_BOB_SPEED) * WATER_BOB_AMPLITUDE * 0.22;
  waterMesh.position.y = WATER_LEVEL - 0.01 + bobOffset;
  waterMaterial.uniforms.uTime.value = waterTime;

  updateMinimapEmbellishAlpha(delta);
  if (Math.abs(minimapEmbellishTargetAlpha - minimapEmbellishAlpha) > 0.001) {
    syncMinimapCanvasSize();
  }
  if (!serverAuthoritative) {
    gameState.energy = Math.min(
      ENERGY_CAP,
      gameState.energy + ENERGY_REGEN_RATE * delta
    );
    if (gameState.buildMode === 'wall' && gameState.energy < ENERGY_COST_WALL) {
      setBuildMode('off');
    }
    if (
      gameState.buildMode === 'tower' &&
      gameState.energy < ENERGY_COST_TOWER
    ) {
      setBuildMode('off');
    }
  }
  const wallClockNowMs = Date.now();
  if (!serverAuthoritative) {
    applyStructureDecay(wallClockNowMs);
  }
  processTreeRegrowth(wallClockNowMs);
  updateGrowingTrees(wallClockNowMs);

  const keyboardDir = inputController.getKeyboardMoveDirection({
    camera,
    keyboardForward,
    keyboardRight,
    keyboardMoveDir,
  });
  const isKeyboardMoving = keyboardDir !== null;
  if (keyboardDir) {
    const keyboardMoveDistance = Math.max(GRID_SIZE, player.speed * 0.35);
    setMoveTarget(
      player.mesh.position
        .clone()
        .addScaledVector(keyboardDir, keyboardMoveDistance)
    );
    wasKeyboardMoving = true;
  } else if (wasKeyboardMoving) {
    // Release-to-stop behavior for keyboard movement.
    setMoveTarget(player.mesh.position);
    wasKeyboardMoving = false;
  }

  updateNpcTargets();
  updateEntityMotion(player, delta);
  if (
    authoritativeBridge &&
    now - lastNetworkHeartbeatAt >= SERVER_HEARTBEAT_INTERVAL_MS
  ) {
    lastNetworkHeartbeatAt = now;
    void authoritativeBridge.heartbeat({
      x: player.mesh.position.x,
      z: player.mesh.position.z,
    });
  }
  for (const npc of npcs) {
    updateEntityMotion(npc, delta);
  }

  if (serverAuthoritative) {
    updateServerMobInterpolation(now);
  }

  const spatialStartedAtMs = performance.now();
  const dynamicEntities = [player, ...npcs, ...mobs];
  if (ENABLE_INCREMENTAL_SPATIAL_GRID) {
    const nextDynamicEntities = new Set(dynamicEntities);
    for (const entity of dynamicEntities) {
      if (trackedDynamicEntities.has(entity)) {
        spatialGrid.updateEntityCell(entity);
      } else {
        spatialGrid.insert(entity);
      }
    }
    for (const previous of trackedDynamicEntities) {
      if (nextDynamicEntities.has(previous)) continue;
      spatialGrid.remove(previous);
    }
    trackedDynamicEntities.clear();
    for (const entity of nextDynamicEntities) {
      trackedDynamicEntities.add(entity);
    }
  } else {
    spatialGrid.clear();
    for (const entity of dynamicEntities) {
      spatialGrid.insert(entity);
    }
  }
  frameSpatialMs += performance.now() - spatialStartedAtMs;

  updateParticles(delta);
  updateMobDeathVisuals(delta);
  updateEnergyTrails(delta);
  updateFloatingDamageTexts(delta);

  const targetingStartedAtMs = performance.now();
  const shouldRefreshTowerTargets =
    tickFrameCounter % TOWER_TARGET_REFRESH_INTERVAL_FRAMES === 0;
  for (const tower of towers) {
    tower.shootCooldown = Math.max(tower.shootCooldown - delta, 0);
    const refreshedTarget = shouldRefreshTowerTargets
      ? pickMobInRange(tower.mesh.position, tower.range)
      : undefined;
    if (refreshedTarget !== undefined) {
      cachedTowerTargets.set(tower, refreshedTarget);
    }
    const target = cachedTowerTargets.get(tower) ?? null;
    const rig = towerBallistaRigs.get(tower);
    let canFire = true;
    if (target) {
      getTowerLaunchTransform(
        tower,
        rig,
        towerLaunchPosScratch,
        towerLaunchQuatScratch
      );
      towerTargetPosScratch.copy(target.mesh.position).setY(target.baseY + 0.3);
      const closeRangeDirectAim =
        towerLaunchPosScratch.distanceTo(towerTargetPosScratch) <=
        BALLISTA_ARROW_DIRECT_AIM_DISTANCE;
      const intercept = closeRangeDirectAim
        ? null
        : solveBallisticIntercept(
            towerLaunchPosScratch,
            towerTargetPosScratch,
            target.velocity,
            BALLISTA_ARROW_SPEED,
            towerArrowGravity,
            BALLISTA_ARROW_GRAVITY_DELAY,
            BALLISTA_ARROW_MAX_LIFETIME
          );
      const launchVelocity = closeRangeDirectAim
        ? towerTargetPosScratch
            .clone()
            .sub(towerLaunchPosScratch)
            .normalize()
            .multiplyScalar(BALLISTA_ARROW_SPEED)
        : (intercept?.velocity ??
          computeFallbackBallisticVelocity(
            towerLaunchPosScratch,
            towerTargetPosScratch,
            towerArrowGravity,
            BALLISTA_ARROW_GRAVITY_DELAY,
            BALLISTA_ARROW_SPEED,
            BALLISTA_ARROW_MAX_LIFETIME
          ));
      if (rig) {
        canFire = updateBallistaRigTracking(
          rig,
          tower.mesh.position,
          towerTargetPosScratch,
          launchVelocity,
          delta
        ).aimAligned;
      }
      if (tower.shootCooldown <= 0 && arrowModelTemplate && canFire) {
        spawnTowerArrowProjectile(
          tower,
          towerLaunchPosScratch,
          towerLaunchQuatScratch,
          launchVelocity
        );
        tower.shootCooldown = tower.shootCadence;
      }
    } else if (rig) {
      updateBallistaRigTracking(rig, tower.mesh.position, null, null, delta);
    }
  }
  frameTargetingMs += performance.now() - targetingStartedAtMs;
  const projectileStartedAtMs = performance.now();
  updateTowerArrowProjectiles(delta);
  updatePlayerArrowProjectiles(delta);
  frameProjectileMs += performance.now() - projectileStartedAtMs;

  // Only check collisions between entities in nearby cells
  const processed = new Set<Entity>();
  for (const entity of dynamicEntities) {
    processed.add(entity);
    const nearby = spatialGrid.getNearbyInto(
      entity.mesh.position,
      (entity.radius + 0.5) * 2,
      collisionNearbyScratch
    );
    for (const other of nearby) {
      if (processed.has(other)) continue; // Already processed this pair
      resolveCircleCircle(entity, other);
    }
  }
  for (const mob of mobs) {
    clampStagedMobToSpawnerIsland(mob);
  }

  const waveComplete = gameState.wave > 0 && !serverWaveActive && mobs.length === 0;

  if (tickFrameCounter % 2 === 0) {
    cachedSelectedMob = pickSelectedMob();
  }
  const selected = cachedSelectedMob;
  if (selected) {
    // Bounce animation using sine wave
    const bounceOffset = Math.sin(now * 0.005) * 0.3;
    selectionArrow.position.set(
      selected.mesh.position.x,
      selected.baseY + 2.5 + bounceOffset,
      selected.mesh.position.z
    );
    // Rotate arrow to face camera (billboard effect)
    // Arrow is built pointing down (-Y in local space)
    // Get camera's right and up vectors
    selectionArrowCameraRightScratch
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .normalize();
    selectionArrowCameraUpScratch
      .set(0, 1, 0)
      .applyQuaternion(camera.quaternion)
      .normalize();
    selectionArrowCameraForwardScratch
      .copy(selectionArrowCameraRightScratch)
      .cross(selectionArrowCameraUpScratch)
      .normalize();
    // Make arrow's local X align with camera right, local Z with camera up
    // This makes arrow's Y axis perpendicular to camera view (showing side, not circles)
    selectionArrowBasisMatrixScratch.makeBasis(
      selectionArrowCameraRightScratch,
      selectionArrowCameraUpScratch,
      selectionArrowCameraForwardScratch
    );
    selectionArrow.quaternion.setFromRotationMatrix(
      selectionArrowBasisMatrixScratch
    );
    selectionArrow.visible = true;
  } else {
    selectionArrow.visible = false;
  }

  // Update shoot button state
  shootButton.disabled = selected === null;
  if (now >= nextSelectionDialogUpdateAt) {
    updateSelectionDialog();
    nextSelectionDialogUpdateAt = now + SELECTION_DIALOG_UPDATE_INTERVAL_MS;
  }
  syncSelectedStructureOutline();
  const outlinePulse = 3.8 + Math.sin(now * 0.01) * 0.5;
  structureOutlinePass.edgeStrength = outlinePulse;
  treeOutlinePass.edgeStrength = outlinePulse;

  for (const tower of towers) {
    tower.rangeRing.position.set(
      tower.mesh.position.x,
      0.02,
      tower.mesh.position.z
    );
    const collider = structureStore.structureMeshToCollider.get(tower.mesh);
    tower.rangeRing.visible =
      selectedTower === tower ||
      (collider !== undefined && selectedStructures.has(collider));
  }
  playerShootRangeRing.position.set(
    player.mesh.position.x,
    0.02,
    player.mesh.position.z
  );
  playerShootRangeRing.visible = debugViewState.playerShootRange;

  const arrowDir = new THREE.Vector3(
    player.target.x - player.mesh.position.x,
    0,
    player.target.z - player.mesh.position.z
  );
  const arrowLength = hasPlayerReachedBlockedTarget() ? 0 : arrowDir.length();
  if (!isKeyboardMoving && arrowLength >= 1.0) {
    arrowDir.normalize();
    arrow.position.copy(player.mesh.position);
    arrow.setDirection(arrowDir);
    arrow.setLength(Math.min(arrowLength, 12), 0.6, 0.5);
    arrow.visible = true;
  } else {
    arrow.visible = false;
  }

  if (gameState.isShooting && selected) {
    gameState.shootCooldown -= delta;
    if (gameState.shootCooldown <= 0 && arrowModelTemplate) {
      playerLaunchPosScratch
        .copy(player.mesh.position)
        .setY(player.baseY + 0.35);
      playerTargetPosScratch
        .copy(selected.mesh.position)
        .setY(selected.baseY + 0.3);
      const closeRangeDirectAim =
        playerLaunchPosScratch.distanceTo(playerTargetPosScratch) <=
        BALLISTA_ARROW_DIRECT_AIM_DISTANCE;
      const intercept = closeRangeDirectAim
        ? null
        : solveBallisticIntercept(
            playerLaunchPosScratch,
            playerTargetPosScratch,
            selected.velocity,
            BALLISTA_ARROW_SPEED,
            towerArrowGravity,
            BALLISTA_ARROW_GRAVITY_DELAY,
            BALLISTA_ARROW_MAX_LIFETIME
          );
      const launchVelocity = closeRangeDirectAim
        ? playerTargetPosScratch
            .clone()
            .sub(playerLaunchPosScratch)
            .normalize()
            .multiplyScalar(BALLISTA_ARROW_SPEED)
        : (intercept?.velocity ??
          computeFallbackBallisticVelocity(
            playerLaunchPosScratch,
            playerTargetPosScratch,
            towerArrowGravity,
            BALLISTA_ARROW_GRAVITY_DELAY,
            BALLISTA_ARROW_SPEED,
            BALLISTA_ARROW_MAX_LIFETIME
          ));
      spawnPlayerArrowProjectile(playerLaunchPosScratch, launchVelocity);
      gameState.shootCooldown = SHOOT_COOLDOWN;
    }
  } else {
    gameState.shootCooldown = Math.max(gameState.shootCooldown - delta, 0);
  }

  dir.target.position.copy(player.mesh.position);
  dir.position.copy(player.mesh.position).add(dirShadowFollowOffset);
  dir.target.updateMatrixWorld();
  dir.updateMatrixWorld();
  dir.shadow.camera.updateMatrixWorld();

  camera.position.copy(player.mesh.position).add(cameraOffset);
  camera.lookAt(player.mesh.position);
  camera.updateMatrixWorld();
  updateViewportFogCenter();
  const renderStartedAtMs = performance.now();
  updateMobInstanceRender(now);
  frameRenderMs += performance.now() - renderStartedAtMs;

  updateHealthBars();
  updateUsernameLabels();

  // Update ground + grid to cover the visible camera rectangle
  const visibleBounds = getVisibleGroundBounds(camera);
  updateGroundFromBounds(visibleBounds);
  updateWaterFromBounds(visibleBounds);
  if (debugViewState.worldGrid) {
    worldGrid.update(visibleBounds);
  }

  gameState.energyPopTimer = Math.max(0, gameState.energyPopTimer - delta);
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
      shootButton,
    },
    {
      energy: gameState.energy,
      wave: gameState.wave,
      waveComplete,
      nextWaveAt: gameState.nextWaveAt,
      now,
      mobsCount: mobs.length,
      energyPopTimer: gameState.energyPopTimer,
      shootCooldown: gameState.shootCooldown,
    },
    {
      energyCostWall: ENERGY_COST_WALL,
      energyCostTower: ENERGY_COST_TOWER,
      shootCooldownMax: SHOOT_COOLDOWN,
    }
  );

  if (gameState.prevMobsCount > 0 && waveComplete) {
    triggerEventBanner('Wave cleared');
  }

  if (gameState.eventBannerTimer > 0) {
    gameState.eventBannerTimer = Math.max(
      0,
      gameState.eventBannerTimer - delta
    );
    if (gameState.eventBannerTimer === 0) {
      eventBannerEl.classList.remove('show');
      eventBannerEl.textContent = '';
    }
  }

  gameState.prevMobsCount = mobs.length;
  if (import.meta.env.DEV) {
    assertEnergyInBounds(gameState.energy, ENERGY_CAP);
    if (gameState.bankEnergy < 0) {
      throw new Error(
        `Bank invariant violated: bankEnergy=${gameState.bankEnergy}`
      );
    }
    assertSpawnerCounts(activeWaveSpawners);
    assertMobSpawnerReferences(mobs, new Set([...spawnerById.keys()]));
    assertStructureStoreConsistency(structureStore, staticColliders);
  }

  applyStructureDamageVisuals();
  drawMinimap();
  updateCoinHudView(delta);
  composer.render();
  coinTrailRenderer.render(coinTrailScene, coinTrailCamera);
  if (ENABLE_CLIENT_FRAME_PROFILING) {
    const frameTotalMs = performance.now() - framePerfStartMs;
    frameStageSamples.push({
      totalMs: frameTotalMs,
      spatialMs: frameSpatialMs,
      targetingMs: frameTargetingMs,
      projectileMs: frameProjectileMs,
      renderMs: frameRenderMs,
    });
    if (frameStageSamples.length > FRAME_PROFILE_MAX_SAMPLES) {
      frameStageSamples.shift();
    }
    if (now >= nextFrameProfileLogAtMs) {
      const sampleCount = Math.max(1, frameStageSamples.length);
      const avgTotal =
        frameStageSamples.reduce((sum, sample) => sum + sample.totalMs, 0) /
        sampleCount;
      const avgSpatial =
        frameStageSamples.reduce((sum, sample) => sum + sample.spatialMs, 0) /
        sampleCount;
      const avgTargeting =
        frameStageSamples.reduce((sum, sample) => sum + sample.targetingMs, 0) /
        sampleCount;
      const avgProjectile =
        frameStageSamples.reduce((sum, sample) => sum + sample.projectileMs, 0) /
        sampleCount;
      const avgRender =
        frameStageSamples.reduce((sum, sample) => sum + sample.renderMs, 0) /
        sampleCount;
      console.info('Client frame profile', {
        sampleSize: frameStageSamples.length,
        avgTotalMs: Number(avgTotal.toFixed(2)),
        avgSpatialMs: Number(avgSpatial.toFixed(2)),
        avgTargetingMs: Number(avgTargeting.toFixed(2)),
        avgProjectileMs: Number(avgProjectile.toFixed(2)),
        avgRenderMs: Number(avgRender.toFixed(2)),
        budgetTotalMs: 16,
      });
      nextFrameProfileLogAtMs = now + FRAME_PROFILE_LOG_INTERVAL_MS;
    }
  }
};

const gameLoop = createGameLoop(tick);
startGameWhenReady = () => {
  if (hasStartedGameLoop || !hasFinishedLoadingAssets) return;
  if (!authoritativeInitialDataReady) return;
  hasStartedGameLoop = true;
  completeLoadingAndRevealScene();
  gameLoop.start();
};
let disposed = false;
const disposeApp = () => {
  if (disposed) return;
  disposed = true;
  if (authoritativeBridge) {
    void authoritativeBridge.disconnect();
    authoritativeBridge = null;
  }

  particleSystem.dispose();
  spawnContainerOverlay.dispose();
  stagingIslandsOverlay.setTilesChangedListener(null);
  stagingIslandsOverlay.dispose();
  spawnerRouteOverlay.clear();
  pathCenterTileLayer.dispose();
  pathEdgeTileLayer.dispose();
  pathInnerCornerTileLayer.dispose();
  pathOuterCornerTileLayer.dispose();
  flowFieldDebugOverlay.clear();
  worldGrid.dispose();
  worldBorder.dispose();

  shaftGeometry.dispose();
  shaftMaterial.dispose();
  headGeometry.dispose();
  headMaterial.dispose();

  scene.remove(buildPreview);
  buildPreview.geometry.dispose();
  (buildPreview.material as THREE.Material).dispose();

  scene.remove(mobInstanceMesh);
  scene.remove(mobHitFlashMesh);
  mobInstanceMesh.geometry.dispose();
  if (Array.isArray(mobInstanceMesh.material)) {
    for (const material of mobInstanceMesh.material) material.dispose();
  } else {
    mobInstanceMesh.material.dispose();
  }
  if (Array.isArray(mobHitFlashMesh.material)) {
    for (const material of mobHitFlashMesh.material) material.dispose();
  } else {
    mobHitFlashMesh.material.dispose();
  }
  clearMobDeathVisuals();
  mobLogicGeometry.dispose();
  mobLogicMaterial.dispose();
  for (const projectile of activeArrowProjectiles) {
    scene.remove(projectile.mesh);
  }
  activeArrowProjectiles.length = 0;
  for (const projectile of activePlayerArrowProjectiles) {
    scene.remove(projectile.mesh);
  }
  activePlayerArrowProjectiles.length = 0;
  scene.remove(playerShootRangeRing);
  playerShootRangeRing.geometry.dispose();
  towerRangeMaterial.dispose();

  scene.remove(ground);
  ground.geometry.dispose();
  groundMaterial.dispose();
  scene.remove(waterMesh);
  waterMesh.geometry.dispose();
  waterMaterial.dispose();
  waterDistanceField.texture.dispose();
  groundTileLayer.dispose();
  scene.remove(castle);
  castle.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        material.dispose();
      }
      return;
    }
    node.material.dispose();
  });

  coinHudRoot.clear();
  coinHudRenderer.dispose();
  for (const trail of activeEnergyTrails) {
    coinTrailScene.remove(trail.mesh);
    for (const material of trail.materials) {
      material.dispose();
    }
  }
  activeEnergyTrails.length = 0;
  coinTrailRenderer.dispose();
  composer.dispose();
  renderer.dispose();
};

window.addEventListener('beforeunload', disposeApp);
syncCoinTrailViewport();
syncMinimapCanvasSize();
void setupAuthoritativeBridge();
startGameWhenReady();

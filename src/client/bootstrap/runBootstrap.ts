import * as THREE from 'three';
import castleModelUrl from '../assets/models/castle.glb?url';
import castleIconUrl from '../assets/icons/castle.svg?url';
import coinModelUrl from '../assets/models/coin.glb?url';
import groundModelUrl from '../assets/models/ground.glb?url';
import mobModelUrl from '../assets/models/mob.glb?url';
import arrowModelUrl from '../assets/models/arrow.glb?url';
import pathCornerInnerModelUrl from '../assets/models/path-corner-inner.glb?url';
import pathCornerOuterModelUrl from '../assets/models/path-corner-outer.glb?url';
import pathEdgeModelUrl from '../assets/models/path-edge.glb?url';
import pathModelUrl from '../assets/models/path.glb?url';
import rock2ModelUrl from '../assets/models/rock-2.glb?url';
import rockModelUrl from '../assets/models/rock.glb?url';
import towerBallistaModelUrl from '../assets/models/tower-ballista.glb?url';
import treeModelUrl from '../assets/models/tree.glb?url';
import wallModelUrl from '../assets/models/wall.glb?url';
import smokeModelUrl from '../assets/models/smoke.glb?url';
import playerModelUrl from '../assets/models/player.glb?url';
import { screenToWorldOnGround } from '../domains/world/coords';
import { SelectionDialog } from '../ui/components/selectionDialog';
import { StructureStore } from '../domains/gameplay/structureStore';
import { createRebuildPathTileLayer } from '../domains/pathTiles';
import { getVisibleGroundBounds } from '../rendering/terrain';
import { createGroundWaterSystem } from '../rendering/terrain/groundWater';
import { createApplyStructureDamageVisuals } from '../rendering/structureDamageVisuals';
import { createCombatOverlays } from '../rendering/combatOverlays';
import { createModelLoader } from '../rendering/modelLoader';
import {
  solveBallisticIntercept,
  computeFallbackBallisticVelocity,
} from '../domains/gameplay/projectiles';
import {
  getUpgradeCoinCost,
  getRepairCost,
  getRepairStatus,
} from '../domains/gameplay/economy';
import type { DebugViewState, PlayerArrowProjectile } from '../gameContext';
import {
  getTowerType,
  getTowerUpgradeDeltaText,
  getTowerUpgradeOptions,
} from '../domains/gameplay/towers/towerTypes';
import type {
  TowerTypeId,
  TowerUpgradeId,
} from '../domains/gameplay/towers/towerTypes';
import type {
  ArrowProjectile,
  DestructibleCollider,
  Entity,
  MobEntity,
  NpcEntity,
  PlayerEntity,
  StaticCollider,
  Tower,
} from '../domains/gameplay/types/entities';
import { SpatialGrid } from '../domains/world/spatialGrid';
import { createParticleSystem } from '../rendering/effects/particles';
import { createSmokePoofEffect } from '../rendering/effects/smokePoof';
import { createMobDeathVisualSystem } from '../rendering/effects/mobDeathVisuals';
import {
  clamp,
  distanceToColliderSurface,
  resolveCircleCircle,
} from '../domains/world/collision';
import { createEntityMotionSystem } from '../domains/entities/systems/motion';
import { createGameLoop } from '../domains/gameplay/gameLoop';
import { createSpawnerPathingSystem } from '../domains/spawnerPathing';
import { createSpawnerHelpers } from '../rendering/spawnerHelpers';
import {
  canPlace as canPlaceAt,
  getBuildSize as getBuildSizeForMode,
  getWallLinePlacement as computeWallLinePlacement,
  placeBuilding as placeBuildingAt,
  placeWallSegments as placeWallSegmentsAt,
  placeWallLine as placeWallSegment,
  snapCenterToBuildGrid,
  type BuildMode,
} from '../domains/gameplay/buildingPlacement';
import { getNatureLabel } from '../../shared/natureLabels';
import {
  clearSelectionState,
  createSelectionState,
  getSelectedInRange as getSelectedInRangeFromState,
  getSelectionTowerTypeId as getSelectionTowerTypeIdFromState,
  getSingleSelectedTower as getSingleSelectedTowerFromState,
  isColliderInRange as isColliderInRangeFromState,
  setSelectedStructures as setSelectedStructuresState,
} from '../domains/selection/state';
import {
  DECAY_GRACE_MS,
  DECAY_HP_PER_HOUR,
  BALLISTA_ARROW_GRAVITY,
  BALLISTA_ARROW_DIRECT_AIM_DISTANCE,
  BALLISTA_ARROW_GRAVITY_DELAY,
  BALLISTA_ARROW_MAX_LIFETIME,
  BALLISTA_ARROW_RADIUS,
  BALLISTA_ARROW_SPEED,
  COINS_CAP,
  COINS_COST_TOWER,
  COINS_COST_WALL,
  COIN_ACCRUAL_INTERVAL_MS,
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
  REPAIR_CRITICAL_HP_RATIO,
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
} from '../domains/gameplay/constants';
import { createGameState } from '../domains/gameplay/gameState';
import { createInputController } from '../domains/gameplay/inputController';
import { updateHud } from '../rendering/presenters/hudPresenter';
import { renderVisibleMobInstances } from '../rendering/presenters/renderCoordinator';
import { createAppMarkup } from '../ui/appMarkup';
import { createDebugMenu } from '../ui/debugMenu';
import { createDomRefs } from '../ui/domRefs';
import { createCoinHudSetup } from '../rendering/coinHudSetup';
import { createThreeScene } from '../rendering/sceneSetup';
import {
  ENABLE_INCREMENTAL_SPATIAL_GRID,
  ENABLE_MOB_RENDER_LOD,
  ENABLE_PROJECTILE_BROADPHASE,
  HITBOX_LAYER,
  MOB_LOD_DISABLE_FAR_WIGGLE,
  MOB_LOD_FAR_ANIMATION_STEP_MS,
  MOB_LOD_FAR_DISTANCE,
  MOB_LOD_MID_ANIMATION_STEP_MS,
  MOB_LOD_NEAR_DISTANCE,
  MOB_STAGING_BOUNDS_PADDING,
  PATHLINE_REFRESH_BUDGET_PER_FRAME,
  RESYNC_COOLDOWN_MS,
  SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS,
  SERVER_MOB_DEAD_STALE_REMOVE_MS,
  SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS,
  SERVER_MOB_EXTRAPOLATION_MAX_MS,
  SERVER_MOB_HARD_STALE_REMOVE_MS,
  SERVER_MOB_INTERPOLATION_BACKTIME_MS,
  SERVER_MOB_POST_WAVE_STALE_REMOVE_MS,
  SNAPSHOT_STRUCTURE_GRACE_MS,
  SPAWNER_ENTRY_INSET_CELLS,
  SERVER_HEARTBEAT_INTERVAL_MS,
  SERVER_META_SYNC_INTERVAL_MS,
  SERVER_META_SYNC_RETRY_MS,
  SERVER_STRUCTURE_SYNC_INTERVAL_MS,
  SERVER_STRUCTURE_SYNC_RETRY_MS,
  STAGING_BRIDGE_LENGTH,
  STAGING_BRIDGE_PATH_WIDTH,
  STAGING_BRIDGE_WIDTH,
  STAGING_ISLAND_DISTANCE,
  STAGING_ISLAND_HEIGHT,
  STAGING_ISLAND_SIZE,
  STAGING_PLATFORM_Y,
  TOWER_TARGET_REFRESH_INTERVAL_FRAMES,
  CASTLE_ENTRY_GOAL_STRIP_HALF_WIDTH_CELLS,
  CASTLE_ROUTE_HALF_WIDTH_CELLS,
  EVENT_BANNER_DURATION,
  MOVE_INTENT_MIN_INTERVAL_MS,
} from '../clientConstants';
import {
  prepareStaticModelPreserveScale,
  prepareCoinModel,
  preparePlayerModel,
} from '../rendering/modelRegistry';
import { createVisualAppliers } from '../rendering/visualApplication';
import { computeArrowFacingFromTemplate } from '../rendering/presenters/arrowProjectile';
import {
  updateBallistaRigTracking,
  type BallistaVisualRig,
} from '../rendering/presenters/ballistaRig';
import { createArrowProjectileSystem } from '../rendering/presenters/arrowProjectileSystem';
import { connectGameSession } from '../session/connection/connectGameSession';
import {
  createWorldStateSync,
  type WorldStateSync,
} from '../session/sync/createWorldStateSync';
import { createHudUpdaters, type CoinTrail } from '../ui/hudUpdaters';
import { createDisposeScene } from '../rendering/disposeScene';
import {
  fetchCastleCoinsBalance,
  requestCastleCoinsDeposit,
  requestCastleCoinsWithdraw,
} from '../api/castleCoins';
import type { DealDamageHit } from '../../shared/game-protocol';
import { DEFAULT_PLAYER_SPAWN } from '../../shared/game-state';
import {
  assertCoinsInBounds,
  assertMobSpawnerReferences,
  assertSpawnerCounts,
  assertStructureStoreConsistency,
} from '../domains/gameplay/invariants';
import { createRandomSource, deriveSeed, hashSeed } from '../domains/world/rng';

export const bootstrapGame = (app: HTMLElement): void => {
  const WORLD_SEED_INPUT: string | number = 'alpha valley 01';
  const WORLD_SEED = hashSeed(WORLD_SEED_INPUT);
  const randomSource = createRandomSource(deriveSeed(WORLD_SEED, 'runtime'));
  const random = () => randomSource.next();
  const TOWER_BUILD_SIZE = getBuildSizeForMode('tower');
  const TREE_BUILD_SIZE = new THREE.Vector3(2, 2.4, 2);
  type TreeFootprint = 1 | 2 | 3 | 4;
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
  const debugViewState: DebugViewState = {
    worldGrid: false,
    flowField: false,
    playerShootRange: false,
  };
  const gameSessionRef: {
    current: Awaited<ReturnType<typeof connectGameSession>> | null;
  } = { current: null };
  const isServerAuthoritative = () => gameSessionRef.current !== null;
  app.innerHTML = createAppMarkup({
    coinCostWall: COINS_COST_WALL,
    coinCostTower: COINS_COST_TOWER,
  });

  const {
    waveEl,
    mobsRowEl,
    mobsPrimaryEl,
    mobsSecondaryEl,
    wallCountEl,
    towerCountEl,
    coinsCountEl,
    finalCountdownEl,
    nextWaveRowEl,
    nextWavePrimaryEl,
    nextWaveSecondaryEl,
    eventBannerEl,
    hudEl,
    hudActionsEl,
    hudStatusStackEl,
    hudCoinsEl,
    buildWallBtn,
    buildTowerBtn,
    shootButton,
    minimapWrapEl,
    minimapToggleBtn,
    coinHudCanvasEl,
    minimapCanvasEl,
    buildModeTitleEl,
    buildModeHintEl,
    buildModeCancelBtn,
    loadingScreenEl,
    loadingProgressFillEl,
    loadingProgressLabelEl,
    minimapCtx,
  } = createDomRefs(app);
  const minimapCastleIcon = new Image();
  minimapCastleIcon.src = castleIconUrl;

  const {
    coinHudScene,
    coinHudCamera,
    coinHudRenderer,
    coinHudRoot,
    coinTrailScene,
    coinTrailCamera,
    coinTrailRenderer,
  } = createCoinHudSetup({ app, coinHudCanvasEl });

  const {
    scene,
    camera,
    renderer,
    composer,
    structureOutlinePass,
    treeOutlinePass,
    hemi,
    dir,
    dirShadowFollowOffset,
    cameraOffset,
    orthoSize,
    viewportFogEl,
    worldGrid,
    worldBorder,
    spawnContainerOverlay,
    stagingIslandsOverlay,
    flowFieldDebugOverlay,
    groundTileLayer,
    pathCenterTileLayer,
    pathEdgeTileLayer,
    pathInnerCornerTileLayer,
    pathOuterCornerTileLayer,
  } = createThreeScene(app, {
    gridSize: GRID_SIZE,
    worldBounds: WORLD_BOUNDS,
    stagingIslandSize: STAGING_ISLAND_SIZE,
    stagingIslandHeight: STAGING_ISLAND_HEIGHT,
    stagingPlatformY: STAGING_PLATFORM_Y,
    stagingBridgeWidth: STAGING_BRIDGE_WIDTH,
    stagingBridgePathWidth: STAGING_BRIDGE_PATH_WIDTH,
    stagingBridgeLength: STAGING_BRIDGE_LENGTH,
  });
  const pathTilePositions = new Map<string, THREE.Vector3[]>();
  const pathTileKeys = new Set<string>();

  const {
    ground,
    groundMaterial,
    groundPlane,
    waterMesh,
    waterMaterial,
    waterDistanceFieldRef,
    updateGroundFromBounds,
    updateWaterFromBounds,
    lastGroundBoundsRef,
  } = createGroundWaterSystem({
    scene,
    pathTileKeys,
    groundTileLayer,
    stagingIslandsOverlay,
    gridSize: GRID_SIZE,
    worldBounds: WORLD_BOUNDS,
    waterLevel: WATER_LEVEL,
    waterRingOuterPadding: WATER_RING_OUTER_PADDING,
  });

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
  const castleCoinsSelectionCollider: DestructibleCollider = {
    center: castleCollider.center,
    halfSize: castleCollider.halfSize,
    type: 'castleCoins',
  };
  const castleCoinPiles = new THREE.Group();

  const rebuildPathTileLayer = createRebuildPathTileLayer({
    pathTilePositions,
    pathTileKeys,
    pathCenterTileLayer,
    pathEdgeTileLayer,
    pathInnerCornerTileLayer,
    pathOuterCornerTileLayer,
    stagingIslandsOverlay,
    castleCollider,
    updateGroundFromBounds,
    lastGroundBoundsRef,
  });
  scene.add(castleCoinPiles);

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

  const REQUIRED_MODEL_LOADS = 15;
  let hasFinishedLoadingAssets = false;
  let hasRevealedScene = false;
  let hasStartedGameLoop = false;
  let startGameWhenReady: (() => void) | null = null;

  const modelLoader = createModelLoader({
    requiredCount: REQUIRED_MODEL_LOADS,
    onProgress: (percent) => {
      loadingProgressFillEl.style.width = `${percent}%`;
      loadingProgressLabelEl.textContent = `${percent}%`;
    },
  });

  const completeLoadingAndRevealScene = () => {
    if (hasRevealedScene) return;
    hasRevealedScene = true;
    renderer.domElement.style.visibility = 'visible';
    loadingScreenEl.classList.add('is-hidden');
    window.setTimeout(() => {
      loadingScreenEl.remove();
    }, 220);
  };

  modelLoader.onAllComplete(() => {
    hasFinishedLoadingAssets = true;
    startGameWhenReady?.();
  });
  let towerModelTemplate: THREE.Object3D | null = null;
  let arrowModelTemplate: THREE.Object3D | null = null;
  let treeModelTemplate: THREE.Object3D | null = null;
  const coinModelTemplateRef = { current: null as THREE.Object3D | null };
  let wallModelTemplate: THREE.Object3D | null = null;
  let playerModelTemplate: THREE.Object3D | null = null;
  const playerFacingOffset = { value: 0 };
  let arrowFacing: {
    anchorLocalPos: THREE.Vector3;
    forwardLocal: THREE.Vector3;
  } | null = null;
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

  const {
    applyTowerVisualToMesh,
    applyTreeVisualToMesh,
    applyRockVisualToMesh,
    applyWallVisualToMesh,
    setStructureVisualScale,
  } = createVisualAppliers({
    scene,
    hitboxLayer: HITBOX_LAYER,
    towerBuildSize: TOWER_BUILD_SIZE,
    treeBuildSize: TREE_BUILD_SIZE,
    getTowerModelTemplate: () => towerModelTemplate,
    getTreeModelTemplate: () => treeModelTemplate,
    getWallModelTemplate: () => wallModelTemplate,
    getRockTemplateForPlacement: (i) => {
      const e = getRockTemplateForPlacement(i);
      return e ? { template: e.template } : null;
    },
    towerBallistaRigs,
    clampTreeFootprint,
    getTreeScaleForFootprint,
    defaultTreeFootprint: DEFAULT_TREE_FOOTPRINT,
  });

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

  const disposeCapsuleMesh = (obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.geometry && obj.material) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
  };

  modelLoader.loadModel(
    groundModelUrl,
    (gltf) => {
      groundTileLayer.setTemplate(gltf.scene);
      stagingIslandsOverlay.setGroundTemplate(gltf.scene);
      ground.visible = false;
      if (lastGroundBoundsRef.current) {
        const bounds = lastGroundBoundsRef.current;
        lastGroundBoundsRef.current = null;
        updateGroundFromBounds(bounds);
      }
    },
    (error) => {
      console.error('Failed to load ground model:', error);
    }
  );

  modelLoader.loadModel(
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

  modelLoader.loadModel(
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

  modelLoader.loadModel(
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

  modelLoader.loadModel(
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

  modelLoader.loadModel(
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

  modelLoader.loadModel(
    arrowModelUrl,
    (gltf) => {
      arrowModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
      arrowFacing = computeArrowFacingFromTemplate(arrowModelTemplate);
    },
    (error) => {
      console.error('Failed to load arrow model:', error);
    }
  );

  modelLoader.loadModel(
    treeModelUrl,
    (gltf) => {
      treeModelTemplate = prepareStaticModelPreserveScale(gltf.scene);
      for (const [
        collider,
        state,
      ] of structureStore.structureStates.entries()) {
        if (collider.type !== 'tree') continue;
        applyTreeVisualToMesh(state.mesh);
      }
    },
    (error) => {
      console.error('Failed to load tree model:', error);
    }
  );

  modelLoader.loadModel(
    rockModelUrl,
    (gltf) => {
      registerRockTemplate(rockModelUrl, gltf.scene);
      refreshAllRockVisuals(hasAllRockTemplates());
    },
    (error) => {
      console.error('Failed to load rock model:', error);
    }
  );

  modelLoader.loadModel(
    rock2ModelUrl,
    (gltf) => {
      registerRockTemplate(rock2ModelUrl, gltf.scene);
      refreshAllRockVisuals(hasAllRockTemplates());
    },
    (error) => {
      console.error('Failed to load secondary rock model:', error);
    }
  );

  modelLoader.loadModel(
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

  modelLoader.loadModel(
    coinModelUrl,
    (gltf) => {
      coinModelTemplateRef.current = prepareCoinModel(gltf.scene);
      hudUpdaters.syncHudCoinModel();
      setCoinParticleTemplate(coinModelTemplateRef.current);
    },
    (error) => {
      console.error('Failed to load coin model:', error);
    }
  );

  modelLoader.loadOptional(smokeModelUrl, (gltf) => {
    smokePoofEffect.setSmokeTemplate(
      prepareStaticModelPreserveScale(gltf.scene)
    );
  });

  modelLoader.loadModel(
    mobModelUrl,
    (gltf) => {
      applyMobVisualTemplate(gltf.scene);
    },
    (error) => {
      console.error('Failed to load mob model:', error);
    }
  );

  modelLoader.loadModel(
    playerModelUrl,
    (gltf) => {
      playerModelTemplate = preparePlayerModel(gltf.scene);
      playerModelTemplate.updateMatrixWorld(true);
      playerFacingOffset.value =
        computeFacingYawFromTemplate(playerModelTemplate);

      const swapPlayerMesh = () => {
        const savedX = player.mesh.position.x;
        const savedZ = player.mesh.position.z;
        scene.remove(player.mesh);
        disposeCapsuleMesh(player.mesh);
        player.mesh = playerModelTemplate!.clone(true);
        player.mesh.position.set(savedX, player.baseY, savedZ);
        scene.add(player.mesh);
      };

      const swapNpcMesh = (npc: NpcEntity) => {
        const savedX = npc.mesh.position.x;
        const savedZ = npc.mesh.position.z;
        scene.remove(npc.mesh);
        disposeCapsuleMesh(npc.mesh);
        npc.mesh = playerModelTemplate!.clone(true);
        npc.mesh.position.set(savedX, npc.baseY, savedZ);
        scene.add(npc.mesh);
      };

      swapPlayerMesh();
      for (const npc of npcs) swapNpcMesh(npc);
    },
    (error) => {
      console.error('Failed to load player model:', error);
    }
  );

  modelLoader.loadModel(
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
      hudUpdaters.updateCastleCoinPilesVisual();
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
      hudUpdaters.updateCastleCoinPilesVisual();
      refreshAllSpawnerPathlines();
    }
  );
  const mobs: MobEntity[] = [];
  const towers: Tower[] = [];
  const activeArrowProjectiles: ArrowProjectile[] = [];
  const activePlayerArrowProjectiles: PlayerArrowProjectile[] = [];
  let selectedTower: Tower | null = null;
  const smokePoofEffect = createSmokePoofEffect(scene);
  const spawnerHelpers = createSpawnerHelpers({
    gridSize: GRID_SIZE,
    worldBounds: WORLD_BOUNDS,
    spawnerEntryInsetCells: SPAWNER_ENTRY_INSET_CELLS,
    stagingIslandDistance: STAGING_ISLAND_DISTANCE,
    stagingIslandSize: STAGING_ISLAND_SIZE,
  });
  const spawnerPathing = createSpawnerPathingSystem(
    {
      scene,
      gridSize: GRID_SIZE,
      worldBounds: WORLD_BOUNDS,
      staticColliders,
      castleCollider,
      castleFrontDirection: CASTLE_FRONT_DIRECTION,
      castleEntryGoalStripHalfWidthCells:
        CASTLE_ENTRY_GOAL_STRIP_HALF_WIDTH_CELLS,
      castleRouteHalfWidthCells: CASTLE_ROUTE_HALF_WIDTH_CELLS,
      stagingIslandSize: STAGING_ISLAND_SIZE,
      pathlineRefreshBudgetPerFrame: PATHLINE_REFRESH_BUDGET_PER_FRAME,
      spawnerHelpers,
      stagingIslandsOverlay,
      spawnContainerOverlay,
      flowFieldDebugOverlay,
      showFlowFieldDebug: () => debugViewState.flowField,
      pathTilePositions,
      rebuildPathTileLayer,
      isServerAuthoritative,
    },
    mobs
  );
  const {
    activeWaveSpawners,
    spawnerById,
    spawnerPathlineCache,
    spawnerRouteOverlay,
    getCastleFlowField,
    invalidateCastleFlowField,
    refreshAllSpawnerPathlines,
    applyObstacleDelta,
    renderAllCardinalStagingIslands,
    clampStagedMobToSpawnerIsland,
    toCastleDisplayPoints,
    clearWaveOverlays,
  } = spawnerPathing;
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
    (added, removed = []) => applyObstacleDelta(added, removed),
    (pos) => smokePoofEffect.spawnSmokePoof(pos)
  );

  const applyStructureDamageVisuals = createApplyStructureDamageVisuals({
    structureStore,
    repairWarningHpRatio: REPAIR_WARNING_HP_RATIO,
    repairCriticalHpRatio: REPAIR_CRITICAL_HP_RATIO,
  });

  const markPersistentMapFeature = (mesh: THREE.Mesh) => {
    mesh.userData.persistOnReset = true;
  };

  // Initialize spatial grid and lane path caches
  const spatialGrid = new SpatialGrid(SPATIAL_GRID_CELL_SIZE);
  const collisionNearbyScratch: Entity[] = [];

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

  const {
    worldToScreen,
    arrow,
    selectionArrow,
    selectionArrowScratch,
    shaftGeometry,
    shaftMaterial,
    headGeometry,
    headMaterial,
    towerRangeMaterial,
    playerShootRangeRing,
    spawnFloatingDamageText,
    updateFloatingDamageTexts,
    updateHealthBars,
  } = createCombatOverlays({
    scene,
    camera,
    app,
    structureStore,
    playerShootRange: PLAYER_SHOOT_RANGE,
    showPlayerShootRange: debugViewState.playerShootRange,
  });

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(HITBOX_LAYER);
  const pointer = new THREE.Vector2();

  const player: PlayerEntity = {
    mesh: new THREE.Group(),
    radius: PLAYER_COLLISION_RADIUS,
    speed: PLAYER_SPEED,
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(0, 0, 0),
    kind: 'player',
    baseY: 0,
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
  const makeNpc = (pos: THREE.Vector3, _color: number, username: string) => {
    const mesh =
      playerModelTemplate !== null
        ? playerModelTemplate.clone(true)
        : new THREE.Group();
    const npc: NpcEntity = {
      mesh,
      radius: PLAYER_COLLISION_RADIUS,
      speed: NPC_SPEED,
      velocity: new THREE.Vector3(),
      target: pos.clone(),
      kind: 'npc',
      baseY: 0,
      username,
    };
    npc.mesh.position.copy(pos).setY(npc.baseY);
    scene.add(npc.mesh);
    npcs.push(npc);
    return npc;
  };

  let sessionDataReady = false;
  const selfPlayerIdRef = { current: '' as string | null };
  let lastNetworkHeartbeatAt = 0;
  let lastMoveIntentSentAt = 0;
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
  const serverMobMaxHpCache = new Map<string, number>();
  const serverWaveActiveRef = { current: false };
  const serverStructureSyncInFlightRef = { current: false };
  const serverMetaSyncInFlightRef = { current: false };
  const resyncInProgressRef = { current: false };
  let lastResyncAttemptedAt = 0;
  const pendingDamageHits: DealDamageHit[] = [];
  let nextServerStructureSyncAtMs =
    performance.now() + SERVER_STRUCTURE_SYNC_INTERVAL_MS;
  let nextServerMetaSyncAtMs = performance.now() + SERVER_META_SYNC_INTERVAL_MS;
  const COIN_ACCRUAL_INTERVAL_SEC = COIN_ACCRUAL_INTERVAL_MS / 1000;
  let clientCoinAccrualRemainderSec = 0;
  let lastKnownWorldVersion = 0;
  let lastAppliedStructureChangeSeq = 0;
  let lastSnapshotReceivedAtMs = 0;
  let worldStateSync: WorldStateSync;

  const setupAuthoritativeBridge = async () => {
    if (gameSessionRef.current) {
      return;
    }
    try {
      if (!worldStateSync) {
        worldStateSync = createWorldStateSync({
          mobs,
          npcs,
          selectedStructures,
          gameState,
          serverStructureById,
          serverMobsById,
          serverMobInterpolationById,
          serverMobSampleById,
          serverMobMaxHpCache,
          remotePlayersById,
          activeWaveSpawners,
          spawnerById,
          serverWaveActiveRef,
          structureStore,
          scene,
          staticColliders,
          selfPlayerIdRef,
          mobLogicGeometry,
          mobLogicMaterial,
          MOB_HEIGHT,
          MOB_WIDTH,
          MOB_SPEED,
          createTowerAt,
          applyWallVisualToMesh,
          applyTreeVisualToMesh,
          applyRockVisualToMesh,
          getBuildSizeForMode,
          snapCenterToBuildGrid,
          getTreeBuildSizeForFootprint,
          clampTreeFootprint,
          HITBOX_LAYER,
          ROCK_BASE_HEIGHT,
          clearWaveOverlays,
          rebuildPathTileLayer,
          refreshAllSpawnerPathlines,
          toCastleDisplayPoints,
          spawnerHelpers,
          spawnerRouteOverlay,
          spawnContainerOverlay,
          stagingIslandsOverlay,
          pathTilePositions,
          spawnerPathlineCache,
          makeNpc,
          spawnMobDeathVisual,
          isServerAuthoritative,
          getWallModelTemplate: () => wallModelTemplate,
          getTreeModelTemplate: () => treeModelTemplate,
          WORLD_BOUNDS,
          CASTLE_ROUTE_HALF_WIDTH_CELLS,
          COINS_CAP,
          SERVER_MOB_INTERPOLATION_BACKTIME_MS,
          SERVER_MOB_EXTRAPOLATION_MAX_MS,
          SERVER_MOB_EXTRAPOLATION_GAP_MAX_MS,
          SERVER_MOB_DEAD_STALE_REMOVE_MS,
          SERVER_MOB_ACTIVE_WAVE_STALE_REMOVE_MS,
          SERVER_MOB_POST_WAVE_STALE_REMOVE_MS,
          SERVER_MOB_HARD_STALE_REMOVE_MS,
        });
      }
      gameSessionRef.current = await connectGameSession({
        onSnapshot: (snapshot, options) => {
          lastSnapshotReceivedAtMs = performance.now();
          nextServerStructureSyncAtMs =
            lastSnapshotReceivedAtMs + SNAPSHOT_STRUCTURE_GRACE_MS;
          worldStateSync.syncServerClockSkew(snapshot.meta.lastTickMs);
          worldStateSync.applyServerSnapshot(snapshot, options);
          lastKnownWorldVersion = snapshot.meta.worldVersion;
          lastAppliedStructureChangeSeq =
            snapshot.meta.lastStructureChangeTickSeq ?? 0;
          sessionDataReady = true;
          startGameWhenReady?.();
        },
        onSelfReady: (playerId, username, position) => {
          selfPlayerIdRef.current = playerId;
          player.username = username;
          player.mesh.position.set(position.x, player.baseY, position.z);
          player.target.set(position.x, 0, position.z);
          lastMoveIntentTarget.x = position.x;
          lastMoveIntentTarget.z = position.z;
        },
        onRemoteJoin: (playerId, username, position) => {
          worldStateSync.upsertRemoteNpc(playerId, username, position);
        },
        onRemoteLeave: (playerId) => {
          worldStateSync.removeRemoteNpc(playerId);
        },
        onPlayerMove: (playerId, username, next) => {
          worldStateSync.upsertRemoteNpc(playerId, username, next);
        },
        onSelfPositionFromServer: (position) => {
          const dx = position.x - player.mesh.position.x;
          const dz = position.z - player.mesh.position.z;
          const distSq = dx * dx + dz * dz;
          const EMIT_THRESHOLD_SQ = 1;
          const nowMs = performance.now();
          if (
            distSq > EMIT_THRESHOLD_SQ &&
            gameSessionRef.current &&
            nowMs - lastMoveIntentSentAt >= MOVE_INTENT_MIN_INTERVAL_MS
          ) {
            lastMoveIntentSentAt = nowMs;
            const pos = {
              x: player.mesh.position.x,
              z: player.mesh.position.z,
            };
            lastMoveIntentTarget.x = pos.x;
            lastMoveIntentTarget.z = pos.z;
            void gameSessionRef.current.sendMoveIntent(pos, pos);
          }
        },
        onMobDelta: (delta, { batchTickSeq }) => {
          worldStateSync.applyServerMobDelta(delta, batchTickSeq);
        },
        onStructureDelta: (delta, { batchTickSeq }) => {
          worldStateSync.applyServerStructureDelta(delta, batchTickSeq);
        },
        onWaveDelta: (delta, { batchTickSeq, serverTimeMs }) => {
          worldStateSync.applyServerWaveDelta(
            delta,
            batchTickSeq,
            serverTimeMs
          );
        },
        onCoinBalance: (coins) => {
          gameState.coins = Math.max(0, Math.min(COINS_CAP, coins));
        },
        onResyncRequired: (reason) => {
          if (reason === 'castle death' && hudUpdaters.triggerEventBanner) {
            hudUpdaters.triggerEventBanner('Castle fell - Game over!', 4);
          }
          if (!gameSessionRef.current) return;
          const now = performance.now();
          const skipCooldown =
            reason === 'castle death' || reason === 'game reset';
          if (
            !skipCooldown &&
            (resyncInProgressRef.current ||
              (lastResyncAttemptedAt > 0 &&
                now - lastResyncAttemptedAt < RESYNC_COOLDOWN_MS))
          ) {
            return;
          }
          resyncInProgressRef.current = true;
          lastResyncAttemptedAt = now;
          const bridge = gameSessionRef.current;
          const RESYNC_ATTEMPTS = 3;
          const RESYNC_INITIAL_DELAY_MS = skipCooldown ? 0 : 300;
          const attemptResync = (attempt: number) => {
            const delayMs =
              attempt === 0
                ? RESYNC_INITIAL_DELAY_MS
                : RESYNC_INITIAL_DELAY_MS * Math.pow(2, attempt);
            setTimeout(() => {
              if (!gameSessionRef.current) {
                resyncInProgressRef.current = false;
                return;
              }
              void bridge
                .resync()
                .catch((error) => {
                  console.error('Failed to resync session snapshot', error);
                  if (attempt < RESYNC_ATTEMPTS - 1) {
                    attemptResync(attempt + 1);
                  } else {
                    resyncInProgressRef.current = false;
                    console.warn('Resync failed - refresh to try again');
                  }
                })
                .then(() => {
                  resyncInProgressRef.current = false;
                });
            }, delayMs);
          };
          attemptResync(0);
        },
        onResetBanner: (reason) => {
          const bannerText =
            reason === 'castle death'
              ? 'Castle fell - Game over!'
              : 'Game reset';
          hudUpdaters.triggerEventBanner(bannerText, 4);
        },
        onHeartbeatWaveState: (wave, active, nextWaveAtMs, serverTimeMs) => {
          worldStateSync.applyServerWaveTiming(
            wave,
            active,
            nextWaveAtMs,
            serverTimeMs
          );
        },
      });
      nextServerStructureSyncAtMs =
        performance.now() + SERVER_STRUCTURE_SYNC_INTERVAL_MS;
      nextServerMetaSyncAtMs = performance.now() + SERVER_META_SYNC_INTERVAL_MS;
      serverStructureSyncInFlightRef.current = false;
      serverMetaSyncInFlightRef.current = false;
      void syncCastleCoinsFromServer();
    } catch (error) {
      console.error('Failed to connect game session', error);
      sessionDataReady = false;
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
      if (collider.type === 'castleCoins') {
        structureSelectedObjects.push(castle);
        if (castleCoinPiles.children.length > 0) {
          structureSelectedObjects.push(castleCoinPiles);
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

  const gameState = createGameState(COINS_CAP);
  let isDraggingWall = false;
  let wallDragStart: THREE.Vector3 | null = null;
  let wallDragEnd: THREE.Vector3 | null = null;
  let wallDragValidPositions: THREE.Vector3[] = [];
  const inputController = createInputController();
  const keyboardForward = new THREE.Vector3();
  const keyboardRight = new THREE.Vector3();
  const keyboardMoveDir = new THREE.Vector3();
  let wasKeyboardMoving = false;

  type TreeRegrowCandidate = {
    center: THREE.Vector3;
    halfSize: THREE.Vector3;
    dueAtMs: number;
  };

  type GrowingTree = {
    mesh: THREE.Mesh;
    startedAtMs: number;
  };

  const getStructureIdFromCollider = (
    collider: DestructibleCollider
  ): string | null => {
    for (const [structureId, c] of serverStructureById.entries()) {
      if (c === collider) return structureId;
    }
    return null;
  };

  const treeRegrowQueue: TreeRegrowCandidate[] = [];
  const growingTrees: GrowingTree[] = [];

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

  const usernameContainer = document.createElement('div');
  usernameContainer.style.position = 'fixed';
  usernameContainer.style.top = '0';
  usernameContainer.style.left = '0';
  usernameContainer.style.width = '100%';
  usernameContainer.style.height = '100%';
  usernameContainer.style.pointerEvents = 'none';
  usernameContainer.style.zIndex = '1001';
  app.appendChild(usernameContainer);

  const activeCoinTrails: CoinTrail[] = [];
  const isMinimapExpandedRef = { current: false };
  const minimapEmbellishAlphaRef = { current: 0 };
  const mobDeathVisuals = createMobDeathVisualSystem(scene);
  const clearMobDeathVisuals = mobDeathVisuals.clear;
  const spawnMobDeathVisual = (mob: MobEntity) =>
    mobDeathVisuals.spawn(
      mob,
      mobDeathVisualTemplate,
      mobInstanceGroundOffsetY,
      mobInstanceHeadingOffset
    );
  const updateMobDeathVisuals = mobDeathVisuals.update;

  const addCoins = (amount: number, withPop = false) => {
    if (isServerAuthoritative()) return;
    gameState.coins = Math.min(COINS_CAP, gameState.coins + amount);
    if (withPop) {
      gameState.coinsPopTimer = 0.2;
    }
  };

  const hudUpdaters = createHudUpdaters({
    coinHudCanvasEl,
    hudCoinsEl,
    coinHudRenderer,
    coinHudCamera,
    coinHudRoot,
    coinHudScene,
    coinModelTemplateRef,
    minimapCanvasEl,
    minimapCtx,
    minimapCastleIcon,
    coinTrailRenderer,
    coinTrailCamera,
    coinTrailScene,
    eventBannerEl,
    castleCoinPiles,
    castleCollider,
    camera,
    player,
    mobs,
    structureStore,
    gameState,
    activeCoinTrails,
    WORLD_BOUNDS,
    isMinimapExpandedRef,
    minimapEmbellishAlphaRef,
    EVENT_BANNER_DURATION,
    REPAIR_WARNING_HP_RATIO,
    REPAIR_CRITICAL_HP_RATIO,
    addCoins,
  });

  const spendCoins = (amount: number) => {
    if (isServerAuthoritative()) return false;
    if (gameState.coins < amount) return false;
    gameState.coins = Math.max(0, gameState.coins - amount);
    return true;
  };

  const getSelectedCastleInRange = () => {
    const [collider] = selectedStructures.values();
    if (!collider || collider.type !== 'castleCoins') return null;
    if (!isColliderInRange(collider, SELECTION_RADIUS)) return null;
    return collider;
  };

  const syncCastleCoinsFromServer = async () => {
    const castleCoins = await fetchCastleCoinsBalance();
    if (castleCoins === null) return;
    gameState.castleCoins = castleCoins;
    hudUpdaters.updateCastleCoinPilesVisual();
  };

  const depositToCastle = async (requestedAmount: number) => {
    const serverAuthoritative = isServerAuthoritative();
    const transfer = serverAuthoritative
      ? Math.max(0, Math.floor(requestedAmount))
      : Math.min(
          Math.max(0, Math.floor(requestedAmount)),
          Math.max(0, Math.floor(gameState.coins))
        );
    if (transfer <= 0) return false;
    if (!serverAuthoritative) {
      const previousBank = gameState.castleCoins;
      const previousEnergy = gameState.coins;
      gameState.castleCoins += transfer;
      gameState.coins = Math.max(0, gameState.coins - transfer);
      hudUpdaters.updateCastleCoinPilesVisual();
      const response = await requestCastleCoinsDeposit(transfer);
      if (response === null) {
        gameState.castleCoins = previousBank;
        gameState.coins = previousEnergy;
        hudUpdaters.updateCastleCoinPilesVisual();
        hudUpdaters.triggerEventBanner('Deposit failed');
        return false;
      }
      gameState.castleCoins = Number.isFinite(response.castleCoins)
        ? Math.max(0, Math.floor(response.castleCoins))
        : gameState.castleCoins;
      hudUpdaters.updateCastleCoinPilesVisual();
      gameState.coinsPopTimer = 0.2;
      hudUpdaters.spawnCastleCoinTrails(Math.floor(transfer), 'toCastle');
      return true;
    }
    const response = await requestCastleCoinsDeposit(transfer);
    if (response === null) {
      hudUpdaters.triggerEventBanner('Deposit failed');
      return false;
    }
    gameState.castleCoins = Number.isFinite(response.castleCoins)
      ? Math.max(0, Math.floor(response.castleCoins))
      : gameState.castleCoins;
    if (Number.isFinite(response.coins)) {
      gameState.coins = Math.max(0, Math.min(COINS_CAP, response.coins));
    }
    hudUpdaters.updateCastleCoinPilesVisual();
    gameState.coinsPopTimer = 0.2;
    hudUpdaters.spawnCastleCoinTrails(
      Math.floor(response.deposited),
      'toCastle'
    );
    void gameSessionRef.current?.heartbeat({
      x: player.mesh.position.x,
      z: player.mesh.position.z,
    });
    return true;
  };

  const withdrawFromCastle = async (requestedAmount: number) => {
    const serverAuthoritative = isServerAuthoritative();
    const missing = Math.max(0, COINS_CAP - gameState.coins);
    const transfer = Math.min(
      Math.max(0, Math.floor(requestedAmount)),
      Math.max(0, Math.floor(gameState.castleCoins)),
      serverAuthoritative ? Number.POSITIVE_INFINITY : missing
    );
    if (transfer <= 0) return false;
    if (!serverAuthoritative) {
      const previousBank = gameState.castleCoins;
      const previousEnergy = gameState.coins;
      gameState.castleCoins = Math.max(0, gameState.castleCoins - transfer);
      addCoins(transfer, true);
      hudUpdaters.updateCastleCoinPilesVisual();
      const response = await requestCastleCoinsWithdraw(transfer);
      if (response === null) {
        gameState.castleCoins = previousBank;
        gameState.coins = previousEnergy;
        hudUpdaters.updateCastleCoinPilesVisual();
        hudUpdaters.triggerEventBanner('Withdraw failed');
        return false;
      }
      gameState.castleCoins = Number.isFinite(response.castleCoins)
        ? Math.max(0, Math.floor(response.castleCoins))
        : gameState.castleCoins;
      hudUpdaters.updateCastleCoinPilesVisual();
      hudUpdaters.spawnCastleCoinTrails(
        Math.floor(response.withdrawn),
        'toHud'
      );
      return true;
    }
    const response = await requestCastleCoinsWithdraw(transfer);
    if (response === null) {
      hudUpdaters.triggerEventBanner('Withdraw failed');
      return false;
    }
    gameState.castleCoins = Number.isFinite(response.castleCoins)
      ? Math.max(0, Math.floor(response.castleCoins))
      : gameState.castleCoins;
    if (Number.isFinite(response.coins)) {
      gameState.coins = Math.max(0, Math.min(COINS_CAP, response.coins));
    }
    hudUpdaters.updateCastleCoinPilesVisual();
    hudUpdaters.spawnCastleCoinTrails(Math.floor(response.withdrawn), 'toHud');
    void gameSessionRef.current?.heartbeat({
      x: player.mesh.position.x,
      z: player.mesh.position.z,
    });
    return true;
  };

  const towerArrowGravity = new THREE.Vector3(0, -BALLISTA_ARROW_GRAVITY, 0);
  const towerLaunchPosScratch = new THREE.Vector3();
  const towerLaunchQuatScratch = new THREE.Quaternion();
  const towerTargetPosScratch = new THREE.Vector3();
  const playerLaunchPosScratch = new THREE.Vector3();
  const playerTargetPosScratch = new THREE.Vector3();
  const projectileHitDirectionScratch = new THREE.Vector3();
  let tickFrameCounter = 0;
  let cachedSelectedMob: Entity | null = null;
  const cachedTowerTargets = new WeakMap<Tower, Entity | null>();
  const trackedDynamicEntities = new Set<Entity>();
  const MOB_HIT_FLASH_MS = 120;
  const setMobLastHitDirection = (
    mob: MobEntity,
    primaryDirection: THREE.Vector3,
    fallbackDirection?: THREE.Vector3
  ) => {
    projectileHitDirectionScratch.set(
      primaryDirection.x,
      0,
      primaryDirection.z
    );
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

  const {
    spawnTowerArrowProjectile,
    spawnPlayerArrowProjectile,
    updateTowerArrowProjectiles,
    updatePlayerArrowProjectiles,
    getTowerLaunchTransform,
    pickMobInRange,
    pickSelectedMob,
  } = createArrowProjectileSystem({
    scene,
    spatialGrid,
    mobs,
    player,
    activeArrowProjectiles,
    activePlayerArrowProjectiles,
    towerBallistaRigs,
    getArrowModelTemplate: () => arrowModelTemplate,
    getArrowFacing: () => arrowFacing,
    getTowerArrowGravity: () => towerArrowGravity,
    isServerAuthoritative,
    markMobHitFlash,
    spawnFloatingDamageText,
    setMobLastHitDirection: (mob, step, velocity) =>
      setMobLastHitDirection(mob, step, velocity),
    sendDealDamage: (mobId, damage, source, playerId) => {
      pendingDamageHits.push({ mobId, damage, source, playerId });
    },
    getPlayerId: () =>
      gameSessionRef.current?.playerId ?? selfPlayerIdRef.current ?? '',
    towerHeight: TOWER_HEIGHT,
    mobWidth: MOB_WIDTH,
    playerShootRange: PLAYER_SHOOT_RANGE,
    gravityDelay: BALLISTA_ARROW_GRAVITY_DELAY,
    arrowRadius: BALLISTA_ARROW_RADIUS,
    arrowMaxLifetime: BALLISTA_ARROW_MAX_LIFETIME,
    shootDamage: SHOOT_DAMAGE,
    enableProjectileBroadphase: ENABLE_PROJECTILE_BROADPHASE,
  });

  const usernameLabelPool: HTMLDivElement[] = [];
  const createUsernameLabel = (): HTMLDivElement => {
    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.transform = 'translate(-50%, -100%)';
    label.style.color = '#fff';
    label.style.fontFamily = 'inherit';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
    label.style.whiteSpace = 'nowrap';
    label.style.pointerEvents = 'none';
    return label;
  };

  const updateUsernameLabels = () => {
    const entities = [player, ...npcs].filter((e) => e.username);
    while (usernameLabelPool.length < entities.length) {
      usernameLabelPool.push(createUsernameLabel());
    }
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      const label = usernameLabelPool[i]!;
      const screenPos = worldToScreen(
        entity.mesh.position.clone().setY(PLAYER_HEIGHT * 0.5 + 1.0)
      );
      if (!screenPos) {
        label.style.display = 'none';
        continue;
      }
      label.textContent = entity.username;
      label.style.left = `${screenPos.x}px`;
      label.style.top = `${screenPos.y}px`;
      label.style.display = '';
      if (!label.parentNode) usernameContainer.appendChild(label);
    }
    for (let i = entities.length; i < usernameLabelPool.length; i++) {
      usernameLabelPool[i]!.style.display = 'none';
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
    if (mode === 'wall') return gameState.coins >= COINS_COST_WALL;
    if (mode === 'tower') return gameState.coins >= COINS_COST_TOWER;
    return true;
  };

  const SCENE_BG_DEFAULT = 0x10151a;
  const SCENE_BG_BUILD = 0x081018;
  const HEMI_SKY_DEFAULT = 0xbfd6ff;
  const HEMI_SKY_BUILD = 0x5a80c0;

  const setBuildMode = (mode: BuildMode) => {
    if (mode !== 'off' && !canAffordBuildMode(mode)) {
      hudUpdaters.triggerEventBanner('Not enough coins');
      return;
    }
    if (gameState.buildMode === mode) {
      gameState.buildMode = 'off';
    } else {
      gameState.buildMode = mode;
    }

    const active = gameState.buildMode !== 'off';

    buildWallBtn.classList.toggle('active', gameState.buildMode === 'wall');
    buildTowerBtn.classList.toggle('active', gameState.buildMode === 'tower');
    buildPreview.visible = active;

    hudEl.classList.toggle('is-build-mode', active);
    viewportFogEl.classList.toggle('is-build-mode', active);

    if (active) {
      clearSelectionState(selection);
      selectedTower = selection.selectedTower;

      const isWall = gameState.buildMode === 'wall';
      buildModeTitleEl.textContent = isWall ? 'Place Wall' : 'Place Tower';
      buildModeHintEl.textContent = isWall
        ? 'Drag to place a line'
        : 'Tap to place';

      (scene.background as THREE.Color).setHex(SCENE_BG_BUILD);
      hemi.color.setHex(HEMI_SKY_BUILD);

      worldGrid.setBuildMode(true);
      worldGrid.setVisible(true);
      worldGrid.update(getVisibleGroundBounds(camera, GRID_SIZE));
    } else {
      (scene.background as THREE.Color).setHex(SCENE_BG_DEFAULT);
      hemi.color.setHex(HEMI_SKY_DEFAULT);

      worldGrid.setBuildMode(false);
      worldGrid.setVisible(debugViewState.worldGrid);
    }

    isDraggingWall = false;
    wallDragStart = null;
    wallDragEnd = null;
    wallDragValidPositions = [];
  };

  let minimapEmbellishTargetAlpha = 0;
  const MINIMAP_EMBELLISH_FADE_SPEED = 11;

  const setMinimapExpanded = (expanded: boolean) => {
    if (isMinimapExpandedRef.current === expanded) return;
    isMinimapExpandedRef.current = expanded;
    minimapEmbellishTargetAlpha = expanded ? 1 : 0;
    minimapWrapEl.classList.toggle('is-expanded', expanded);
    if (expanded) minimapWrapEl.classList.remove('is-hover');
    hudStatusStackEl.style.display = expanded ? 'none' : '';
    updateHudCoinsVisibility();
    hudActionsEl.style.display = expanded ? 'none' : '';
    minimapToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    minimapToggleBtn.setAttribute(
      'aria-label',
      expanded ? 'Minimap expanded' : 'Expand minimap'
    );
    // Wait for the CSS size transition frame so the canvas can resize to the new bounds.
    window.requestAnimationFrame(() => {
      hudUpdaters.syncMinimapCanvasSize();
    });
    window.setTimeout(() => {
      hudUpdaters.syncMinimapCanvasSize();
    }, 260);
  };

  const updateMinimapEmbellishAlpha = (delta: number) => {
    const blend = Math.min(1, delta * MINIMAP_EMBELLISH_FADE_SPEED);
    minimapEmbellishAlphaRef.current +=
      (minimapEmbellishTargetAlpha - minimapEmbellishAlphaRef.current) * blend;
    if (
      Math.abs(
        minimapEmbellishTargetAlpha - minimapEmbellishAlphaRef.current
      ) <= 0.002
    ) {
      minimapEmbellishAlphaRef.current = minimapEmbellishTargetAlpha;
    }
    minimapWrapEl.style.setProperty(
      '--hud-minimap-embellish-alpha',
      minimapEmbellishAlphaRef.current.toFixed(3)
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
      isCastleSelected: false,
      selectedTowerTypeId: null,
      selectedStructureLabel: 'Wall',
      castleTotal: null,
      canCastleAdd1: false,
      canCastleAdd10: false,
      canCastleRemove1: false,
      canCastleRemove10: false,
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
        if (colliders.some((collider) => collider.type === 'castleCoins'))
          return;
        for (const collider of colliders) {
          if (gameSessionRef.current) {
            const structureId = getStructureIdFromCollider(collider);
            if (structureId) {
              void gameSessionRef.current
                .sendRemoveStructure(structureId)
                .then((response) => {
                  if (!response.accepted) {
                    hudUpdaters.triggerEventBanner(
                      response.reason ?? 'Remove failed'
                    );
                  }
                })
                .catch(() => {
                  hudUpdaters.triggerEventBanner('Remove failed');
                });
            }
          }
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
        const upgradeCost = getUpgradeCoinCost(upgradeId);
        if (!spendCoins(upgradeCost)) {
          hudUpdaters.triggerEventBanner(`Need ${upgradeCost} coins`);
          return;
        }
        applyTowerUpgrade(tower, upgradeId);
        const state = structureStore.structureStates.get(collider);
        if (state) {
          state.cumulativeBuildCost =
            Math.max(0, state.cumulativeBuildCost ?? COINS_COST_TOWER) +
            upgradeCost;
        }
        hudUpdaters.triggerEventBanner('Upgraded');
      },
      onRepair: () => {
        const [collider] = selectedStructures.values();
        if (!collider) return;
        if (
          collider.type === 'tree' ||
          collider.type === 'rock' ||
          collider.type === 'castleCoins'
        )
          return;
        if (!isColliderInRange(collider, SELECTION_RADIUS)) return;
        const state = structureStore.structureStates.get(collider);
        if (!state) return;
        if (state.hp >= state.maxHp) return;
        const repairCost = getRepairCost(state);
        if (!spendCoins(repairCost)) {
          hudUpdaters.triggerEventBanner(`Need ${repairCost} coins`);
          return;
        }
        state.hp = state.maxHp;
        state.lastDecayTickMs = Date.now();
        state.graceUntilMs = Date.now() + DECAY_GRACE_MS;
        hudUpdaters.triggerEventBanner('Repaired');
      },
      onCastleAdd1: () => {
        if (!getSelectedCastleInRange()) return;
        void depositToCastle(1);
      },
      onCastleAdd10: () => {
        if (!getSelectedCastleInRange()) return;
        void depositToCastle(10);
      },
      onCastleRemove1: () => {
        if (!getSelectedCastleInRange()) return;
        void withdrawFromCastle(1);
      },
      onCastleRemove10: () => {
        if (!getSelectedCastleInRange()) return;
        void withdrawFromCastle(10);
      },
    }
  );

  const debugMenu = createDebugMenu({
    app,
    debugViewState,
    playerShootRangeRing,
    worldGrid,
    flowFieldDebugOverlay,
    getCastleFlowField,
    triggerEventBanner: (text, duration) =>
      hudUpdaters.triggerEventBanner(text, duration),
  });

  const SELECTION_DIALOG_UPDATE_INTERVAL_MS = 100;
  let nextSelectionDialogUpdateAt = 0;
  let isSelectionDialogHudMode = false;

  const setSelectionDialogHudMode = (dialogVisible: boolean) => {
    if (isSelectionDialogHudMode === dialogVisible) return;
    isSelectionDialogHudMode = dialogVisible;
    hudEl.classList.toggle('is-dialog-mode', dialogVisible);
  };

  const updateHudCoinsVisibility = () => {
    if (isMinimapExpandedRef.current) {
      hudCoinsEl.style.display = 'none';
      return;
    }
    if (isSelectionDialogHudMode) {
      const [collider] = selectedStructures.values();
      const type = collider?.type;
      const hideForSelection =
        type === 'tree' || type === 'rock' || type === 'wall';
      hudCoinsEl.style.display = hideForSelection ? 'none' : '';
      return;
    }
    hudCoinsEl.style.display = '';
  };

  const updateSelectionDialog = () => {
    const selectedCount = selectedStructures.size;
    if (selectedCount === 0) {
      setSelectionDialogHudMode(false);
      updateHudCoinsVisibility();
      hudActionsEl.style.display = isMinimapExpandedRef.current ? 'none' : '';
      selectionDialog.update({
        selectedCount: 0,
        inRangeCount: 0,
        isCastleSelected: false,
        selectedTowerTypeId: null,
        selectedStructureLabel: 'Wall',
        castleTotal: null,
        canCastleAdd1: false,
        canCastleAdd10: false,
        canCastleRemove1: false,
        canCastleRemove10: false,
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
    setSelectionDialogHudMode(inRange.length > 0);
    updateHudCoinsVisibility();
    hudActionsEl.style.display = isMinimapExpandedRef.current
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
    const isCastleSelected = selectedType === 'castleCoins';
    const maxDepositable = Math.max(0, Math.floor(gameState.coins));
    const maxWithdrawable = Math.max(
      0,
      Math.min(
        Math.floor(gameState.castleCoins),
        Math.floor(COINS_CAP - gameState.coins)
      )
    );
    const canDeposit =
      isCastleSelected && inRange.length > 0 && maxDepositable > 0;
    const canWithdraw =
      isCastleSelected && inRange.length > 0 && maxWithdrawable > 0;
    const isNatureSelected = selectedType === 'tree' || selectedType === 'rock';
    const selectedIsPlayerBuilt = selectedStructureState?.playerBuilt === true;
    const selectedHpRounded = selectedStructureState
      ? Math.max(0, Math.ceil(selectedStructureState.hp))
      : null;
    const selectedCastleTotalRounded = isCastleSelected
      ? Math.floor(gameState.castleCoins)
      : null;
    const selectedTowerTypeId = getSelectionTowerTypeId();
    const selectedStructureLabel =
      selectedType === 'tree' && selectedCollider
        ? getNatureLabel(
            'tree',
            Math.floor(
              selectedCollider.center.x * 31 + selectedCollider.center.z
            )
          )
        : selectedType === 'rock' && selectedCollider
          ? getNatureLabel(
              'rock',
              Math.floor(
                selectedCollider.center.x * 31 + selectedCollider.center.z
              )
            )
          : selectedType === 'castleCoins'
            ? 'Castle'
            : 'Wall';
    const upgradeOptions =
      !isCastleSelected && tower
        ? getTowerUpgradeOptions(tower).map((option) => ({
            id: option.id,
            label: option.label,
            deltaText: getTowerUpgradeDeltaText(option.id),
            cost: getUpgradeCoinCost(option.id),
            canAfford: gameState.coins >= getUpgradeCoinCost(option.id),
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
      isCastleSelected,
      selectedTowerTypeId,
      selectedStructureLabel,
      castleTotal: selectedCastleTotalRounded,
      canCastleAdd1: canDeposit,
      canCastleAdd10: canDeposit && maxDepositable >= 10,
      canCastleRemove1: canWithdraw,
      canCastleRemove10: canWithdraw && maxWithdrawable >= 10,
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
        !isCastleSelected
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
        !isCastleSelected &&
        selectedStructureState !== null &&
        selectedStructureState.hp < selectedStructureState.maxHp &&
        selectedIsPlayerBuilt &&
        inRange.length > 0 &&
        repairCost !== null &&
        gameState.coins >= repairCost,
      canDelete: !isCastleSelected && inRange.length > 0,
      repairCost,
      repairStatus,
    });
  };

  buildWallBtn.addEventListener('click', () => setBuildMode('wall'));
  buildTowerBtn.addEventListener('click', () => setBuildMode('tower'));
  buildModeCancelBtn.addEventListener('click', () => setBuildMode('off'));
  minimapToggleBtn.addEventListener('click', () => {
    if (isMinimapExpandedRef.current) return;
    clearSelection();
    setMinimapExpanded(true);
  });
  minimapWrapEl.addEventListener('pointerenter', () => {
    if (!isMinimapExpandedRef.current) minimapWrapEl.classList.add('is-hover');
  });
  minimapWrapEl.addEventListener('pointerleave', () => {
    minimapWrapEl.classList.remove('is-hover');
  });
  minimapWrapEl.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'width' && event.propertyName !== 'height')
      return;
    hudUpdaters.syncMinimapCanvasSize();
  });
  window.addEventListener('pointerdown', () => {
    if (!isMinimapExpandedRef.current) return;
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
      debugMenu.toggleDebugMenu();
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

  const getStructureHit = (
    event: PointerEvent
  ): DestructibleCollider | null => {
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
        const collider =
          structureStore.structureMeshToCollider.get(mesh) ?? null;
        if (collider) {
          closestStructureHit = { collider, distance: hits[0]!.distance };
        }
      }
    }
    const castleHits = raycaster.intersectObject(castle, true);
    const pileHits = raycaster.intersectObject(castleCoinPiles, true);
    const closestBankDistance = Math.min(
      castleHits[0]?.distance ?? Number.POSITIVE_INFINITY,
      pileHits[0]?.distance ?? Number.POSITIVE_INFINITY
    );
    if (closestBankDistance < Number.POSITIVE_INFINITY) {
      if (
        !closestStructureHit ||
        closestBankDistance <= closestStructureHit.distance
      ) {
        return castleCoinsSelectionCollider;
      }
    }
    return closestStructureHit?.collider ?? null;
  };

  const canPlace = (
    center: THREE.Vector3,
    halfSize: THREE.Vector3,
    allowTouchingStructures = false
  ) => {
    return canPlaceAt(
      center,
      halfSize,
      staticColliders,
      allowTouchingStructures
    );
  };

  const placeBuilding = (center: THREE.Vector3) => {
    if (gameSessionRef.current && gameState.buildMode !== 'off') {
      void gameSessionRef.current
        .sendBuildStructure({
          structureId: `${gameState.buildMode}-${Date.now()}-${Math.round(center.x)}-${Math.round(center.z)}`,
          type: gameState.buildMode === 'tower' ? 'tower' : 'wall',
          center: { x: center.x, z: center.z },
        })
        .then((response) => {
          if (!response.accepted) {
            hudUpdaters.triggerEventBanner(response.reason ?? 'Build failed');
          }
        })
        .catch(() => {
          hudUpdaters.triggerEventBanner('Build failed');
        });
      return true;
    }
    const result = placeBuildingAt(
      center,
      gameState.buildMode,
      gameState.coins,
      {
        staticColliders,
        structureStore,
        scene,
        createTowerAt: (snapped) =>
          createTowerAt(snapped, 'base', player.username ?? 'Player'),
        applyObstacleDelta,
      }
    );
    gameState.coins = Math.max(0, gameState.coins - result.coinsSpent);
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
    return computeWallLinePlacement(
      start,
      end,
      availableEnergy,
      staticColliders
    );
  };

  const placeWallLine = (start: THREE.Vector3, end: THREE.Vector3) => {
    if (gameSessionRef.current) {
      const { validPositions } = getWallLinePlacement(
        start,
        end,
        gameState.coins
      );
      if (validPositions.length === 0) return false;
      const now = Date.now();
      void gameSessionRef.current
        .sendBuildStructures(
          validPositions.map((center, i) => ({
            structureId: `wall-line-${now}-${i}-${Math.round(center.x)}-${Math.round(center.z)}`,
            type: 'wall',
            center: { x: center.x, z: center.z },
          }))
        )
        .then((response) => {
          if (!response.accepted) {
            hudUpdaters.triggerEventBanner(response.reason ?? 'Build failed');
          }
        })
        .catch(() => {
          hudUpdaters.triggerEventBanner('Build failed');
        });
      return true;
    }
    const placed = placeWallSegment(start, end, gameState.coins, {
      scene,
      structureStore,
      staticColliders,
      applyObstacleDelta,
    });
    gameState.coins = Math.max(0, gameState.coins - placed * COINS_COST_WALL);
    if (placed > 0 && wallModelTemplate) {
      for (const wallMesh of structureStore.wallMeshes) {
        applyWallVisualToMesh(wallMesh);
      }
    }
    return placed > 0;
  };

  const placeWallSegments = (positions: THREE.Vector3[]) => {
    if (gameSessionRef.current && positions.length > 0) {
      const now = Date.now();
      void gameSessionRef.current
        .sendBuildStructures(
          positions.map((center, i) => ({
            structureId: `wall-segments-${now}-${i}-${Math.round(center.x)}-${Math.round(center.z)}`,
            type: 'wall',
            center: { x: center.x, z: center.z },
          }))
        )
        .then((response) => {
          if (!response.accepted) {
            hudUpdaters.triggerEventBanner(response.reason ?? 'Build failed');
          }
        })
        .catch(() => {
          hudUpdaters.triggerEventBanner('Build failed');
        });
      return true;
    }
    const placed = placeWallSegmentsAt(positions, gameState.coins, {
      scene,
      structureStore,
      staticColliders,
      applyObstacleDelta,
    });
    gameState.coins = Math.max(0, gameState.coins - placed * COINS_COST_WALL);
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
    if (gameSessionRef.current) {
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
        void gameSessionRef.current.sendMoveIntent(
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

  const PLAYER_VELOCITY_SMOOTHING = 14;

  const motionSystem = createEntityMotionSystem({
    structureStore,
    staticColliders,
    spatialGrid,
    npcs,
    playerFacingOffset,
    playerVelocitySmoothing: PLAYER_VELOCITY_SMOOTHING,
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
    isServerAuthoritative,
  });

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('#hud, .selection-dialog'))
      return;
    if (isMinimapExpandedRef.current) return;
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
    const hadSelection = selectedStructures.size > 0;
    clearSelection();
    if (!hadSelection) {
      setMoveTarget(point);
    }
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (gameState.buildMode === 'off') return;
    const point = getGroundPoint(event);
    if (!point) return;

    if (gameState.buildMode === 'wall' && isDraggingWall && wallDragStart) {
      wallDragEnd = point.clone();

      // Show one continuous preview mesh for the wall segment.
      const availableWallPreview = gameState.coins;
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
      const coinCost = isTower ? COINS_COST_TOWER : COINS_COST_WALL;
      const ok = canPlace(snapped, half, true) && gameState.coins >= coinCost;
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
    hudUpdaters.syncCoinTrailViewport();
    hudUpdaters.syncMinimapCanvasSize();
  });

  const updateEntityMotion = (entity: Entity, delta: number) => {
    motionSystem.updateEntityMotion(entity, delta);
  };

  const updateNpcTargets = () => {
    motionSystem.updateNpcTargets();
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
      lodNearDistance: ENABLE_MOB_RENDER_LOD
        ? MOB_LOD_NEAR_DISTANCE
        : 1_000_000,
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

    const treeSway = Math.sin(waterTime * 1.0) * 0.025;
    for (const [collider, state] of structureStore.structureStates.entries()) {
      if (collider.type !== 'tree') continue;
      const visual = state.mesh.userData.linkedVisual as
        | THREE.Object3D
        | undefined;
      if (visual) {
        visual.rotation.z = treeSway;
      }
    }

    updateMinimapEmbellishAlpha(delta);
    if (
      Math.abs(minimapEmbellishTargetAlpha - minimapEmbellishAlphaRef.current) >
      0.001
    ) {
      hudUpdaters.syncMinimapCanvasSize();
    }
    if (!serverAuthoritative) {
      clientCoinAccrualRemainderSec += delta;
      const toAdd = Math.floor(
        clientCoinAccrualRemainderSec / COIN_ACCRUAL_INTERVAL_SEC
      );
      clientCoinAccrualRemainderSec -= toAdd * COIN_ACCRUAL_INTERVAL_SEC;
      gameState.coins = Math.min(COINS_CAP, gameState.coins + toAdd);
      if (gameState.buildMode === 'wall' && gameState.coins < COINS_COST_WALL) {
        setBuildMode('off');
      }
      if (
        gameState.buildMode === 'tower' &&
        gameState.coins < COINS_COST_TOWER
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
      gameSessionRef.current &&
      now - lastNetworkHeartbeatAt >= SERVER_HEARTBEAT_INTERVAL_MS
    ) {
      lastNetworkHeartbeatAt = now;
      void gameSessionRef.current.heartbeat({
        x: player.mesh.position.x,
        z: player.mesh.position.z,
      });
    }
    if (
      gameSessionRef.current &&
      !serverMetaSyncInFlightRef.current &&
      now >= nextServerMetaSyncAtMs
    ) {
      const bridge = gameSessionRef.current;
      serverMetaSyncInFlightRef.current = true;
      nextServerMetaSyncAtMs = now + SERVER_META_SYNC_INTERVAL_MS;
      void bridge
        .fetchMeta()
        .then((payload) => {
          const { meta } = payload;
          gameState.lives = meta.lives;
          gameState.coins = Math.max(0, Math.min(COINS_CAP, meta.coins));
          if (meta.worldVersion === lastKnownWorldVersion) {
            return;
          }
          lastKnownWorldVersion = meta.worldVersion;
          return bridge.resync();
        })
        .catch((error) => {
          console.error('Failed periodic meta sync', error);
          nextServerMetaSyncAtMs =
            performance.now() + SERVER_META_SYNC_RETRY_MS;
        })
        .finally(() => {
          serverMetaSyncInFlightRef.current = false;
        });
    }
    if (
      gameSessionRef.current &&
      !serverStructureSyncInFlightRef.current &&
      now >= nextServerStructureSyncAtMs &&
      now - lastSnapshotReceivedAtMs >= SNAPSHOT_STRUCTURE_GRACE_MS
    ) {
      serverStructureSyncInFlightRef.current = true;
      nextServerStructureSyncAtMs = now + SERVER_STRUCTURE_SYNC_INTERVAL_MS;
      void gameSessionRef.current
        .fetchStructures()
        .then((payload) => {
          if (payload.structureChangeSeq === lastAppliedStructureChangeSeq) {
            return;
          }
          if (
            performance.now() - lastSnapshotReceivedAtMs <
            SNAPSHOT_STRUCTURE_GRACE_MS
          ) {
            return;
          }
          const applyAtMs = performance.now();
          console.log('[StructureSync] fetchStructures applying', {
            msSinceSnapshot: applyAtMs - lastSnapshotReceivedAtMs,
            structureCount: Object.keys(payload.structures).length,
          });
          worldStateSync.applyServerStructureSync(payload.structures);
          lastAppliedStructureChangeSeq = payload.structureChangeSeq;
        })
        .catch((error) => {
          console.error('Failed periodic structure sync', error);
          nextServerStructureSyncAtMs =
            performance.now() + SERVER_STRUCTURE_SYNC_RETRY_MS;
        })
        .finally(() => {
          serverStructureSyncInFlightRef.current = false;
        });
    }
    for (const npc of npcs) {
      updateEntityMotion(npc, delta);
    }

    if (serverAuthoritative) {
      worldStateSync.updateServerMobInterpolation(now);
    }

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

    updateParticles(delta);
    smokePoofEffect.updateSmokePoofs(delta);
    updateMobDeathVisuals(delta);
    hudUpdaters.updateCoinTrails(delta);

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
        towerTargetPosScratch
          .copy(target.mesh.position)
          .setY(target.baseY + 0.3);
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
    updateTowerArrowProjectiles(delta);
    updatePlayerArrowProjectiles(delta);
    if (pendingDamageHits.length > 0 && gameSessionRef.current) {
      const hits = pendingDamageHits.splice(0, pendingDamageHits.length);
      void gameSessionRef.current.sendDealDamages(hits);
    }

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

    const waveComplete =
      gameState.wave > 0 && !serverWaveActiveRef.current && mobs.length === 0;

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
      selectionArrowScratch.cameraRight
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      selectionArrowScratch.cameraUp
        .set(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      selectionArrowScratch.cameraForward
        .copy(selectionArrowScratch.cameraRight)
        .cross(selectionArrowScratch.cameraUp)
        .normalize();
      selectionArrowScratch.basisMatrix.makeBasis(
        selectionArrowScratch.cameraRight,
        selectionArrowScratch.cameraUp,
        selectionArrowScratch.cameraForward
      );
      selectionArrow.quaternion.setFromRotationMatrix(
        selectionArrowScratch.basisMatrix
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
      arrow.position.copy(player.mesh.position).setY(0.5);
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
          .setY(PLAYER_HEIGHT * 0.5 + 0.35);
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
    camera.lookAt(player.mesh.position.clone().setY(PLAYER_HEIGHT * 0.5));
    camera.updateMatrixWorld();
    updateMobInstanceRender(now);

    updateFloatingDamageTexts(delta);
    updateHealthBars();
    updateUsernameLabels();

    // Update ground + grid to cover the visible camera rectangle
    const visibleBounds = getVisibleGroundBounds(camera, GRID_SIZE);
    updateGroundFromBounds(visibleBounds);
    updateWaterFromBounds(visibleBounds);
    if (debugViewState.worldGrid || gameState.buildMode !== 'off') {
      worldGrid.update(visibleBounds);
    }

    gameState.coinsPopTimer = Math.max(0, gameState.coinsPopTimer - delta);

    updateHud(
      {
        wallCountEl,
        towerCountEl,
        coinsCountEl,
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
        coins: gameState.coins,
        wave: gameState.wave,
        waveComplete,
        nextWaveAtMs: gameState.nextWaveAtMs,
        mobsCount: mobs.length,
        coinsPopTimer: gameState.coinsPopTimer,
        shootCooldown: gameState.shootCooldown,
        getCountdownMsRemaining: worldStateSync.getCountdownMsRemaining,
      },
      {
        coinCostWall: COINS_COST_WALL,
        coinCostTower: COINS_COST_TOWER,
        shootCooldownMax: SHOOT_COOLDOWN,
      }
    );

    if (gameState.prevMobsCount > 0 && waveComplete) {
      hudUpdaters.triggerEventBanner('Wave cleared');
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
      assertCoinsInBounds(gameState.coins, COINS_CAP);
      if (gameState.castleCoins < 0) {
        throw new Error(
          `Castle coins invariant violated: castleCoins=${gameState.castleCoins}`
        );
      }
      assertSpawnerCounts(activeWaveSpawners);
      assertMobSpawnerReferences(mobs, new Set([...spawnerById.keys()]));
      assertStructureStoreConsistency(structureStore, staticColliders);
    }

    applyStructureDamageVisuals();
    hudUpdaters.drawMinimap();
    hudUpdaters.updateCoinHudView(delta);
    composer.render();
    coinTrailRenderer.render(coinTrailScene, coinTrailCamera);
  };

  const gameLoop = createGameLoop(tick);
  startGameWhenReady = () => {
    if (hasStartedGameLoop || !hasFinishedLoadingAssets) return;
    if (!sessionDataReady) return;
    hasStartedGameLoop = true;
    completeLoadingAndRevealScene();
    gameLoop.start();
  };
  const disposeGameScene = createDisposeScene({
    gameSessionRef,
    serverStructureResyncInFlightRef: serverStructureSyncInFlightRef,
    particleSystem,
    spawnContainerOverlay,
    stagingIslandsOverlay,
    spawnerRouteOverlay,
    pathCenterTileLayer,
    pathEdgeTileLayer,
    pathInnerCornerTileLayer,
    pathOuterCornerTileLayer,
    flowFieldDebugOverlay,
    worldGrid,
    worldBorder,
    shaftGeometry,
    shaftMaterial,
    headGeometry,
    headMaterial,
    scene,
    buildPreview,
    mobInstanceMesh,
    mobHitFlashMesh,
    clearMobDeathVisuals,
    mobLogicGeometry,
    mobLogicMaterial,
    activeArrowProjectiles,
    activePlayerArrowProjectiles,
    playerShootRangeRing,
    towerRangeMaterial,
    ground,
    groundMaterial,
    waterMesh,
    waterMaterial,
    waterDistanceFieldRef,
    groundTileLayer,
    castle,
    coinHudRoot,
    coinHudRenderer,
    activeCoinTrails,
    coinTrailScene,
    coinTrailRenderer,
    composer,
    renderer,
  });

  const disposeApp = () => disposeGameScene();

  window.addEventListener('beforeunload', disposeApp);
  hudUpdaters.syncCoinTrailViewport();
  hudUpdaters.syncMinimapCanvasSize();
  void setupAuthoritativeBridge();
  startGameWhenReady();
};

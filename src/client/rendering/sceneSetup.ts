import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { InstancedModelLayer } from './overlays/instancedModelLayer';
import { WorldGrid } from './overlays/worldGrid';
import { WorldBorder } from './overlays/worldBorder';
import { FlowFieldDebugOverlay } from './overlays/flowFieldDebug';
import { SpawnContainerOverlay } from './overlays/spawnContainer';
import { StagingIslandsOverlay } from './overlays/stagingIslands';

export type SceneSetupConfig = {
  gridSize: number;
  worldBounds: number;
  stagingIslandSize: number;
  stagingIslandHeight: number;
  stagingPlatformY: number;
  stagingBridgeWidth: number;
  stagingBridgePathWidth: number;
  stagingBridgeLength: number;
};

export type SceneSetupResult = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  structureOutlinePass: OutlinePass;
  treeOutlinePass: OutlinePass;
  hemi: THREE.HemisphereLight;
  dir: THREE.DirectionalLight;
  dirShadowFollowOffset: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  orthoSize: number;
  viewportFogEl: HTMLDivElement;
  worldGrid: WorldGrid;
  worldBorder: WorldBorder;
  spawnContainerOverlay: SpawnContainerOverlay;
  stagingIslandsOverlay: StagingIslandsOverlay;
  flowFieldDebugOverlay: FlowFieldDebugOverlay;
  groundTileLayer: InstancedModelLayer;
  pathCenterTileLayer: InstancedModelLayer;
  pathEdgeTileLayer: InstancedModelLayer;
  pathInnerCornerTileLayer: InstancedModelLayer;
  pathOuterCornerTileLayer: InstancedModelLayer;
};

export const createThreeScene = (
  app: HTMLElement,
  config: SceneSetupConfig
): SceneSetupResult => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151a);

  const aspect = window.innerWidth / window.innerHeight;
  const orthoSize = 10;
  const camera = new THREE.OrthographicCamera(
    -orthoSize * aspect,
    orthoSize * aspect,
    orthoSize,
    -orthoSize,
    -50,
    200
  );
  const isoAngle = Math.PI / 6;
  const isoRot = Math.PI / 4;
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
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);
  const dirShadowFollowOffset = new THREE.Vector3(18, 10, -14);
  const dir = new THREE.DirectionalLight(0xffffff, 1.25);
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

  const worldGrid = new WorldGrid(scene, config.gridSize, config.worldBounds);
  const worldBorder = new WorldBorder(scene, config.worldBounds);
  const spawnContainerOverlay = new SpawnContainerOverlay(scene);
  const stagingIslandsOverlay = new StagingIslandsOverlay(scene, {
    islandSize: config.stagingIslandSize,
    islandHeight: config.stagingIslandHeight,
    platformY: config.stagingPlatformY,
    bridgeWidth: config.stagingBridgeWidth,
    bridgePathWidth: config.stagingBridgePathWidth,
    bridgeLength: config.stagingBridgeLength,
    worldBounds: config.worldBounds,
  });
  const flowFieldDebugOverlay = new FlowFieldDebugOverlay(scene);
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

  return {
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
  };
};

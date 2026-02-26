import './../../style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createBallistaVisualRig,
  updateBallistaRigTracking,
  getBallistaArrowLaunchTransform,
} from '../../rendering/presenters/ballistaRig';
import {
  computeArrowFacingFromTemplate,
  orientArrowToVelocity,
  placeArrowMeshAtFacing,
} from '../../rendering/presenters/arrowProjectile';
import { createInputController } from '../../domains/gameplay/inputController';
import { screenToWorldOnGround } from '../../domains/world/coords';
import { clamp } from '../../domains/world/collision';
import { createParticleSystem } from '../../rendering/effects/particles';
import castleModelUrl from '../../assets/models/castle.glb?url';
import treeModelUrl from '../../assets/models/tree.glb?url';
import rockModelUrl from '../../assets/models/rock.glb?url';
import rock2ModelUrl from '../../assets/models/rock-2.glb?url';
import towerBallistaModelUrl from '../../assets/models/tower-ballista.glb?url';
import wallModelUrl from '../../assets/models/wall.glb?url';
import mobModelUrl from '../../assets/models/mob.glb?url';
import bossModelUrl from '../../assets/models/boss.glb?url';
import cannonModelUrl from '../../assets/models/cannon.glb?url';
import arrowModelUrl from '../../assets/models/arrow.glb?url';
import groundModelUrl from '../../assets/models/ground.glb?url';
import pathModelUrl from '../../assets/models/path.glb?url';
import pathEdgeModelUrl from '../../assets/models/path-edge.glb?url';
import pathCornerInnerModelUrl from '../../assets/models/path-corner-inner.glb?url';
import pathCornerOuterModelUrl from '../../assets/models/path-corner-outer.glb?url';
import coinModelUrl from '../../assets/models/coin.glb?url';
import playerModelUrl from '../../assets/models/player.glb?url';
import pondModelUrl from '../../assets/models/pond.glb?url';

const GROUND_SIZE = 200;
const SANDBOX_BOUNDS = GROUND_SIZE / 2 - 5;
const KNOLL_SPACING = 6;
const PLAYER_SPEED = 6;
const PLAYER_HEIGHT = 1.8;
const GRID_SIZE = 1;
const BALLISTA_ARROW_SPEED = 17;
const BALLISTA_ARROW_GRAVITY = 36;
const BALLISTA_ARROW_GRAVITY_DELAY = 0.12;
const BALLISTA_ARROW_RADIUS = 0.2;
const BALLISTA_ARROW_MAX_LIFETIME = 3;
const UPGRADE_COST = 20;
const MOB_MAX_HP = 50;
const MOB_BASE_Y = 0.65;
const RIG_DEMO_RESPAWN_DELAY = 2.5;

type SandboxMob = {
  mesh: THREE.Object3D;
  hp: number;
  maxHp: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lastHitDirection?: THREE.Vector3;
};

type ArrowProjectile = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravityDelay: number;
  radius: number;
  ttl: number;
  damage: number;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('Missing #app');

const canvas = document.createElement('canvas');
canvas.style.display = 'block';
canvas.style.width = '100%';
canvas.style.height = '100%';
app.insertBefore(canvas, app.firstChild);

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

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const SANDBOX_COINS = 9001;
const coinHudCanvasEl = document.querySelector<HTMLCanvasElement>('#sandboxCoinCanvas');
const coinHudScene = new THREE.Scene();
const coinHudCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
coinHudCamera.position.set(0, 0.8, 3);
coinHudCamera.lookAt(0, 0, 0);
const coinHudRoot = new THREE.Group();
coinHudScene.add(coinHudRoot);
let coinHudRenderer: THREE.WebGLRenderer | null = null;
if (coinHudCanvasEl) {
  coinHudRenderer = new THREE.WebGLRenderer({
    canvas: coinHudCanvasEl,
    antialias: true,
    alpha: true,
  });
  coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  coinHudRenderer.setSize(36, 36, false);
  coinHudRenderer.outputColorSpace = THREE.SRGBColorSpace;
  coinHudScene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const coinHudKey = new THREE.DirectionalLight(0xffffff, 1.15);
  coinHudKey.position.set(1.5, 2, 2);
  coinHudScene.add(coinHudKey);
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const inputController = createInputController();

const player: {
  mesh: THREE.Object3D;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  baseY: number;
} = {
  mesh: new THREE.Group(),
  target: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  speed: PLAYER_SPEED,
  baseY: 0,
};
player.mesh.position.set(0, player.baseY, 0);
player.target.copy(player.mesh.position);
scene.add(player.mesh);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x5f926a })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const applyGroundTileMaterial = (groundTile: THREE.Object3D) => {
  let sourceMat: THREE.Material | null = null;
  groundTile.traverse((obj) => {
    if (!sourceMat && obj instanceof THREE.Mesh && obj.material) {
      const m = obj.material;
      sourceMat = Array.isArray(m) ? m[0]! : m;
    }
  });
  if (sourceMat !== null) {
    const cloned = (sourceMat as THREE.Material).clone();
    (ground.material as THREE.Material).dispose();
    (ground as THREE.Mesh).material = cloned;
  }
};

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x2b2b2b, 1.15);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambient);
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

const setShadows = (obj: THREE.Object3D) => {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const prepareStatic = (source: THREE.Object3D): THREE.Object3D => {
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) {
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    model.position.set(-center.x, -bounds.min.y, -center.z);
  }
  setShadows(model);
  return model;
};

const loader = new GLTFLoader();
const loadModel = (url: string): Promise<THREE.Object3D> =>
  new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(prepareStatic(gltf.scene)),
      undefined,
      reject
    );
  });

const knollGroup = new THREE.Group();
scene.add(knollGroup);

const setMoveTarget = (pos: THREE.Vector3) => {
  player.target.set(
    clamp(pos.x, -SANDBOX_BOUNDS, SANDBOX_BOUNDS),
    0,
    clamp(pos.z, -SANDBOX_BOUNDS, SANDBOX_BOUNDS)
  );
};

const keyboardForward = new THREE.Vector3();
const keyboardRight = new THREE.Vector3();
const keyboardMoveDir = new THREE.Vector3();
let wasKeyboardMoving = false;

const getGroundPoint = (event: PointerEvent): THREE.Vector3 | null => {
  const rect = renderer.domElement.getBoundingClientRect();
  return screenToWorldOnGround(
    event.clientX,
    event.clientY,
    rect,
    camera,
    groundPlane
  );
};

const isEditableTarget = (): boolean => {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = (el as HTMLElement).tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
};

window.addEventListener('keydown', (event) => {
  if (inputController.handleKeyDown(event, isEditableTarget())) {
    event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => {
  if (inputController.handleKeyUp(event, isEditableTarget())) {
    event.preventDefault();
  }
});

let pointerDownHandler: ((event: PointerEvent) => void) | null = null;
const installPointerHandler = (handler: (event: PointerEvent) => void) => {
  if (pointerDownHandler) {
    renderer.domElement.removeEventListener('pointerdown', pointerDownHandler);
  }
  pointerDownHandler = handler;
  renderer.domElement.addEventListener('pointerdown', handler);
};
installPointerHandler((event) => {
  const point = getGroundPoint(event);
  if (point) setMoveTarget(point);
});

const placeModel = (
  template: THREE.Object3D,
  x: number,
  z: number,
  scale = 1,
  rotY = 0
) => {
  const clone = template.clone(true);
  clone.position.set(x, 0, z);
  clone.scale.setScalar(scale);
  clone.rotation.y = rotY;
  knollGroup.add(clone);
};

const placeRock = (
  template: THREE.Object3D,
  x: number,
  z: number,
  footX: number,
  footZ: number,
  vertScale: number,
  rotY = 0
) => {
  const clone = template.clone(true);
  clone.position.set(x, 0, z);
  clone.scale.set(footX, vertScale, footZ);
  clone.rotation.y = rotY;
  knollGroup.add(clone);
};

Promise.all([
  loadModel(castleModelUrl),
  loadModel(treeModelUrl),
  loadModel(rockModelUrl),
  loadModel(rock2ModelUrl),
  loadModel(towerBallistaModelUrl),
  loadModel(wallModelUrl),
  loadModel(mobModelUrl),
  loadModel(bossModelUrl),
  loadModel(cannonModelUrl),
  loadModel(arrowModelUrl),
  loadModel(groundModelUrl),
  loadModel(pathModelUrl),
  loadModel(pathEdgeModelUrl),
  loadModel(pathCornerInnerModelUrl),
  loadModel(pathCornerOuterModelUrl),
  loadModel(coinModelUrl),
  loadModel(playerModelUrl),
  loadModel(pondModelUrl),
])
  .then(
    ([
      castle,
      tree,
      rock,
      rock2,
      towerBallista,
      wall,
      mobTemplate,
      boss,
      cannon,
      arrowTemplate,
      groundTile,
      pathTile,
      pathEdge,
      pathInner,
      pathOuter,
      coin,
      playerTemplate,
      pond,
    ]) => {
      applyGroundTileMaterial(groundTile);

      coinHudRoot.clear();
      const hudCoin = coin.clone(true);
      hudCoin.scale.multiplyScalar(0.85);
      hudCoin.rotation.y = Math.PI / 7;
      coinHudRoot.add(hudCoin);

      let cx = -40;
      const cz = 0;

      placeModel(castle, cx, cz);
      cx += KNOLL_SPACING * 2;

      placeModel(wall, cx, cz);
      cx += KNOLL_SPACING;
      const rigDemoX = cx;
      cx += KNOLL_SPACING;
      placeModel(cannon, cx, cz);
      cx += KNOLL_SPACING;
      placeModel(coin, cx, cz);
      cx += KNOLL_SPACING;

      placeModel(mobTemplate, cx, cz, 1, Math.PI);
      cx += KNOLL_SPACING;
      placeModel(boss, cx, cz, 1, Math.PI);
      cx += KNOLL_SPACING;

      const TREE_SPACING = 3;
      const TREE_TO_ROCK_GAP = 4;
      const treeLineX = cx;
      const treeLineZStart = 0;
      for (let f = 1; f <= 4; f += 1) {
        placeModel(tree, treeLineX, treeLineZStart - (f - 1) * TREE_SPACING, f / 2, Math.PI * 0.5);
      }
      cx += TREE_TO_ROCK_GAP;

      const ROCK_GAP = 1;
      const ROCK_GRID_GAP = 2;
      const rockMatrixX = cx;
      const rockMatrixZStart = 0;
      let prevBottom = rockMatrixZStart + ROCK_GAP + 0.5;
      let maxRight = rockMatrixX;
      for (let fz = 1; fz <= 5; fz += 1) {
        const centerZ = prevBottom - ROCK_GAP - fz / 2;
        let prevRight = rockMatrixX - ROCK_GAP;
        for (let fx = 1; fx <= 5; fx += 1) {
          const centerX = prevRight + ROCK_GAP + fx / 2;
          placeRock(rock, centerX, centerZ, fx, fz, 1);
          prevRight = centerX + fx / 2;
          maxRight = Math.max(maxRight, prevRight);
        }
        prevBottom = centerZ - fz / 2;
      }
      cx = maxRight + ROCK_GRID_GAP;

      prevBottom = rockMatrixZStart + ROCK_GAP + 0.5;
      maxRight = cx;
      for (let fz = 1; fz <= 5; fz += 1) {
        const centerZ = prevBottom - ROCK_GAP - fz / 2;
        let prevRight = cx - ROCK_GAP;
        for (let fx = 1; fx <= 5; fx += 1) {
          const centerX = prevRight + ROCK_GAP + fx / 2;
          placeRock(rock2, centerX, centerZ, fx, fz, 1);
          prevRight = centerX + fx / 2;
          maxRight = Math.max(maxRight, prevRight);
        }
        prevBottom = centerZ - fz / 2;
      }
      cx = maxRight + ROCK_GRID_GAP;

      placeModel(groundTile, cx, cz, 0.5);
      cx += KNOLL_SPACING;
      placeModel(pathTile, cx, cz, 0.5);
      cx += KNOLL_SPACING;
      placeModel(pathEdge, cx, cz, 0.5);
      cx += KNOLL_SPACING;
      placeModel(pathInner, cx, cz, 0.5);
      cx += KNOLL_SPACING;
      placeModel(pathOuter, cx, cz, 0.5);
      cx += KNOLL_SPACING;

      placeModel(playerTemplate, cx, cz);
      cx += KNOLL_SPACING;
      placeModel(mobTemplate, cx, cz, 1, Math.PI);
      cx += KNOLL_SPACING;
      placeModel(boss, cx, cz, 1, Math.PI);
      cx += KNOLL_SPACING;
      placeModel(pond, cx, cz);

      const playerMesh = playerTemplate.clone(true);
      scene.remove(player.mesh);
      player.mesh = playerMesh;
      player.mesh.position.set(0, player.baseY, 0);
      scene.add(player.mesh);

      return {
        towerBallista,
        mobTemplate,
        arrowTemplate,
        rigDemoX,
      };
    }
  )
  .then(({ towerBallista, mobTemplate, arrowTemplate, rigDemoX }) => {
    const arrowFacing = computeArrowFacingFromTemplate(arrowTemplate);

    let coins = SANDBOX_COINS;
    const energyCountEl = document.getElementById('sandboxEnergyCount');
    const updateCoinsDisplay = () => {
      if (energyCountEl) energyCountEl.textContent = String(coins);
    };
    updateCoinsDisplay();

    type SandboxTowerState = { range: number; damage: number; shootCadence: number; rangeLevel: number; damageLevel: number; speedLevel: number };
    const sandboxTower: SandboxTowerState = { range: 8, damage: 16, shootCadence: 0.25, rangeLevel: 0, damageLevel: 0, speedLevel: 0 };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selectionPanel = document.getElementById('sandboxSelectionPanel');
    const statRangeEl = document.getElementById('sandboxStatRange');
    const statDamageEl = document.getElementById('sandboxStatDamage');
    const statSpeedEl = document.getElementById('sandboxStatSpeed');
    let ballistaSelected = false;

    const updateSelectionPanel = () => {
      if (!selectionPanel) return;
      selectionPanel.style.display = ballistaSelected ? 'block' : 'none';
      if (ballistaSelected) {
        if (statRangeEl) statRangeEl.textContent = String(sandboxTower.range);
        if (statDamageEl) statDamageEl.textContent = String(sandboxTower.damage);
        if (statSpeedEl) statSpeedEl.textContent = String(Math.round(1 / sandboxTower.shootCadence));
        const rangeBtn = document.getElementById('sandboxUpgradeRange');
        const damageBtn = document.getElementById('sandboxUpgradeDamage');
        const speedBtn = document.getElementById('sandboxUpgradeSpeed');
        const setBtn = (btn: HTMLElement | null, disabled: boolean, text: string) => {
          if (!btn) return;
          btn.setAttribute('aria-disabled', String(disabled));
          if (btn instanceof HTMLButtonElement) btn.disabled = disabled;
          btn.textContent = text;
        };
        setBtn(rangeBtn, sandboxTower.rangeLevel >= 5 || coins < UPGRADE_COST, sandboxTower.rangeLevel >= 5 ? 'Range Max' : `Range +1 (${UPGRADE_COST})`);
        setBtn(damageBtn, sandboxTower.damageLevel >= 5 || coins < UPGRADE_COST, sandboxTower.damageLevel >= 5 ? 'Damage Max' : `Damage +1 (${UPGRADE_COST})`);
        setBtn(speedBtn, sandboxTower.speedLevel >= 5 || coins < UPGRADE_COST, sandboxTower.speedLevel >= 5 ? 'Speed Max' : `Speed +2/s (${UPGRADE_COST})`);
      }
    };

    const applyUpgrade = (id: 'range' | 'damage' | 'speed') => {
      if (coins < UPGRADE_COST) return;
      if (id === 'range' && sandboxTower.rangeLevel < 5) {
        coins -= UPGRADE_COST;
        sandboxTower.rangeLevel += 1;
        sandboxTower.range += 1;
      } else if (id === 'damage' && sandboxTower.damageLevel < 5) {
        coins -= UPGRADE_COST;
        sandboxTower.damageLevel += 1;
        sandboxTower.damage += 1;
      } else if (id === 'speed' && sandboxTower.speedLevel < 5) {
        coins -= UPGRADE_COST;
        sandboxTower.speedLevel += 1;
        const shotsPerSecond = 4 + sandboxTower.speedLevel * 2;
        sandboxTower.shootCadence = 1 / shotsPerSecond;
      }
      updateCoinsDisplay();
      updateSelectionPanel();
    };

    document.getElementById('sandboxUpgradeRange')?.addEventListener('click', () => applyUpgrade('range'));
    document.getElementById('sandboxUpgradeDamage')?.addEventListener('click', () => applyUpgrade('damage'));
    document.getElementById('sandboxUpgradeSpeed')?.addEventListener('click', () => applyUpgrade('speed'));

    const mobDeathVisualTemplate = mobTemplate.clone(true);
    const particleSystem = createParticleSystem(scene);
    const DEATH_FLASH_TINT = new THREE.Color(0xff2a2a);
    const MOB_DEATH_GROUND_OFFSET_Y = -0.65;
    const MOB_DEATH_HEADING_OFFSET = Math.PI;

    type DeathVisual = {
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
    const activeMobDeathVisuals: DeathVisual[] = [];
    const TEMP_BASE_COLOR = new THREE.Color();

    const spawnMobDeathVisual = (mob: SandboxMob) => {
      const deathRoot = new THREE.Group();
      const corpse = mobDeathVisualTemplate.clone(true);
      const corpseBounds = new THREE.Box3().setFromObject(corpse);
      if (!corpseBounds.isEmpty()) {
        corpse.position.y -= corpseBounds.min.y;
      }
      deathRoot.add(corpse);
      deathRoot.position.copy(mob.position);
      const DEATH_VISUAL_LIFT_Y = 0.3;
      deathRoot.position.y += MOB_DEATH_GROUND_OFFSET_Y + DEATH_VISUAL_LIFT_Y;
      const startX = deathRoot.position.x;
      const startZ = deathRoot.position.z;
      const startY = deathRoot.position.y;
      const headingSpeedSq =
        mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z;
      let heading =
        headingSpeedSq > 1e-6
          ? Math.atan2(mob.velocity.x, mob.velocity.z) + MOB_DEATH_HEADING_OFFSET
          : MOB_DEATH_HEADING_OFFSET;
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
          heading =
            Math.atan2(normalizedHitDirX, normalizedHitDirZ) +
            MOB_DEATH_HEADING_OFFSET;
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
          ? node.material.map((m) => m.clone())
          : node.material.clone();
        const asArray = Array.isArray(clonedMaterial)
          ? clonedMaterial
          : [clonedMaterial];
        for (const material of asArray) {
          material.transparent = true;
          material.opacity = 1;
          material.depthWrite = false;
          const tintableMaterial = material as THREE.Material & { color?: THREE.Color };
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

    const FALL_DURATION = 0.5;
    const HOLD_DURATION = 1.15;
    const FADE_DURATION = 1.0;
    const HIT_FLASH_HOLD_DURATION = 0.32;
    const HIT_FLASH_LERP_OUT_DURATION = 0.2;
    const KNOCKBACK_DURATION = 0.38;
    const TOTAL_DEATH_DURATION = FALL_DURATION + HOLD_DURATION + FADE_DURATION;
    const MAX_FALL_ANGLE = Math.PI * 0.56;
    const SINK_DISTANCE = 0.85;
    const MIN_DEATH_Y = -2;

    const updateMobDeathVisuals = (delta: number) => {
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
          const tintableMaterial = material as THREE.Material & { color?: THREE.Color };
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
        if (visual.age >= TOTAL_DEATH_DURATION) {
          scene.remove(visual.root);
          for (const material of visual.materials) {
            material.dispose();
          }
          activeMobDeathVisuals.splice(i, 1);
        }
      }
    };

    const rigDemoGroup = new THREE.Group();
    rigDemoGroup.position.set(rigDemoX, 0, 0);
    scene.add(rigDemoGroup);

    const towerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    towerMesh.position.set(0, 1, 0);
    rigDemoGroup.add(towerMesh);

    const rig = createBallistaVisualRig(towerBallista);
    if (rig) {
      rig.root.position.copy(towerMesh.position);
      rig.root.position.y -= 1;
      rigDemoGroup.add(rig.root);
    } else {
      const fallback = towerBallista.clone(true);
      fallback.position.copy(towerMesh.position);
      fallback.position.y -= 1;
      rigDemoGroup.add(fallback);
    }
    const towerPos = new THREE.Vector3(rigDemoX, 1, 0);
    rigDemoGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.raycast = THREE.Mesh.prototype.raycast;
    });

    installPointerHandler((event) => {
      if ((event.target as HTMLElement).closest('#sandboxSelectionPanel, .hud-energy')) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(rigDemoGroup, true);
      if (hits.length > 0) {
        ballistaSelected = true;
        updateSelectionPanel();
        setMoveTarget(towerPos.clone());
        return;
      }
      ballistaSelected = false;
      updateSelectionPanel();
      const point = getGroundPoint(event);
      if (point) setMoveTarget(point);
    });

    const mobs: SandboxMob[] = [];
    const activeArrows: ArrowProjectile[] = [];
    const arrowGravity = new THREE.Vector3(0, -BALLISTA_ARROW_GRAVITY, 0);
    const RIG_DEMO_SPAWN_DIST = 5;
    const spawnLeft = new THREE.Vector3(rigDemoX, MOB_BASE_Y, -RIG_DEMO_SPAWN_DIST);
    const spawnRight = new THREE.Vector3(rigDemoX, MOB_BASE_Y, RIG_DEMO_SPAWN_DIST);
    let nextSpawnSide: 'left' | 'right' = 'left';
    let respawnTimer = 0;

    const pickMobInRange = (): SandboxMob | null => {
      let best: SandboxMob | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const mob of mobs) {
        if (mob.hp <= 0) continue;
        const d = mob.position.distanceTo(towerPos);
        if (d <= sandboxTower.range && d < bestDist) {
          bestDist = d;
          best = mob;
        }
      }
      return best;
    };

    const spawnMob = (_x: number, z: number) => {
      const mesh = mobTemplate.clone(true);
      const pos = new THREE.Vector3(rigDemoX, MOB_BASE_Y, z);
      mesh.position.set(pos.x - rigDemoX, pos.y, pos.z);
      rigDemoGroup.add(mesh);
      mobs.push({
        mesh,
        hp: MOB_MAX_HP,
        maxHp: MOB_MAX_HP,
        position: pos,
        velocity: new THREE.Vector3(0, 0, 0),
      });
    };

    const spawnArrow = (
      launchPos: THREE.Vector3,
      quat: THREE.Quaternion,
      velocity: THREE.Vector3
    ) => {
      const mesh = arrowTemplate.clone(true);
      mesh.quaternion.copy(quat);
      orientArrowToVelocity(mesh, velocity, arrowFacing.forwardLocal);
      placeArrowMeshAtFacing(mesh, launchPos, arrowFacing.anchorLocalPos);
      scene.add(mesh);
      activeArrows.push({
        mesh,
        position: launchPos.clone(),
        velocity: velocity.clone(),
        gravityDelay: BALLISTA_ARROW_GRAVITY_DELAY,
        radius: BALLISTA_ARROW_RADIUS,
        ttl: BALLISTA_ARROW_MAX_LIFETIME,
        damage: sandboxTower.damage,
      });
    };

    let towerShootCooldown = 0;
    const launchPosScratch = new THREE.Vector3();
    const launchQuatScratch = new THREE.Quaternion();
    const targetPosScratch = new THREE.Vector3();

    const prevPosScratch = new THREE.Vector3();
    const stepScratch = new THREE.Vector3();
    const closestScratch = new THREE.Vector3();
    const mobCenterScratch = new THREE.Vector3();

    const updateRigDemo = (delta: number) => {
      towerShootCooldown = Math.max(0, towerShootCooldown - delta);

      for (let i = mobs.length - 1; i >= 0; i -= 1) {
        const mob = mobs[i]!;
        if (mob.hp <= 0) {
          spawnMobDeathVisual(mob);
          particleSystem.spawnMobDeathEffects(mob.position);
          rigDemoGroup.remove(mob.mesh);
          mobs.splice(i, 1);
        }
      }

      if (mobs.length === 0) {
        respawnTimer -= delta;
        if (respawnTimer <= 0) {
          respawnTimer = RIG_DEMO_RESPAWN_DELAY;
          if (nextSpawnSide === 'left') {
            spawnMob(0, spawnLeft.z);
            nextSpawnSide = 'right';
          } else {
            spawnMob(0, spawnRight.z);
            nextSpawnSide = 'left';
          }
        }
      }

      const target = pickMobInRange();
      if (target) {
        targetPosScratch.copy(target.position).setY(MOB_BASE_Y + 0.3);
        const launchVel = targetPosScratch
          .clone()
          .sub(towerPos)
          .normalize()
          .multiplyScalar(BALLISTA_ARROW_SPEED);

        if (rig) {
          const { aimAligned } = updateBallistaRigTracking(
            rig,
            towerPos,
            targetPosScratch,
            launchVel,
            delta
          );
          if (aimAligned && towerShootCooldown <= 0) {
            getBallistaArrowLaunchTransform(
              rig,
              launchPosScratch,
              launchQuatScratch
            );
            spawnArrow(launchPosScratch, launchQuatScratch, launchVel);
            towerShootCooldown = sandboxTower.shootCadence;
          }
        } else if (towerShootCooldown <= 0) {
          launchPosScratch.copy(towerPos).setY(towerPos.y + 0.5);
          launchQuatScratch.setFromUnitVectors(
            new THREE.Vector3(0, -1, 0),
            launchVel.clone().normalize()
          );
          spawnArrow(launchPosScratch, launchQuatScratch, launchVel);
          towerShootCooldown = sandboxTower.shootCadence;
        }
      } else if (rig) {
        updateBallistaRigTracking(rig, towerPos, null, null, delta);
      }

      for (let i = activeArrows.length - 1; i >= 0; i -= 1) {
        const proj = activeArrows[i]!;
        proj.ttl -= delta;
        if (proj.ttl <= 0) {
          scene.remove(proj.mesh);
          activeArrows.splice(i, 1);
          continue;
        }

        prevPosScratch.copy(proj.position);
        let gravDt = delta;
        if (proj.gravityDelay > 0) {
          const step = Math.min(proj.gravityDelay, delta);
          proj.gravityDelay -= step;
          gravDt = delta - step;
        }
        proj.velocity.y += arrowGravity.y * gravDt;
        proj.position.addScaledVector(proj.velocity, delta);
        orientArrowToVelocity(proj.mesh, proj.velocity, arrowFacing.forwardLocal);
        placeArrowMeshAtFacing(
          proj.mesh,
          proj.position,
          arrowFacing.anchorLocalPos
        );

        stepScratch.copy(proj.position).sub(prevPosScratch);
        const segLenSq = stepScratch.lengthSq();
        let hitMob: SandboxMob | null = null;
        let bestT = Number.POSITIVE_INFINITY;

        for (const mob of mobs) {
          if (mob.hp <= 0) continue;
          mobCenterScratch.copy(mob.position).setY(MOB_BASE_Y + 0.3);
          const combined = 0.5 + proj.radius;
          let t = 0;
          if (segLenSq > 1e-8) {
            const deltaP = mobCenterScratch.clone().sub(prevPosScratch);
            t = THREE.MathUtils.clamp(
              deltaP.dot(stepScratch) / segLenSq,
              0,
              1
            );
          }
          closestScratch.copy(prevPosScratch).addScaledVector(stepScratch, t);
          if (
            closestScratch.distanceToSquared(mobCenterScratch) >
            combined * combined
          )
            continue;
          if (t < bestT) {
            bestT = t;
            hitMob = mob;
          }
        }

        if (hitMob) {
          hitMob.lastHitDirection = proj.velocity.clone().normalize();
          hitMob.hp -= proj.damage;
          scene.remove(proj.mesh);
          activeArrows.splice(i, 1);
        }
      }
    };

    const updatePlayerMotion = (delta: number) => {
      const keyboardDir = inputController.getKeyboardMoveDirection({
        camera,
        keyboardForward,
        keyboardRight,
        keyboardMoveDir,
      });
      if (keyboardDir) {
        const keyboardMoveDistance = Math.max(GRID_SIZE, player.speed * 0.35);
        setMoveTarget(
          player.mesh.position
            .clone()
            .addScaledVector(keyboardDir, keyboardMoveDistance)
        );
        wasKeyboardMoving = true;
      } else if (wasKeyboardMoving) {
        setMoveTarget(player.mesh.position.clone());
        wasKeyboardMoving = false;
      }

      const dx = player.target.x - player.mesh.position.x;
      const dz = player.target.z - player.mesh.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 0.01) {
        player.velocity.set(0, 0, 0);
      } else {
        const len = Math.sqrt(distSq);
        player.velocity.set((dx / len) * player.speed, 0, (dz / len) * player.speed);
      }

      player.mesh.position.x += player.velocity.x * delta;
      player.mesh.position.z += player.velocity.z * delta;
      player.mesh.position.x = clamp(
        player.mesh.position.x,
        -SANDBOX_BOUNDS,
        SANDBOX_BOUNDS
      );
      player.mesh.position.z = clamp(
        player.mesh.position.z,
        -SANDBOX_BOUNDS,
        SANDBOX_BOUNDS
      );
      player.mesh.position.y = player.baseY;

      const vx = player.velocity.x;
      const vz = player.velocity.z;
      if (vx * vx + vz * vz > 1e-6) {
        player.mesh.rotation.y = Math.atan2(vx, vz) + Math.PI;
      }
    };

    let lastTime = performance.now() / 1000;
    const animate = () => {
      requestAnimationFrame(animate);
      const now = performance.now() / 1000;
      const delta = Math.min(now - lastTime, 0.1);
      lastTime = now;

      updatePlayerMotion(delta);
      updateRigDemo(delta);
      updateMobDeathVisuals(delta);
      particleSystem.updateParticles(delta);

      if (coinHudRenderer && coinHudRoot.children.length > 0) {
        const rect = coinHudCanvasEl?.getBoundingClientRect();
        if (rect) {
          const w = Math.max(1, Math.round(rect.width));
          const h = Math.max(1, Math.round(rect.height));
          coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          coinHudRenderer.setSize(w, h, false);
          coinHudCamera.aspect = w / h;
          coinHudCamera.updateProjectionMatrix();
        }
        coinHudRoot.rotation.y += delta * 1.75;
        coinHudRenderer.render(coinHudScene, coinHudCamera);
      }

      camera.position.copy(player.mesh.position).add(cameraOffset);
      camera.lookAt(
        player.mesh.position.clone().setY(PLAYER_HEIGHT * 0.5)
      );

      dir.target.position.copy(player.mesh.position);
      dir.position.copy(player.mesh.position).add(dirShadowFollowOffset);
      dir.target.updateMatrixWorld();
      dir.updateMatrixWorld();

      renderer.render(scene, camera);
    };
    animate();
  })
  .catch((err) => {
    console.error('Failed to load sandbox models:', err);
  });

window.addEventListener('resize', () => {
  const newAspect = window.innerWidth / window.innerHeight;
  camera.left = -orthoSize * newAspect;
  camera.right = orthoSize * newAspect;
  camera.top = orthoSize;
  camera.bottom = -orthoSize;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

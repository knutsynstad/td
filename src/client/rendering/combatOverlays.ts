import * as THREE from 'three';
import type { Entity } from '../domains/gameplay/types/entities';
import type { StaticCollider } from '../domains/gameplay/types/entities';
import type { StructureStore } from '../domains/gameplay/structureStore';

export type CombatOverlaysContext = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  app: HTMLElement;
  structureStore: StructureStore;
  playerShootRange: number;
  showPlayerShootRange: boolean;
};

type FloatingDamageText = {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  elapsed: number;
  duration: number;
  driftX: number;
};

type HealthBarElements = { shell: HTMLDivElement; fill: HTMLDivElement };

export type CombatOverlaysResult = {
  worldToScreen: (worldPos: THREE.Vector3) => { x: number; y: number } | null;
  arrow: THREE.ArrowHelper;
  selectionArrow: THREE.Group;
  shaftGeometry: THREE.BufferGeometry;
  shaftMaterial: THREE.Material;
  headGeometry: THREE.BufferGeometry;
  headMaterial: THREE.Material;
  towerRangeMaterial: THREE.Material;
  selectionArrowScratch: {
    cameraRight: THREE.Vector3;
    cameraUp: THREE.Vector3;
    cameraForward: THREE.Vector3;
    basisMatrix: THREE.Matrix4;
  };
  playerShootRangeRing: THREE.Mesh;
  spawnFloatingDamageText: (
    mob: Entity,
    damage: number,
    source: 'player' | 'tower',
    isCrit?: boolean
  ) => void;
  updateFloatingDamageTexts: (delta: number) => void;
  updateHealthBars: () => void;
};

const worldToScreen = (
  worldPos: THREE.Vector3,
  camera: THREE.Camera
): { x: number; y: number } | null => {
  const vector = worldPos.clone();
  vector.project(camera);
  if (vector.z > 1) return null;
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
  return { x, y };
};

export const createCombatOverlays = (
  ctx: CombatOverlaysContext
): CombatOverlaysResult => {
  const {
    scene,
    camera,
    app,
    structureStore,
    playerShootRange,
    showPlayerShootRange,
  } = ctx;

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
  const shaftGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8);
  const shaftMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
  shaft.position.y = -0.6 + 1.0 / 2;
  selectionArrowGroup.add(shaft);
  const headGeometry = new THREE.ConeGeometry(0.5, 0.6, 8);
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.rotation.x = Math.PI;
  head.position.y = -0.6;
  selectionArrowGroup.add(head);
  selectionArrowGroup.visible = false;
  scene.add(selectionArrowGroup);

  const towerRangeMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ad1ff,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const playerShootRangeRing = new THREE.Mesh(
    new THREE.RingGeometry(playerShootRange - 0.12, playerShootRange, 64),
    towerRangeMaterial
  );
  playerShootRangeRing.rotation.x = -Math.PI / 2;
  playerShootRangeRing.position.set(0, 0.02, 0);
  playerShootRangeRing.visible = showPlayerShootRange;
  scene.add(playerShootRangeRing);

  const healthBarContainer = document.createElement('div');
  healthBarContainer.style.position = 'fixed';
  healthBarContainer.style.top = '0';
  healthBarContainer.style.left = '0';
  healthBarContainer.style.width = '100%';
  healthBarContainer.style.height = '100%';
  healthBarContainer.style.pointerEvents = 'none';
  healthBarContainer.style.zIndex = '999';
  app.appendChild(healthBarContainer);

  const damageTextContainer = document.createElement('div');
  damageTextContainer.style.position = 'fixed';
  damageTextContainer.style.top = '0';
  damageTextContainer.style.left = '0';
  damageTextContainer.style.width = '100%';
  damageTextContainer.style.height = '100%';
  damageTextContainer.style.pointerEvents = 'none';
  damageTextContainer.style.zIndex = '1200';
  app.appendChild(damageTextContainer);

  const activeDamageTexts: FloatingDamageText[] = [];
  const healthBarMap = new Map<StaticCollider, HealthBarElements>();

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

      const liftedWorldPos = text.worldPos
        .clone()
        .setY(text.worldPos.y + easeOut * 0.55);
      const screenPos = worldToScreen(liftedWorldPos, camera);
      if (screenPos) {
        const swayX = Math.sin(t * Math.PI) * text.driftX;
        text.el.style.left = `${screenPos.x + swayX}px`;
        text.el.style.top = `${screenPos.y}px`;
        text.el.style.opacity = String(1 - t);
        text.el.style.transform = `translate(-50%, -100%) scale(${1 + (1 - t) * 0.2})`;
        text.el.style.visibility = '';
      } else {
        text.el.style.visibility = 'hidden';
      }

      if (t >= 1) {
        text.el.remove();
        activeDamageTexts.splice(i, 1);
      }
    }
  };

  const createHealthBar = (): HealthBarElements => {
    const shell = document.createElement('div');
    shell.style.position = 'absolute';
    shell.style.transform = 'translate(-50%, -100%)';
    shell.style.width = '42px';
    shell.style.height = '6px';
    shell.style.border = '1px solid rgba(255,255,255,0.85)';
    shell.style.borderRadius = '999px';
    shell.style.background = 'rgba(0,0,0,0.55)';
    shell.style.overflow = 'hidden';
    shell.style.pointerEvents = 'none';
    const fill = document.createElement('div');
    fill.style.height = '100%';
    fill.style.transition = 'width 80ms linear';
    shell.appendChild(fill);
    return { shell, fill };
  };

  const updateHealthBars = () => {
    const activeEntries: [StaticCollider, { hp: number; maxHp: number }][] = [];
    for (const [collider, state] of structureStore.structureStates.entries()) {
      if (collider.type !== 'wall' && collider.type !== 'tower') continue;
      if (state.maxHp <= 0 || state.hp >= state.maxHp) continue;
      activeEntries.push([collider, { hp: state.hp, maxHp: state.maxHp }]);
    }
    const activeColliders = new Set(activeEntries.map(([c]) => c));
    for (const collider of healthBarMap.keys()) {
      if (!activeColliders.has(collider)) {
        const { shell } = healthBarMap.get(collider)!;
        shell.remove();
        healthBarMap.delete(collider);
      }
    }
    for (const [collider, { hp, maxHp }] of activeEntries) {
      const barAnchor = new THREE.Vector3(
        collider.center.x,
        collider.center.y + collider.halfSize.y + 0.55,
        collider.center.z
      );
      const screenPos = worldToScreen(barAnchor, camera);
      if (!screenPos) continue;
      let bar = healthBarMap.get(collider);
      if (!bar) {
        bar = createHealthBar();
        healthBarMap.set(collider, bar);
        healthBarContainer.appendChild(bar.shell);
      }
      bar.shell.style.left = `${screenPos.x}px`;
      bar.shell.style.top = `${screenPos.y}px`;
      const hpRatio = Math.max(0, Math.min(1, hp / maxHp));
      bar.fill.style.width = `${Math.max(0, Math.round(hpRatio * 100))}%`;
      bar.fill.style.background =
        hpRatio < 0.35 ? '#e35a5a' : hpRatio < 0.75 ? '#e0bf50' : '#5dd37a';
    }
  };

  const worldToScreenFn = (worldPos: THREE.Vector3) =>
    worldToScreen(worldPos, camera);

  return {
    worldToScreen: worldToScreenFn,
    arrow,
    selectionArrow: selectionArrowGroup,
    shaftGeometry,
    shaftMaterial,
    headGeometry,
    headMaterial,
    towerRangeMaterial,
    selectionArrowScratch: {
      cameraRight: selectionArrowCameraRightScratch,
      cameraUp: selectionArrowCameraUpScratch,
      cameraForward: selectionArrowCameraForwardScratch,
      basisMatrix: selectionArrowBasisMatrixScratch,
    },
    playerShootRangeRing,
    spawnFloatingDamageText,
    updateFloatingDamageTexts,
    updateHealthBars,
  };
};

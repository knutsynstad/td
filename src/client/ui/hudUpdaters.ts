import * as THREE from 'three';
import { clamp } from '../domains/world/collision';
import type {
  MobEntity,
  PlayerEntity,
  StaticCollider,
} from '../domains/gameplay/types/entities';
import type { StructureStore } from '../domains/gameplay/structureStore';
import type { GameState } from '../domains/gameplay/gameState';
import {
  getCoinPileClusterCountPerCorner,
  getCoinPileHeightScale,
  buildCoinPileVisual,
} from './coinPileHelpers';
import { disposeObjectMeshes } from '../rendering/disposeUtils';

export type CoinTrail = {
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
  visualOnly?: boolean;
  spinStartDeg: number;
  spinTotalDeg: number;
  pitchStartDeg: number;
  pitchTotalDeg: number;
  rollStartDeg: number;
  rollTotalDeg: number;
  baseScale: number;
};

export type HudUpdatersContext = {
  coinHudCanvasEl: HTMLCanvasElement;
  hudCoinsEl: HTMLElement;
  coinHudRenderer: THREE.WebGLRenderer;
  coinHudCamera: THREE.PerspectiveCamera;
  coinHudRoot: THREE.Group;
  coinHudScene: THREE.Scene;
  coinModelTemplateRef: { current: THREE.Object3D | null };
  minimapCanvasEl: HTMLCanvasElement;
  minimapCtx: CanvasRenderingContext2D | null;
  minimapCastleIcon: HTMLImageElement;
  coinTrailRenderer: THREE.WebGLRenderer;
  coinTrailCamera: THREE.OrthographicCamera;
  coinTrailScene: THREE.Scene;
  eventBannerEl: HTMLDivElement;
  castleCoinPiles: THREE.Group;
  castleCollider: StaticCollider;
  camera: THREE.OrthographicCamera;
  player: PlayerEntity;
  mobs: MobEntity[];
  structureStore: StructureStore;
  gameState: GameState;
  activeCoinTrails: CoinTrail[];
  WORLD_BOUNDS: number;
  isMinimapExpandedRef: { current: boolean };
  minimapEmbellishAlphaRef: { current: number };
  EVENT_BANNER_DURATION: number;
  REPAIR_WARNING_HP_RATIO: number;
  REPAIR_CRITICAL_HP_RATIO: number;
  addCoins: (amount: number, withPop?: boolean) => void;
};

export type HudUpdaters = {
  updateCoinHudView: (delta: number) => void;
  syncHudCoinModel: () => void;
  updateCastleCoinPilesVisual: () => void;
  updateCoinTrails: (delta: number) => void;
  spawnCastleCoinTrails: (
    amount: number,
    direction: 'toCastle' | 'toHud'
  ) => void;
  drawMinimap: () => void;
  syncCoinTrailViewport: () => void;
  syncMinimapCanvasSize: () => void;
  triggerEventBanner: (text: string, duration?: number) => void;
  clearEventBanner: () => void;
};

const MINIMAP_MOB_SMOOTH_FACTOR = 0.3;

export const createHudUpdaters = (ctx: HudUpdatersContext): HudUpdaters => {
  const minimapMobPosCache = new Map<string, { x: number; z: number }>();

  const updateCoinHudView = (delta: number) => {
    const rect = ctx.coinHudCanvasEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    ctx.coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    ctx.coinHudRenderer.setSize(width, height, false);
    ctx.coinHudCamera.aspect = width / height;
    ctx.coinHudCamera.updateProjectionMatrix();
    if (ctx.coinHudRoot.children.length > 0) {
      const spinSpeed = 1.75;
      ctx.coinHudRoot.rotation.y += delta * spinSpeed;
    }
    ctx.coinHudRenderer.render(ctx.coinHudScene, ctx.coinHudCamera);
  };

  const syncHudCoinModel = () => {
    ctx.coinHudRoot.clear();
    if (!ctx.coinModelTemplateRef.current) return;
    const hudCoin = ctx.coinModelTemplateRef.current.clone(true);
    hudCoin.scale.multiplyScalar(0.85);
    hudCoin.rotation.y = Math.PI / 7;
    ctx.coinHudRoot.add(hudCoin);
  };

  const updateCastleCoinPilesVisual = () => {
    for (const child of Array.from(ctx.castleCoinPiles.children)) {
      ctx.castleCoinPiles.remove(child);
      disposeObjectMeshes(child);
    }
    if (ctx.gameState.castleCoins <= 0) return;
    const cx = ctx.castleCollider.center.x;
    const cz = ctx.castleCollider.center.z;
    const offsetX = ctx.castleCollider.halfSize.x + 0.28;
    const offsetZ = ctx.castleCollider.halfSize.z + 0.28;
    const corners = [
      new THREE.Vector3(cx + offsetX, 0, cz + offsetZ),
      new THREE.Vector3(cx + offsetX, 0, cz - offsetZ),
      new THREE.Vector3(cx - offsetX, 0, cz + offsetZ),
      new THREE.Vector3(cx - offsetX, 0, cz - offsetZ),
    ];
    const safeBank = Math.max(0, ctx.gameState.castleCoins);
    const clustersPerCorner = getCoinPileClusterCountPerCorner(safeBank);
    const totalClusters = Math.max(1, corners.length * clustersPerCorner);
    const perClusterCoins = safeBank / totalClusters;
    const heightScale = getCoinPileHeightScale(safeBank);
    for (let i = 0; i < corners.length; i += 1) {
      const corner = corners[i]!;
      for (
        let clusterIdx = 0;
        clusterIdx < clustersPerCorner;
        clusterIdx += 1
      ) {
        const pile = buildCoinPileVisual(
          perClusterCoins,
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
        ctx.castleCoinPiles.add(pile);
      }
    }
  };

  const syncCoinTrailViewport = () => {
    ctx.coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    ctx.coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false);
    ctx.coinTrailCamera.left = 0;
    ctx.coinTrailCamera.right = window.innerWidth;
    ctx.coinTrailCamera.top = window.innerHeight;
    ctx.coinTrailCamera.bottom = 0;
    ctx.coinTrailCamera.updateProjectionMatrix();
  };

  const syncMinimapCanvasSize = () => {
    const rect = ctx.minimapCanvasEl.getBoundingClientRect();
    const pixelRatioCap =
      ctx.isMinimapExpandedRef.current ||
      ctx.minimapEmbellishAlphaRef.current > 0.02
        ? 3.5
        : 2;
    const pixelRatio = Math.max(
      1,
      Math.min(window.devicePixelRatio, pixelRatioCap)
    );
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (
      ctx.minimapCanvasEl.width !== width ||
      ctx.minimapCanvasEl.height !== height
    ) {
      ctx.minimapCanvasEl.width = width;
      ctx.minimapCanvasEl.height = height;
    }
  };

  const drawMinimap = () => {
    if (!ctx.minimapCtx) return;
    const width = ctx.minimapCanvasEl.width;
    const height = ctx.minimapCanvasEl.height;
    if (width <= 0 || height <= 0) return;
    const minDimension = Math.min(width, height);
    const baseMarkerScale = Math.max(1, minDimension / 84);
    const markerScale = baseMarkerScale * Math.min(1, 200 / minDimension);

    ctx.minimapCtx.clearRect(0, 0, width, height);

    const forward3 = ctx.camera.getWorldDirection(new THREE.Vector3());
    const forward2 = new THREE.Vector2(forward3.x, forward3.z);
    if (forward2.lengthSq() <= 1e-5) {
      forward2.set(0, -1);
    } else {
      forward2.normalize();
    }
    const right2 = new THREE.Vector2(-forward2.y, forward2.x);
    const axisExtent = ctx.WORLD_BOUNDS * Math.SQRT2;

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
    if (
      ctx.minimapCastleIcon.complete &&
      ctx.minimapCastleIcon.naturalWidth > 0
    ) {
      ctx.minimapCtx.drawImage(
        ctx.minimapCastleIcon,
        center.x - castleIconSize * 0.5,
        center.y - castleIconSize * 0.5,
        castleIconSize,
        castleIconSize
      );
    } else {
      ctx.minimapCtx.fillStyle = '#f0d066';
      ctx.minimapCtx.fillRect(
        center.x - castleIconSize * 0.35,
        center.y - castleIconSize * 0.35,
        castleIconSize * 0.7,
        castleIconSize * 0.7
      );
    }

    const playerPoint = worldToMap(
      ctx.player.mesh.position.x,
      ctx.player.mesh.position.z
    );
    ctx.minimapCtx.fillStyle = '#62ff9a';
    ctx.minimapCtx.beginPath();
    ctx.minimapCtx.arc(
      playerPoint.x,
      playerPoint.y,
      Math.max(2.6, 2.6 * markerScale),
      0,
      Math.PI * 2
    );
    ctx.minimapCtx.fill();

    ctx.minimapCtx.fillStyle = '#ff6a6a';
    const seenMobIds = new Set<string>();
    for (const mob of ctx.mobs) {
      const mobKey = mob.mobId ?? `mesh-${mob.mesh.id}`;
      seenMobIds.add(mobKey);
      const targetX = mob.mesh.position.x;
      const targetZ = mob.mesh.position.z;
      let cached = minimapMobPosCache.get(mobKey);
      if (!cached) {
        cached = { x: targetX, z: targetZ };
        minimapMobPosCache.set(mobKey, cached);
      } else {
        cached.x += (targetX - cached.x) * MINIMAP_MOB_SMOOTH_FACTOR;
        cached.z += (targetZ - cached.z) * MINIMAP_MOB_SMOOTH_FACTOR;
      }
      const point = worldToMap(cached.x, cached.z);
      ctx.minimapCtx.beginPath();
      ctx.minimapCtx.arc(
        point.x,
        point.y,
        Math.max(1.8, 1.8 * markerScale),
        0,
        Math.PI * 2
      );
      ctx.minimapCtx.fill();
    }
    for (const id of minimapMobPosCache.keys()) {
      if (!seenMobIds.has(id)) minimapMobPosCache.delete(id);
    }

    for (const [
      collider,
      state,
    ] of ctx.structureStore.structureStates.entries()) {
      if (collider.type !== 'wall' && collider.type !== 'tower') continue;
      if (state.playerBuilt !== true) continue;
      const hpRatio = state.maxHp <= 0 ? 1 : state.hp / state.maxHp;
      if (hpRatio >= ctx.REPAIR_WARNING_HP_RATIO) continue;
      const point = worldToMap(collider.center.x, collider.center.z);
      ctx.minimapCtx.fillStyle =
        hpRatio <= ctx.REPAIR_CRITICAL_HP_RATIO ? '#ff6a6a' : '#ffcf73';
      ctx.minimapCtx.beginPath();
      ctx.minimapCtx.arc(
        point.x,
        point.y,
        Math.max(1.4, 1.4 * markerScale),
        0,
        Math.PI * 2
      );
      ctx.minimapCtx.fill();
    }
  };

  const triggerEventBanner = (
    text: string,
    duration = ctx.EVENT_BANNER_DURATION
  ) => {
    ctx.eventBannerEl.textContent = '';
    const line = document.createElement('div');
    line.className = 'event-banner__single';
    line.textContent = text;
    ctx.eventBannerEl.appendChild(line);
    ctx.eventBannerEl.classList.remove('stack');
    ctx.eventBannerEl.classList.add('single');
    ctx.eventBannerEl.style.setProperty('--banner-duration', `${duration}s`);
    ctx.eventBannerEl.classList.remove('show');
    void ctx.eventBannerEl.offsetWidth;
    ctx.eventBannerEl.classList.add('show');
    ctx.gameState.eventBannerTimer = duration;
  };

  const clearEventBanner = () => {
    ctx.eventBannerEl.classList.remove('show');
    ctx.eventBannerEl.textContent = '';
    ctx.gameState.eventBannerTimer = 0;
  };

  const worldToScreen = (worldPos: THREE.Vector3) => {
    const vector = worldPos.clone();
    vector.project(ctx.camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
    return { x, y };
  };

  const spawnCastleCoinTrails = (
    amount: number,
    direction: 'toCastle' | 'toHud'
  ) => {
    if (!ctx.coinModelTemplateRef.current || amount <= 0) return;
    const count = Math.min(8, Math.max(1, Math.floor(amount / 3)));
    const hudRect = ctx.hudCoinsEl.getBoundingClientRect();
    const hudX = hudRect.left + hudRect.width * 0.5;
    const hudY = hudRect.top + hudRect.height * 0.5;
    const castleScreen = worldToScreen(ctx.castleCollider.center);
    const startX = direction === 'toCastle' ? hudX : castleScreen.x;
    const startY = direction === 'toCastle' ? hudY : castleScreen.y;
    const endX = direction === 'toCastle' ? castleScreen.x : hudX;
    const endY = direction === 'toCastle' ? castleScreen.y : hudY;
    const arcOffset = 0.15 * Math.hypot(endX - startX, endY - startY);
    const midY = Math.min(startY, endY) - arcOffset;
    const control1X = startX + (endX - startX) * 0.33;
    const control1Y = midY;
    const control2X = startX + (endX - startX) * 0.67;
    const control2Y = midY;
    const duration = 0.55;
    const stagger = 0.04;

    for (let i = 0; i < count; i += 1) {
      const mesh = ctx.coinModelTemplateRef.current.clone(true);
      const materials: THREE.Material[] = [];
      mesh.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material) {
          const mat = Array.isArray(node.material)
            ? node.material
            : [node.material];
          materials.push(...mat);
        }
      });
      const baseScale = 28;
      const trail: CoinTrail = {
        mesh,
        materials,
        startX,
        startY,
        control1X,
        control1Y,
        control2X,
        control2Y,
        endX,
        endY,
        elapsed: i * stagger,
        duration,
        reward: 0,
        visualOnly: true,
        spinStartDeg: i * 45,
        spinTotalDeg: 180 + i * 22,
        pitchStartDeg: 5,
        pitchTotalDeg: 12,
        rollStartDeg: 0,
        rollTotalDeg: 90,
        baseScale,
      };
      mesh.position.set(startX, window.innerHeight - startY, 0);
      mesh.scale.setScalar(baseScale);
      ctx.coinTrailScene.add(mesh);
      ctx.activeCoinTrails.push(trail);
    }
  };

  const updateCoinTrails = (delta: number) => {
    for (let i = ctx.activeCoinTrails.length - 1; i >= 0; i -= 1) {
      const trail = ctx.activeCoinTrails[i]!;
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
        ctx.coinTrailScene.remove(trail.mesh);
        for (const material of trail.materials) {
          material.dispose();
        }
        ctx.activeCoinTrails.splice(i, 1);
        if (!trail.visualOnly) {
          ctx.addCoins(trail.reward, true);
        }
      }
    }
  };

  return {
    updateCoinHudView,
    syncHudCoinModel,
    updateCastleCoinPilesVisual,
    updateCoinTrails,
    spawnCastleCoinTrails,
    drawMinimap,
    syncCoinTrailViewport,
    syncMinimapCanvasSize,
    triggerEventBanner,
    clearEventBanner,
  };
};

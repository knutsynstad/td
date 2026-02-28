import * as THREE from 'three';
import {
  COIN_PILE_CYLINDER_MAX,
  COIN_PILE_CYLINDER_MIN,
  COIN_PILE_CLUSTER_MAX_PER_CORNER,
  COIN_PILE_MAX_RADIUS,
} from '../clientConstants';

export const getCoinPileCylinderCount = (castleCoins: number): number => {
  const safeBank = Math.max(0, castleCoins);
  const growthLevel = Math.max(0, Math.floor(Math.log2(safeBank + 1)));
  return Math.min(COIN_PILE_CYLINDER_MAX, COIN_PILE_CYLINDER_MIN + growthLevel);
};

export const getCoinPileClusterCountPerCorner = (castleCoins: number): number => {
  const safeBank = Math.max(0, castleCoins);
  const growthLevel = Math.max(0, Math.floor(Math.log2(safeBank + 1)));
  return Math.min(
    COIN_PILE_CLUSTER_MAX_PER_CORNER,
    1 + Math.floor(growthLevel / 4)
  );
};

export const getCoinPileHeightScale = (castleCoins: number): number => {
  const safeBank = Math.max(1, castleCoins);
  return Math.min(2.6, 1 + Math.log10(safeBank) * 0.28);
};

export const buildCoinPileVisual = (
  castleCoins: number,
  densityScale = 1,
  spreadScale = 1,
  phaseOffset = 0,
  heightScale = 1
): THREE.Group => {
  const group = new THREE.Group();
  const safeBank = Math.max(0, castleCoins);
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

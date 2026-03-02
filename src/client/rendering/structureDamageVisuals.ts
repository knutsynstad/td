import * as THREE from 'three';
import { clamp } from '../domains/world/collision';
import type { StructureStore } from '../domains/gameplay/structureStore';

const DAMAGE_TINT = new THREE.Color(0xff5d5d);
const TEMP_BASE_COLOR = new THREE.Color();

export type ApplyStructureDamageVisualsContext = {
  structureStore: StructureStore;
  repairWarningHpRatio: number;
  repairCriticalHpRatio: number;
};

export const createApplyStructureDamageVisuals = (
  ctx: ApplyStructureDamageVisualsContext
): (() => void) => {
  return () => {
    for (const [collider, state] of ctx.structureStore.structureStates) {
      if (collider.type !== 'wall' && collider.type !== 'tower') continue;
      const hpRatio = state.maxHp <= 0 ? 1 : state.hp / state.maxHp;
      const missingRatio = 1 - clamp(hpRatio, 0, 1);
      const tintStrength =
        missingRatio >= ctx.repairWarningHpRatio
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
};

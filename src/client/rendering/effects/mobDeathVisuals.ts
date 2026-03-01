import * as THREE from 'three';
import type { MobEntity } from '../../domains/gameplay/types/entities';
import { clamp } from '../../domains/world/collision';

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

const DEATH_FLASH_TINT = new THREE.Color(0xff4444);
const TEMP_BASE_COLOR = new THREE.Color();

export const createMobDeathVisualSystem = (scene: THREE.Scene) => {
  const visuals: MobDeathVisual[] = [];
  const visualPool: MobDeathVisual[] = [];

  const clear = () => {
    for (const visual of visuals) {
      scene.remove(visual.root);
      for (const material of visual.materials) {
        material.dispose();
      }
    }
    visuals.length = 0;
    for (const visual of visualPool) {
      scene.remove(visual.root);
      for (const material of visual.materials) {
        material.dispose();
      }
    }
    visualPool.length = 0;
  };

  const acquireFromPool = (): MobDeathVisual | null => visualPool.pop() ?? null;

  const returnToPool = (visual: MobDeathVisual) => {
    scene.remove(visual.root);
    for (const material of visual.materials) {
      material.opacity = 1;
      const tintable = material as THREE.Material & { color?: THREE.Color };
      if (tintable.color) {
        const baseHex = tintable.userData.deathFlashBaseColorHex as
          | number
          | undefined;
        if (baseHex !== undefined) tintable.color.setHex(baseHex);
      }
    }
    visualPool.push(visual);
  };

  const spawn = (
    mob: MobEntity,
    template: THREE.Object3D | null,
    groundOffsetY: number,
    headingOffset: number
  ) => {
    if (!template) return;
    const DEATH_VISUAL_LIFT_Y = 0.3;
    const headingSpeedSq =
      mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z;
    let heading =
      headingSpeedSq > 1e-6
        ? Math.atan2(mob.velocity.x, mob.velocity.z) + headingOffset
        : headingOffset;
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
          Math.atan2(normalizedHitDirX, normalizedHitDirZ) + headingOffset;
        fallSign = -1;
        const DEATH_KNOCKBACK_DISTANCE = 2.6;
        knockbackX = normalizedHitDirX * DEATH_KNOCKBACK_DISTANCE;
        knockbackZ = normalizedHitDirZ * DEATH_KNOCKBACK_DISTANCE;
      }
    }

    const pooled = acquireFromPool();
    if (pooled) {
      pooled.root.position.copy(mob.mesh.position);
      pooled.root.position.y += groundOffsetY + DEATH_VISUAL_LIFT_Y;
      pooled.root.rotation.set(0, heading, 0);
      pooled.root.rotateX(0);
      pooled.age = 0;
      pooled.heading = heading;
      pooled.fallSign = fallSign;
      pooled.startX = pooled.root.position.x;
      pooled.startZ = pooled.root.position.z;
      pooled.startY = pooled.root.position.y;
      pooled.knockbackX = knockbackX;
      pooled.knockbackZ = knockbackZ;
      scene.add(pooled.root);
      visuals.push(pooled);
      return;
    }

    const deathRoot = new THREE.Group();
    const corpse = template.clone(true);
    const corpseBounds = new THREE.Box3().setFromObject(corpse);
    if (!corpseBounds.isEmpty()) {
      corpse.position.y -= corpseBounds.min.y;
    }
    deathRoot.add(corpse);
    deathRoot.position.copy(mob.mesh.position);
    deathRoot.position.y += groundOffsetY + DEATH_VISUAL_LIFT_Y;
    const startX = deathRoot.position.x;
    const startZ = deathRoot.position.z;
    const startY = deathRoot.position.y;
    deathRoot.rotation.y = heading;

    const deathMaterials: THREE.Material[] = [];
    corpse.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const clonedMaterial = Array.isArray(node.material)
        ? node.material.map((material: THREE.Material) => material.clone())
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

    visuals.push({
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

  const update = (delta: number) => {
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
    for (let i = visuals.length - 1; i >= 0; i -= 1) {
      const visual = visuals[i]!;
      visual.age += delta;
      const clampedFallT = clamp(visual.age / FALL_DURATION, 0, 1);
      const easedFall = 1 - (1 - clampedFallT) * (1 - clampedFallT);
      const knockbackT = clamp(visual.age / KNOCKBACK_DURATION, 0, 1);
      const knockbackEase =
        1 - (1 - knockbackT) * (1 - knockbackT) * (1 - knockbackT);
      visual.root.position.x =
        visual.startX + visual.knockbackX * knockbackEase;
      visual.root.position.z =
        visual.startZ + visual.knockbackZ * knockbackEase;
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
        visuals.splice(i, 1);
        returnToPool(visual);
      }
    }
  };

  return { spawn, update, clear };
};

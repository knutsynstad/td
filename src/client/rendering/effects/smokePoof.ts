import * as THREE from 'three';

type SmokePoofInstance = {
  root: THREE.Object3D;
  materials: THREE.Material[];
  age: number;
  maxAge: number;
  baseScale: number;
  velocity: THREE.Vector3;
  velocityDecay: number;
};

const POP_DURATION = 0.12;
const FADE_DURATION = 0.45;
const TOTAL_DURATION = POP_DURATION + FADE_DURATION;
const SIZE_MULTIPLIER = 0.2;
const SPRAY_SPEED_MIN = 0.8;
const SPRAY_SPEED_MAX = 1.6;
const SPRAY_UP_MIN = 0.4;
const SPRAY_UP_MAX = 0.9;

const collectMaterials = (root: THREE.Object3D): THREE.Material[] => {
  const materials: THREE.Material[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material;
    if (Array.isArray(source)) {
      const cloned = source.map((material) => {
        const next = material.clone();
        next.transparent = true;
        return next;
      });
      child.material = cloned;
      materials.push(...cloned);
      return;
    }
    const cloned = source.clone();
    cloned.transparent = true;
    child.material = cloned;
    materials.push(cloned);
  });
  return materials;
};

const setObjectOpacity = (materials: THREE.Material[], opacity: number) => {
  for (const material of materials) {
    if ('opacity' in material) {
      (material as THREE.Material & { opacity: number }).opacity = opacity;
    }
  }
};

export type SmokePoofOptions = {
  scaleMultiplier?: number;
  count?: number;
  spreadMultiplier?: number;
  velocity?: THREE.Vector3;
  velocityDecay?: number;
};

export type SmokePoofEffect = {
  spawnSmokePoof: (pos: THREE.Vector3, options?: SmokePoofOptions) => void;
  setSmokeTemplate: (template: THREE.Object3D | null) => void;
  updateSmokePoofs: (delta: number) => void;
};

export const createSmokePoofEffect = (scene: THREE.Scene): SmokePoofEffect => {
  const instances: SmokePoofInstance[] = [];
  let smokeTemplate: THREE.Object3D | null = null;

  const spawnSmokePoof = (pos: THREE.Vector3, options?: SmokePoofOptions) => {
    if (!smokeTemplate) return;

    const count = options?.count ?? 10;
    const scaleMult = options?.scaleMultiplier ?? 1;
    const spreadMult = options?.spreadMultiplier ?? 1;
    for (let i = 0; i < count; i++) {
      const root = smokeTemplate.clone(true);
      const jitter = 0.05;
      root.position.set(
        pos.x + (Math.random() - 0.5) * 2 * jitter,
        pos.y,
        pos.z + (Math.random() - 0.5) * 2 * jitter
      );
      root.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      const baseScale =
        SIZE_MULTIPLIER * (0.7 + Math.random() * 0.5) * scaleMult;
      root.scale.setScalar(0.4 * baseScale);
      const angle = Math.random() * Math.PI * 2;
      const speed =
        (SPRAY_SPEED_MIN +
          Math.random() * (SPRAY_SPEED_MAX - SPRAY_SPEED_MIN)) *
        spreadMult;
      const up =
        (SPRAY_UP_MIN + Math.random() * (SPRAY_UP_MAX - SPRAY_UP_MIN)) *
        spreadMult;
      const velocity = options?.velocity
        ? options.velocity.clone()
        : new THREE.Vector3(
            Math.cos(angle) * speed,
            up,
            Math.sin(angle) * speed
          );
      const materials = collectMaterials(root);
      scene.add(root);

      instances.push({
        root,
        materials,
        age: 0,
        maxAge: TOTAL_DURATION,
        baseScale,
        velocity,
        velocityDecay: options?.velocityDecay ?? 0,
      });
    }
  };

  const setSmokeTemplate = (template: THREE.Object3D | null) => {
    smokeTemplate = template;
  };

  const updateSmokePoofs = (delta: number) => {
    for (let i = instances.length - 1; i >= 0; i--) {
      const inst = instances[i]!;
      inst.age += delta;

      inst.root.position.add(inst.velocity.clone().multiplyScalar(delta));
      if (inst.velocityDecay > 0) {
        const decayFactor = Math.max(0, 1 - inst.velocityDecay * delta);
        inst.velocity.multiplyScalar(decayFactor);
      }

      const popT = Math.min(1, inst.age / POP_DURATION);
      const popEase = 1 - (1 - popT) * (1 - popT);
      const scale = (0.4 + popEase * 1.0) * inst.baseScale;
      inst.root.scale.setScalar(scale);

      const fadeStart = POP_DURATION;
      const fadeT =
        inst.age <= fadeStart
          ? 1
          : Math.max(0, 1 - (inst.age - fadeStart) / FADE_DURATION);
      setObjectOpacity(inst.materials, fadeT);

      if (inst.age >= inst.maxAge) {
        scene.remove(inst.root);
        inst.root.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        for (const material of inst.materials) {
          material.dispose();
        }
        instances.splice(i, 1);
      }
    }
  };

  return {
    spawnSmokePoof,
    setSmokeTemplate,
    updateSmokePoofs,
  };
};

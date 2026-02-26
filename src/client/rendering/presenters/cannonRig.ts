import * as THREE from 'three';

export type CannonVisualRig = {
  root: THREE.Group;
  cradleYawGroup: THREE.Group;
  barrelPitchGroup: THREE.Group;
  muzzleAnchor: THREE.Object3D;
  cradleYawPivotLocal: THREE.Vector3;
  barrelPitchPivotLocal: THREE.Vector3;
  baseForwardYaw: number;
};

const YAW_TURN_SPEED_RAD_PER_SEC = Math.PI * 2;
const PITCH_TURN_SPEED_RAD_PER_SEC = Math.PI * 1.5;
const IDLE_PITCH_RAD = THREE.MathUtils.degToRad(30);
const MAX_TRACK_PITCH_RAD = THREE.MathUtils.degToRad(70);
const AIM_LOCK_TOLERANCE_RAD = THREE.MathUtils.degToRad(4);

const setShadows = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const normalize = (n: string) =>
  n.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');

const getObjectByNameCaseInsensitive = (
  template: THREE.Object3D,
  name: string
) => {
  const direct = template.getObjectByName(name);
  if (direct) return direct;
  const targetNorm = normalize(name);
  let match: THREE.Object3D | null = null;
  template.traverse((child) => {
    if (match) return;
    if (normalize(child.name || '') !== targetNorm) return;
    match = child;
  });
  return match;
};

const getObjectByNamePrefix = (
  template: THREE.Object3D,
  prefix: string
): THREE.Object3D | null => {
  const targetNorm = normalize(prefix);
  let match: THREE.Object3D | null = null;
  template.traverse((child) => {
    if (match) return;
    const nameNorm = normalize(child.name || '');
    if (!nameNorm.startsWith(targetNorm)) return;
    match = child;
  });
  return match;
};

const getPartCaseInsensitive = (template: THREE.Object3D, name: string) => {
  const part = getObjectByNameCaseInsensitive(template, name);
  return part ? part.clone(true) : null;
};

const getPartWithVariants = (
  template: THREE.Object3D,
  ...names: string[]
) => {
  for (const name of names) {
    const part = getPartCaseInsensitive(template, name);
    if (part) return part;
  }
  return null;
};

const getPartByPrefix = (template: THREE.Object3D, prefix: string) => {
  const part = getObjectByNamePrefix(template, prefix);
  return part ? part.clone(true) : null;
};

export const createCannonVisualRig = (
  template: THREE.Object3D
): CannonVisualRig | null => {
  const base = getPartWithVariants(template, 'Base', 'Base.001') ?? getPartByPrefix(template, 'Base');
  const cradle = getPartWithVariants(template, 'Cradle', 'Cradle.001') ?? getPartByPrefix(template, 'Cradle');
  const barrel = getPartCaseInsensitive(template, 'Barrel') ?? getPartByPrefix(template, 'Barrel');
  const cradleRotation =
    getObjectByNameCaseInsensitive(template, 'Cradle Rotation') ??
    getObjectByNameCaseInsensitive(template, 'CradleRotation');
  const barrelPivot =
    getObjectByNameCaseInsensitive(template, 'Barrel Pivot') ??
    getObjectByNameCaseInsensitive(template, 'BarrelPivot') ??
    getObjectByNamePrefix(template, 'Barrel Pivot');
  if (!base || !cradle || !barrel || !cradleRotation || !barrelPivot) return null;

  const muzzleAnchor = barrelPivot.clone(true);
  muzzleAnchor.position.set(0, 0, 0);

  const root = new THREE.Group();
  root.name = 'CannonRigRoot';

  const cradleYawGroup = new THREE.Group();
  cradleYawGroup.name = 'CannonRigCradleYaw';

  const barrelPitchGroup = new THREE.Group();
  barrelPitchGroup.name = 'CannonRigBarrelPitch';

  const cradleYawPivotLocal = cradleRotation.position.clone();
  cradleYawGroup.position.copy(cradleYawPivotLocal);

  const cradleOffsetGroup = new THREE.Group();
  cradleOffsetGroup.position.copy(cradleYawPivotLocal).multiplyScalar(-1);

  const barrelPitchPivotLocal = barrelPivot.position.clone();
  const barrelPivotInCradleSpace = new THREE.Vector3()
    .copy(barrelPitchPivotLocal)
    .sub(cradleYawPivotLocal);
  barrelPitchGroup.position.copy(barrelPivotInCradleSpace);

  const barrelOffsetGroup = new THREE.Group();
  barrelOffsetGroup.position.copy(barrelPivotInCradleSpace).multiplyScalar(-1);

  root.add(base);
  root.add(cradleYawGroup);
  cradleYawGroup.add(cradleOffsetGroup);
  cradleYawGroup.add(barrelPitchGroup);
  cradleOffsetGroup.add(cradle);
  barrelPitchGroup.add(barrelOffsetGroup);
  barrelOffsetGroup.add(barrel);
  barrelPitchGroup.add(muzzleAnchor);

  const cradleForwardLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(
    cradleRotation.quaternion
  );
  const baseForwardYaw =
    Math.atan2(cradleForwardLocal.x, cradleForwardLocal.z) + Math.PI / 2;

  muzzleAnchor.quaternion.copy(barrelPivot.quaternion);

  setShadows(root);

  return {
    root,
    cradleYawGroup,
    barrelPitchGroup,
    muzzleAnchor,
    cradleYawPivotLocal,
    barrelPitchPivotLocal,
    baseForwardYaw,
  };
};

export const updateCannonRigTracking = (
  rig: CannonVisualRig,
  sourcePos: THREE.Vector3,
  targetPos: THREE.Vector3 | null,
  desiredLaunchVelocity: THREE.Vector3 | null,
  deltaSeconds: number
) => {
  const dt = Math.max(deltaSeconds, 0);
  let yawError = 0;
  let desiredPitch = IDLE_PITCH_RAD;
  if (desiredLaunchVelocity && desiredLaunchVelocity.lengthSq() > 1e-8) {
    const horizontalLenSq =
      desiredLaunchVelocity.x * desiredLaunchVelocity.x +
      desiredLaunchVelocity.z * desiredLaunchVelocity.z;
    if (horizontalLenSq > 1e-8) {
      const targetYaw = Math.atan2(
        desiredLaunchVelocity.x,
        desiredLaunchVelocity.z
      );
      const desiredYaw = targetYaw - rig.baseForwardYaw;
      const yawDelta =
        THREE.MathUtils.euclideanModulo(
          desiredYaw - rig.cradleYawGroup.rotation.y + Math.PI,
          Math.PI * 2
        ) - Math.PI;
      const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
      const clampedYawStep = THREE.MathUtils.clamp(
        yawDelta,
        -maxYawStep,
        maxYawStep
      );
      rig.cradleYawGroup.rotation.y += clampedYawStep;
      yawError = Math.abs(yawDelta - clampedYawStep);
    }
    desiredPitch = THREE.MathUtils.clamp(
      -Math.atan2(desiredLaunchVelocity.y, Math.sqrt(horizontalLenSq)),
      -MAX_TRACK_PITCH_RAD,
      MAX_TRACK_PITCH_RAD
    );
  } else if (targetPos) {
    const pivotWorldX = sourcePos.x + rig.cradleYawPivotLocal.x;
    const pivotWorldY = sourcePos.y + rig.cradleYawPivotLocal.y;
    const pivotWorldZ = sourcePos.z + rig.cradleYawPivotLocal.z;
    const dx = targetPos.x - pivotWorldX;
    const dy = targetPos.y - pivotWorldY;
    const dz = targetPos.z - pivotWorldZ;
    const horizontalLenSq = dx * dx + dz * dz;
    if (horizontalLenSq > 1e-6) {
      const targetYaw = Math.atan2(dx, dz);
      const desiredYaw = targetYaw - rig.baseForwardYaw;
      const yawDelta =
        THREE.MathUtils.euclideanModulo(
          desiredYaw - rig.cradleYawGroup.rotation.y + Math.PI,
          Math.PI * 2
        ) - Math.PI;
      const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
      const clampedYawStep = THREE.MathUtils.clamp(
        yawDelta,
        -maxYawStep,
        maxYawStep
      );
      rig.cradleYawGroup.rotation.y += clampedYawStep;
      yawError = Math.abs(yawDelta - clampedYawStep);
      desiredPitch = THREE.MathUtils.clamp(
        -Math.atan2(dy, Math.sqrt(horizontalLenSq)),
        -MAX_TRACK_PITCH_RAD,
        MAX_TRACK_PITCH_RAD
      );
    }
  } else {
    const idleYaw = Math.PI;
    const yawDelta =
      THREE.MathUtils.euclideanModulo(
        idleYaw - rig.cradleYawGroup.rotation.y + Math.PI,
        Math.PI * 2
      ) - Math.PI;
    const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
    const clampedYawStep = THREE.MathUtils.clamp(
      yawDelta,
      -maxYawStep,
      maxYawStep
    );
    rig.cradleYawGroup.rotation.y += clampedYawStep;
  }

  const pitchDelta = desiredPitch - rig.barrelPitchGroup.rotation.z;
  const maxPitchStep = PITCH_TURN_SPEED_RAD_PER_SEC * dt;
  const clampedPitchStep = THREE.MathUtils.clamp(
    pitchDelta,
    -maxPitchStep,
    maxPitchStep
  );
  rig.barrelPitchGroup.rotation.z += clampedPitchStep;
  const pitchError = Math.abs(pitchDelta - clampedPitchStep);
  return {
    aimAligned:
      desiredLaunchVelocity !== null &&
      yawError <= AIM_LOCK_TOLERANCE_RAD &&
      pitchError <= AIM_LOCK_TOLERANCE_RAD,
  };
};

export const getCannonMuzzleLaunchPosition = (
  rig: CannonVisualRig,
  out: THREE.Vector3
) => {
  rig.muzzleAnchor.getWorldPosition(out);
  return out;
};

export const getCannonMuzzleLaunchTransform = (
  rig: CannonVisualRig,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion
) => {
  rig.muzzleAnchor.getWorldPosition(outPosition);
  rig.muzzleAnchor.getWorldQuaternion(outQuaternion);
};

const MUZZLE_FORWARD_LOCAL = new THREE.Vector3(0, 1, 0);

export const getCannonMuzzleLaunchDirection = (
  rig: CannonVisualRig,
  out: THREE.Vector3
) => {
  const q = new THREE.Quaternion();
  rig.muzzleAnchor.getWorldQuaternion(q);
  out.copy(MUZZLE_FORWARD_LOCAL).applyQuaternion(q).normalize();
};

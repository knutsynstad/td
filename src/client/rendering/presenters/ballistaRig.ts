import * as THREE from 'three';

export type BallistaVisualRig = {
  root: THREE.Group;
  yawGroup: THREE.Group;
  cradlePitchGroup: THREE.Group;
  arrowAnchor: THREE.Object3D;
  yawPivotLocal: THREE.Vector3;
  baseForwardYaw: number;
};

const YAW_TURN_SPEED_RAD_PER_SEC = Math.PI * 2;
const PITCH_TURN_SPEED_RAD_PER_SEC = Math.PI * 1.5;
const IDLE_PITCH_RAD = THREE.MathUtils.degToRad(30);
const MAX_TRACK_PITCH_RAD = THREE.MathUtils.degToRad(89);
const AIM_LOCK_TOLERANCE_RAD = THREE.MathUtils.degToRad(4);

const setShadows = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const getObjectByNameCaseInsensitive = (
  template: THREE.Object3D,
  name: string
) => {
  const direct = template.getObjectByName(name);
  if (direct) return direct;
  const lowered = name.toLowerCase();
  let match: THREE.Object3D | null = null;
  template.traverse((child) => {
    if (match) return;
    if ((child.name || '').toLowerCase() !== lowered) return;
    match = child;
  });
  return match;
};

const getPartCaseInsensitive = (template: THREE.Object3D, name: string) => {
  const part = getObjectByNameCaseInsensitive(template, name);
  return part ? part.clone(true) : null;
};

export const createBallistaVisualRig = (
  template: THREE.Object3D
): BallistaVisualRig | null => {
  const base = getPartCaseInsensitive(template, 'Base');
  const harness = getPartCaseInsensitive(template, 'Harness');
  const cradle = getPartCaseInsensitive(template, 'Cradle');
  const arrow = getPartCaseInsensitive(template, 'Arrow');
  const facing = getObjectByNameCaseInsensitive(template, 'Facing');
  if (!base || !harness || !cradle || !arrow || !facing) return null;

  const root = new THREE.Group();
  root.name = 'BallistaRigRoot';

  const yawGroup = new THREE.Group();
  yawGroup.name = 'BallistaRigYaw';

  const cradlePitchGroup = new THREE.Group();
  cradlePitchGroup.name = 'BallistaRigCradlePitch';

  const yawPivotLocal = facing.position.clone();
  yawGroup.position.copy(yawPivotLocal);

  const harnessOffsetGroup = new THREE.Group();
  harnessOffsetGroup.position.copy(yawPivotLocal).multiplyScalar(-1);
  const cradleOffsetGroup = new THREE.Group();
  cradleOffsetGroup.position.copy(yawPivotLocal).multiplyScalar(-1);

  root.add(base);
  root.add(yawGroup);
  yawGroup.add(harnessOffsetGroup);
  yawGroup.add(cradlePitchGroup);
  cradlePitchGroup.add(cradleOffsetGroup);
  harnessOffsetGroup.add(harness);
  cradleOffsetGroup.add(cradle);
  cradleOffsetGroup.add(arrow);

  const facingForwardLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(
    facing.quaternion
  );
  const baseForwardYaw = Math.atan2(facingForwardLocal.x, facingForwardLocal.z);

  setShadows(root);

  return {
    root,
    yawGroup,
    cradlePitchGroup,
    arrowAnchor: arrow,
    yawPivotLocal,
    baseForwardYaw,
  };
};

export const updateBallistaRigTracking = (
  rig: BallistaVisualRig,
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
          desiredYaw - rig.yawGroup.rotation.y + Math.PI,
          Math.PI * 2
        ) - Math.PI;
      const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
      const clampedYawStep = THREE.MathUtils.clamp(
        yawDelta,
        -maxYawStep,
        maxYawStep
      );
      rig.yawGroup.rotation.y += clampedYawStep;
      yawError = Math.abs(yawDelta - clampedYawStep);
    }
    desiredPitch = THREE.MathUtils.clamp(
      -Math.atan2(desiredLaunchVelocity.y, Math.sqrt(horizontalLenSq)),
      -MAX_TRACK_PITCH_RAD,
      MAX_TRACK_PITCH_RAD
    );
  } else if (targetPos) {
    const pivotWorldX = sourcePos.x + rig.yawPivotLocal.x;
    const pivotWorldY = sourcePos.y + rig.yawPivotLocal.y;
    const pivotWorldZ = sourcePos.z + rig.yawPivotLocal.z;
    const dx = targetPos.x - pivotWorldX;
    const dy = targetPos.y - pivotWorldY;
    const dz = targetPos.z - pivotWorldZ;
    const horizontalLenSq = dx * dx + dz * dz;
    if (horizontalLenSq > 1e-6) {
      const targetYaw = Math.atan2(dx, dz);
      const desiredYaw = targetYaw - rig.baseForwardYaw;
      const yawDelta =
        THREE.MathUtils.euclideanModulo(
          desiredYaw - rig.yawGroup.rotation.y + Math.PI,
          Math.PI * 2
        ) - Math.PI;
      const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
      const clampedYawStep = THREE.MathUtils.clamp(
        yawDelta,
        -maxYawStep,
        maxYawStep
      );
      rig.yawGroup.rotation.y += clampedYawStep;
      yawError = Math.abs(yawDelta - clampedYawStep);
      desiredPitch = THREE.MathUtils.clamp(
        -Math.atan2(dy, Math.sqrt(horizontalLenSq)),
        -MAX_TRACK_PITCH_RAD,
        MAX_TRACK_PITCH_RAD
      );
    }
  } else {
    const idleYaw = 0;
    const yawDelta =
      THREE.MathUtils.euclideanModulo(
        idleYaw - rig.yawGroup.rotation.y + Math.PI,
        Math.PI * 2
      ) - Math.PI;
    const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt;
    const clampedYawStep = THREE.MathUtils.clamp(
      yawDelta,
      -maxYawStep,
      maxYawStep
    );
    rig.yawGroup.rotation.y += clampedYawStep;
  }

  const pitchDelta = desiredPitch - rig.cradlePitchGroup.rotation.z;
  const maxPitchStep = PITCH_TURN_SPEED_RAD_PER_SEC * dt;
  const clampedPitchStep = THREE.MathUtils.clamp(
    pitchDelta,
    -maxPitchStep,
    maxPitchStep
  );
  rig.cradlePitchGroup.rotation.z += clampedPitchStep;
  const pitchError = Math.abs(pitchDelta - clampedPitchStep);
  return {
    aimAligned:
      desiredLaunchVelocity !== null &&
      yawError <= AIM_LOCK_TOLERANCE_RAD &&
      pitchError <= AIM_LOCK_TOLERANCE_RAD,
  };
};

export const getBallistaArrowLaunchPosition = (
  rig: BallistaVisualRig,
  out: THREE.Vector3
) => {
  rig.arrowAnchor.getWorldPosition(out);
  return out;
};

export const getBallistaArrowLaunchTransform = (
  rig: BallistaVisualRig,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion
) => {
  rig.arrowAnchor.getWorldPosition(outPosition);
  rig.arrowAnchor.getWorldQuaternion(outQuaternion);
};

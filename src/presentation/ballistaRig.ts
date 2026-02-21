import * as THREE from 'three'

export type BallistaVisualRig = {
  root: THREE.Group
  yawGroup: THREE.Group
  cradlePitchGroup: THREE.Group
  yawPivotLocal: THREE.Vector3
  baseForwardYaw: number
}

const YAW_TURN_SPEED_RAD_PER_SEC = Math.PI * 2
const PITCH_TURN_SPEED_RAD_PER_SEC = Math.PI * 1.5
const IDLE_PITCH_RAD = THREE.MathUtils.degToRad(30)

const setShadows = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
  })
}

const getRequiredPart = (template: THREE.Object3D, name: string) => {
  const part = template.getObjectByName(name)
  if (!part) return null
  return part.clone(true)
}

export const createBallistaVisualRig = (template: THREE.Object3D): BallistaVisualRig | null => {
  const base = getRequiredPart(template, 'Base')
  const harness = getRequiredPart(template, 'Harness')
  const cradle = getRequiredPart(template, 'Cradle')
  const facing = template.getObjectByName('Facing')
  if (!base || !harness || !cradle || !facing) return null

  const root = new THREE.Group()
  root.name = 'BallistaRigRoot'

  const yawGroup = new THREE.Group()
  yawGroup.name = 'BallistaRigYaw'

  const cradlePitchGroup = new THREE.Group()
  cradlePitchGroup.name = 'BallistaRigCradlePitch'

  const yawPivotLocal = facing.position.clone()
  yawGroup.position.copy(yawPivotLocal)

  const harnessOffsetGroup = new THREE.Group()
  harnessOffsetGroup.position.copy(yawPivotLocal).multiplyScalar(-1)
  const cradleOffsetGroup = new THREE.Group()
  cradleOffsetGroup.position.copy(yawPivotLocal).multiplyScalar(-1)

  root.add(base)
  root.add(yawGroup)
  yawGroup.add(harnessOffsetGroup)
  yawGroup.add(cradlePitchGroup)
  cradlePitchGroup.add(cradleOffsetGroup)
  harnessOffsetGroup.add(harness)
  cradleOffsetGroup.add(cradle)

  // Facing empty is authored as an arrow; exported forward is local +Y.
  const facingForwardLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(facing.quaternion)
  const baseForwardYaw = Math.atan2(facingForwardLocal.x, facingForwardLocal.z)

  setShadows(root)

  return { root, yawGroup, cradlePitchGroup, yawPivotLocal, baseForwardYaw }
}

export const updateBallistaRigTracking = (
  rig: BallistaVisualRig,
  sourcePos: THREE.Vector3,
  targetPos: THREE.Vector3 | null,
  deltaSeconds: number
) => {
  const dt = Math.max(deltaSeconds, 0)
  if (targetPos) {
    const pivotWorldX = sourcePos.x + rig.yawPivotLocal.x
    const pivotWorldZ = sourcePos.z + rig.yawPivotLocal.z
    const dx = targetPos.x - pivotWorldX
    const dz = targetPos.z - pivotWorldZ
    const horizontalLenSq = dx * dx + dz * dz
    if (horizontalLenSq > 1e-6) {
      const targetYaw = Math.atan2(dx, dz)
      const desiredYaw = targetYaw - rig.baseForwardYaw
      const yawDelta = THREE.MathUtils.euclideanModulo(
        desiredYaw - rig.yawGroup.rotation.y + Math.PI,
        Math.PI * 2
      ) - Math.PI
      const maxYawStep = YAW_TURN_SPEED_RAD_PER_SEC * dt
      const clampedYawStep = THREE.MathUtils.clamp(yawDelta, -maxYawStep, maxYawStep)
      rig.yawGroup.rotation.y += clampedYawStep
    }
  }

  const targetPitch = targetPos ? 0 : IDLE_PITCH_RAD
  const pitchDelta = targetPitch - rig.cradlePitchGroup.rotation.z
  const maxPitchStep = PITCH_TURN_SPEED_RAD_PER_SEC * dt
  const clampedPitchStep = THREE.MathUtils.clamp(pitchDelta, -maxPitchStep, maxPitchStep)
  rig.cradlePitchGroup.rotation.z += clampedPitchStep
}

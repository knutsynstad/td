import * as THREE from 'three'
import type { MobEntity } from '../game/types'

type RenderMobInstancesOptions = {
  mobs: MobEntity[]
  camera: THREE.Camera
  mobInstanceMesh: THREE.InstancedMesh
  mobInstanceDummy: THREE.Object3D
  nowMs: number
  maxVisibleMobInstances: number
  mobInstanceCap: number
  normalMobColor: THREE.Color
  berserkMobColor: THREE.Color
}

export const renderVisibleMobInstances = (opts: RenderMobInstancesOptions) => {
  const WALK_WIGGLE_HEIGHT = 0.052
  const WALK_WIGGLE_ROLL = 0.14
  const WALK_WIGGLE_FREQUENCY = 12
  const maxVisible = Math.min(opts.maxVisibleMobInstances, opts.mobInstanceCap)
  const frustum = new THREE.Frustum()
  const viewProjectionMatrix = new THREE.Matrix4().multiplyMatrices(
    opts.camera.projectionMatrix,
    opts.camera.matrixWorldInverse
  )
  frustum.setFromProjectionMatrix(viewProjectionMatrix)
  const cullingSphere = new THREE.Sphere()
  const cullingRadius = 0.95
  const time = opts.nowMs * 0.001
  let renderCount = 0

  for (const mob of opts.mobs) {
    cullingSphere.center.copy(mob.mesh.position)
    cullingSphere.radius = cullingRadius
    if (!frustum.intersectsSphere(cullingSphere)) continue
    if (renderCount >= maxVisible) break
    opts.mobInstanceDummy.position.copy(mob.mesh.position)
    const speedSq = mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z
    const isWalking = speedSq > 0.05 * 0.05
    const seed = mob.mesh.id * 0.6180339887498948
    const phaseOffset = seed * Math.PI * 2
    const frequency = WALK_WIGGLE_FREQUENCY * (0.88 + ((seed * 7.123) % 0.24))
    const heightScale = 0.9 + ((seed * 3.731) % 0.2)
    const rollScale = 0.88 + ((seed * 5.417) % 0.24)
    const wiggle = isWalking ? Math.sin(time * frequency + phaseOffset) : 0
    opts.mobInstanceDummy.position.y = mob.baseY + wiggle * WALK_WIGGLE_HEIGHT * heightScale
    opts.mobInstanceDummy.scale.setScalar(1)
    const heading = isWalking ? Math.atan2(mob.velocity.x, mob.velocity.z) : 0
    opts.mobInstanceDummy.rotation.set(0, heading, wiggle * WALK_WIGGLE_ROLL * rollScale)
    opts.mobInstanceDummy.updateMatrix()
    opts.mobInstanceMesh.setMatrixAt(renderCount, opts.mobInstanceDummy.matrix)
    opts.mobInstanceMesh.setColorAt(renderCount, mob.berserkMode ? opts.berserkMobColor : opts.normalMobColor)
    renderCount += 1
  }

  opts.mobInstanceMesh.count = renderCount
  opts.mobInstanceMesh.instanceMatrix.needsUpdate = true
  if (opts.mobInstanceMesh.instanceColor) {
    opts.mobInstanceMesh.instanceColor.needsUpdate = true
  }
}

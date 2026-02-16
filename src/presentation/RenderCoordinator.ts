import * as THREE from 'three'
import type { MobEntity } from '../game/types'

type RenderMobInstancesOptions = {
  mobs: MobEntity[]
  camera: THREE.Camera
  mobInstanceMesh: THREE.InstancedMesh
  mobInstanceDummy: THREE.Object3D
  maxVisibleMobInstances: number
  mobInstanceCap: number
  mobInstanceRenderRadius: number
  normalMobColor: THREE.Color
  berserkMobColor: THREE.Color
}

export const renderVisibleMobInstances = (opts: RenderMobInstancesOptions) => {
  const maxVisible = Math.min(opts.maxVisibleMobInstances, opts.mobInstanceCap)
  const camX = opts.camera.position.x
  const camZ = opts.camera.position.z
  let renderCount = 0

  for (const mob of opts.mobs) {
    const dx = mob.mesh.position.x - camX
    const dz = mob.mesh.position.z - camZ
    const distSq = dx * dx + dz * dz
    if (distSq > opts.mobInstanceRenderRadius * opts.mobInstanceRenderRadius) continue
    if (renderCount >= maxVisible) break
    opts.mobInstanceDummy.position.copy(mob.mesh.position)
    opts.mobInstanceDummy.position.y = mob.baseY
    opts.mobInstanceDummy.scale.setScalar(1)
    opts.mobInstanceDummy.rotation.set(0, 0, 0)
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

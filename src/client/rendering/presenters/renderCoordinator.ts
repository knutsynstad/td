import * as THREE from 'three';
import type { MobEntity } from '../../domains/gameplay/types/entities';

type RenderMobInstancesOptions = {
  mobs: MobEntity[];
  camera: THREE.Camera;
  mobInstanceMesh: THREE.InstancedMesh;
  mobHitFlashMesh: THREE.InstancedMesh;
  mobInstanceDummy: THREE.Object3D;
  mobInstanceBaseMatrix: THREE.Matrix4;
  mobInstanceGroundOffsetY: number;
  mobInstanceHeadingOffset: number;
  nowMs: number;
  maxVisibleMobInstances: number;
  mobInstanceCap: number;
  lodNearDistance: number;
  lodFarDistance: number;
  lodMidAnimationStepMs: number;
  lodFarAnimationStepMs: number;
  disableFarWiggle: boolean;
};

export const renderVisibleMobInstances = (opts: RenderMobInstancesOptions) => {
  const WALK_WIGGLE_HEIGHT = 0.052;
  const WALK_WIGGLE_ROLL = 0.14;
  const WALK_WIGGLE_FREQUENCY = 12;
  const maxVisible = Math.min(opts.maxVisibleMobInstances, opts.mobInstanceCap);
  const frustum = new THREE.Frustum();
  const viewProjectionMatrix = new THREE.Matrix4().multiplyMatrices(
    opts.camera.projectionMatrix,
    opts.camera.matrixWorldInverse
  );
  frustum.setFromProjectionMatrix(viewProjectionMatrix);
  const cullingSphere = new THREE.Sphere();
  const cullingRadius = 0.95;
  const finalMatrix = new THREE.Matrix4();
  const time = opts.nowMs * 0.001;
  const cameraPosition = new THREE.Vector3();
  opts.camera.getWorldPosition(cameraPosition);
  const nearDistSq = opts.lodNearDistance * opts.lodNearDistance;
  const farDistSq = opts.lodFarDistance * opts.lodFarDistance;
  let renderCount = 0;
  let flashRenderCount = 0;

  for (const mob of opts.mobs) {
    cullingSphere.center.copy(mob.mesh.position);
    cullingSphere.radius = cullingRadius;
    if (!frustum.intersectsSphere(cullingSphere)) continue;
    if (renderCount >= maxVisible) break;
    opts.mobInstanceDummy.position.copy(mob.mesh.position);
    const speedSq =
      mob.velocity.x * mob.velocity.x + mob.velocity.z * mob.velocity.z;
    const isWalking = speedSq > 0.05 * 0.05;
    const dx = mob.mesh.position.x - cameraPosition.x;
    const dz = mob.mesh.position.z - cameraPosition.z;
    const distanceSq = dx * dx + dz * dz;
    const seed = mob.mesh.id * 0.6180339887498948;
    const phaseOffset = seed * Math.PI * 2;
    const frequency = WALK_WIGGLE_FREQUENCY * (0.88 + ((seed * 7.123) % 0.24));
    const heightScale = 0.9 + ((seed * 3.731) % 0.2);
    const rollScale = 0.88 + ((seed * 5.417) % 0.24);
    let animTime = time;
    if (distanceSq > farDistSq) {
      animTime =
        Math.floor(opts.nowMs / opts.lodFarAnimationStepMs) *
        (opts.lodFarAnimationStepMs / 1000);
    } else if (distanceSq > nearDistSq) {
      animTime =
        Math.floor(opts.nowMs / opts.lodMidAnimationStepMs) *
        (opts.lodMidAnimationStepMs / 1000);
    }
    const shouldWiggle = !(opts.disableFarWiggle && distanceSq > farDistSq);
    const wiggle =
      isWalking && shouldWiggle
        ? Math.sin(animTime * frequency + phaseOffset)
        : 0;
    opts.mobInstanceDummy.position.y =
      mob.baseY +
      opts.mobInstanceGroundOffsetY +
      wiggle * WALK_WIGGLE_HEIGHT * heightScale;
    opts.mobInstanceDummy.scale.setScalar(1);
    const heading =
      (isWalking ? Math.atan2(mob.velocity.x, mob.velocity.z) : 0) +
      opts.mobInstanceHeadingOffset;
    opts.mobInstanceDummy.rotation.set(
      0,
      heading,
      wiggle * WALK_WIGGLE_ROLL * rollScale
    );
    opts.mobInstanceDummy.updateMatrix();
    finalMatrix.multiplyMatrices(
      opts.mobInstanceDummy.matrix,
      opts.mobInstanceBaseMatrix
    );
    opts.mobInstanceMesh.setMatrixAt(renderCount, finalMatrix);
    const flashActive = (mob.hitFlashUntilMs ?? 0) > opts.nowMs;
    if (flashActive) {
      opts.mobHitFlashMesh.setMatrixAt(flashRenderCount, finalMatrix);
      flashRenderCount += 1;
    }
    renderCount += 1;
  }

  opts.mobInstanceMesh.count = renderCount;
  opts.mobInstanceMesh.instanceMatrix.needsUpdate = true;
  opts.mobHitFlashMesh.count = flashRenderCount;
  opts.mobHitFlashMesh.instanceMatrix.needsUpdate = true;
};

import * as THREE from 'three';
import {
  orientArrowToVelocity,
  placeArrowMeshAtFacing,
  type ArrowFacing,
} from './arrowProjectile';
import { getBallistaArrowLaunchTransform } from './ballistaRig';
import type { BallistaVisualRig } from './ballistaRig';
import type {
  ArrowProjectile,
  Entity,
  MobEntity,
  Tower,
} from '../../domains/gameplay/types/entities';
import type { PlayerArrowProjectile } from '../../gameContext';
import type { SpatialGrid } from '../../domains/world/spatialGrid';
import { rollAttackDamage } from '../../domains/gameplay/projectiles';

export type ArrowProjectileSystemContext = {
  scene: THREE.Scene;
  spatialGrid: SpatialGrid;
  mobs: MobEntity[];
  player: { mesh: THREE.Object3D };
  activeArrowProjectiles: ArrowProjectile[];
  activePlayerArrowProjectiles: PlayerArrowProjectile[];
  towerBallistaRigs: Map<Tower, BallistaVisualRig>;
  getArrowModelTemplate: () => THREE.Object3D | null;
  getArrowFacing: () => ArrowFacing | null;
  getTowerArrowGravity: () => THREE.Vector3;
  isServerAuthoritative: () => boolean;
  markMobHitFlash: (mob: MobEntity) => void;
  spawnFloatingDamageText: (
    mob: MobEntity,
    damage: number,
    source: 'player' | 'tower',
    isCrit: boolean
  ) => void;
  setMobLastHitDirection: (
    mob: MobEntity,
    step: THREE.Vector3,
    velocity: THREE.Vector3
  ) => void;
  sendDealDamage?: (
    mobId: string,
    damage: number,
    source: 'player' | 'tower',
    playerId: string
  ) => void;
  getPlayerId?: () => string;
  towerHeight: number;
  mobWidth: number;
  playerShootRange: number;
  gravityDelay: number;
  arrowRadius: number;
  arrowMaxLifetime: number;
  shootDamage: number;
  enableProjectileBroadphase: boolean;
};

export type ArrowProjectileSystem = {
  spawnTowerArrowProjectile: (
    tower: Tower,
    launchPos: THREE.Vector3,
    launchQuaternion: THREE.Quaternion,
    launchVelocity: THREE.Vector3
  ) => void;
  spawnPlayerArrowProjectile: (
    launchPos: THREE.Vector3,
    launchVelocity: THREE.Vector3
  ) => void;
  updateTowerArrowProjectiles: (delta: number) => void;
  updatePlayerArrowProjectiles: (delta: number) => void;
  getTowerLaunchTransform: (
    tower: Tower,
    rig: BallistaVisualRig | undefined,
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion
  ) => void;
  getProjectileMobCandidates: (
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    out: Entity[]
  ) => Entity[];
  pickMobInRange: (center: THREE.Vector3, radius: number) => Entity | null;
  pickSelectedMob: () => Entity | null;
};

const prevPosScratch = new THREE.Vector3();
const stepScratch = new THREE.Vector3();
const midpointScratch = new THREE.Vector3();
const mobCenterScratch = new THREE.Vector3();
const deltaScratch = new THREE.Vector3();
const closestPointScratch = new THREE.Vector3();
const hitPointScratch = new THREE.Vector3();
const rangeCandidateScratch: Entity[] = [];
const broadphaseCandidatesScratch: Entity[] = [];

const findClosestHit = (
  prevPos: THREE.Vector3,
  currPos: THREE.Vector3,
  projectileRadius: number,
  getCandidates: (
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number
  ) => Entity[],
  outHitMob: { current: MobEntity | null },
  outHitPoint: THREE.Vector3
): boolean => {
  stepScratch.copy(currPos).sub(prevPos);
  const segmentLenSq = stepScratch.lengthSq();
  let hitMob: MobEntity | null = null;
  let bestT = Number.POSITIVE_INFINITY;
  const candidates = getCandidates(prevPos, currPos, projectileRadius);
  for (const mob of candidates) {
    if (mob.kind !== 'mob') continue;
    if (mob.staged) continue;
    if ((mob.hp ?? 0) <= 0) continue;
    mobCenterScratch.copy(mob.mesh.position).setY(mob.baseY + 0.3);
    const combinedRadius = mob.radius + projectileRadius;
    let t = 0;
    if (segmentLenSq > 1e-8) {
      deltaScratch.copy(mobCenterScratch).sub(prevPos);
      t = THREE.MathUtils.clamp(
        deltaScratch.dot(stepScratch) / segmentLenSq,
        0,
        1
      );
    }
    closestPointScratch.copy(prevPos).addScaledVector(stepScratch, t);
    if (
      closestPointScratch.distanceToSquared(mobCenterScratch) >
      combinedRadius * combinedRadius
    )
      continue;
    if (t < bestT) {
      bestT = t;
      hitMob = mob;
      hitPointScratch.copy(closestPointScratch);
    }
  }
  outHitMob.current = hitMob;
  if (hitMob) outHitPoint.copy(hitPointScratch);
  return hitMob !== null;
};

export const createArrowProjectileSystem = (
  ctx: ArrowProjectileSystemContext
): ArrowProjectileSystem => {
  const getProjectileMobCandidates = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    out: Entity[]
  ) => {
    if (!ctx.enableProjectileBroadphase) {
      out.length = 0;
      for (const mob of ctx.mobs) out.push(mob);
      return out;
    }
    midpointScratch.copy(from).add(to).multiplyScalar(0.5);
    const segmentLength = from.distanceTo(to);
    const queryRadius = segmentLength * 0.5 + radius + ctx.mobWidth;
    return ctx.spatialGrid.getNearbyInto(midpointScratch, queryRadius, out);
  };

  const getCandidatesForHitTest = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number
  ) => {
    broadphaseCandidatesScratch.length = 0;
    return getProjectileMobCandidates(
      from,
      to,
      radius,
      broadphaseCandidatesScratch
    );
  };

  const pickMobInRange = (center: THREE.Vector3, radius: number) => {
    let best: Entity | null = null;
    let bestDistToBase = Number.POSITIVE_INFINITY;
    rangeCandidateScratch.length = 0;
    ctx.spatialGrid.getNearbyInto(center, radius, rangeCandidateScratch);
    for (const mob of rangeCandidateScratch) {
      if (mob.kind !== 'mob') continue;
      if (mob.staged) continue;
      if ((mob.hp ?? 0) <= 0) continue;
      const distToCenter = mob.mesh.position.distanceTo(center);
      if (distToCenter > radius) continue;
      const distToBase = mob.mesh.position.length();
      if (distToBase < bestDistToBase) {
        best = mob;
        bestDistToBase = distToBase;
      }
    }
    return best;
  };

  const pickSelectedMob = () =>
    pickMobInRange(ctx.player.mesh.position, ctx.playerShootRange);

  const getTowerLaunchTransform = (
    tower: Tower,
    rig: BallistaVisualRig | undefined,
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion
  ) => {
    if (rig) {
      rig.root.updateMatrixWorld(true);
      getBallistaArrowLaunchTransform(rig, outPosition, outQuaternion);
      return;
    }
    outPosition.copy(tower.mesh.position);
    outPosition.y += ctx.towerHeight * 0.5;
    outQuaternion.identity();
  };

  const spawnTowerArrowProjectile = (
    tower: Tower,
    launchPos: THREE.Vector3,
    launchQuaternion: THREE.Quaternion,
    launchVelocity: THREE.Vector3
  ) => {
    const arrowModelTemplate = ctx.getArrowModelTemplate();
    const arrowFacing = ctx.getArrowFacing();
    if (!arrowModelTemplate || !arrowFacing) return;
    const mesh = arrowModelTemplate.clone(true);
    mesh.quaternion.copy(launchQuaternion);
    orientArrowToVelocity(mesh, launchVelocity, arrowFacing.forwardLocal);
    placeArrowMeshAtFacing(mesh, launchPos, arrowFacing.anchorLocalPos);
    ctx.scene.add(mesh);
    ctx.activeArrowProjectiles.push({
      mesh,
      position: launchPos.clone(),
      velocity: launchVelocity.clone(),
      gravity: ctx.getTowerArrowGravity(),
      gravityDelay: ctx.gravityDelay,
      radius: ctx.arrowRadius,
      ttl: ctx.arrowMaxLifetime,
      damage: tower.damage,
      sourceTower: tower,
    });
  };

  const spawnPlayerArrowProjectile = (
    launchPos: THREE.Vector3,
    launchVelocity: THREE.Vector3
  ) => {
    const arrowModelTemplate = ctx.getArrowModelTemplate();
    const arrowFacing = ctx.getArrowFacing();
    if (!arrowModelTemplate || !arrowFacing) return;
    const mesh = arrowModelTemplate.clone(true);
    orientArrowToVelocity(mesh, launchVelocity, arrowFacing.forwardLocal);
    placeArrowMeshAtFacing(mesh, launchPos, arrowFacing.anchorLocalPos);
    ctx.scene.add(mesh);
    ctx.activePlayerArrowProjectiles.push({
      mesh,
      position: launchPos.clone(),
      velocity: launchVelocity.clone(),
      gravity: ctx.getTowerArrowGravity(),
      gravityDelay: ctx.gravityDelay,
      radius: ctx.arrowRadius,
      ttl: ctx.arrowMaxLifetime,
      damage: ctx.shootDamage,
    });
  };

  const updateArrowProjectiles = <
    P extends {
      mesh: THREE.Object3D;
      position: THREE.Vector3;
      velocity: THREE.Vector3;
      gravity: THREE.Vector3;
      gravityDelay: number;
      radius: number;
      ttl: number;
      damage: number;
    },
  >(
    projectiles: P[],
    delta: number,
    arrowFacing: ArrowFacing | null,
    onHit: (projectile: P, hitMob: MobEntity) => void
  ) => {
    const serverAuthoritative = ctx.isServerAuthoritative();
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i]!;
      projectile.ttl -= delta;
      if (projectile.ttl <= 0) {
        ctx.scene.remove(projectile.mesh);
        projectiles.splice(i, 1);
        continue;
      }
      prevPosScratch.copy(projectile.position);
      let gravityDt = delta;
      if (projectile.gravityDelay > 0) {
        const delayStep = Math.min(projectile.gravityDelay, delta);
        projectile.gravityDelay -= delayStep;
        gravityDt = delta - delayStep;
      }
      if (gravityDt > 0) {
        projectile.velocity.addScaledVector(projectile.gravity, gravityDt);
      }
      projectile.position.addScaledVector(projectile.velocity, delta);
      if (arrowFacing) {
        orientArrowToVelocity(
          projectile.mesh,
          projectile.velocity,
          arrowFacing.forwardLocal
        );
        placeArrowMeshAtFacing(
          projectile.mesh,
          projectile.position,
          arrowFacing.anchorLocalPos
        );
      }
      const hitResult = { current: null as MobEntity | null };
      const didHit = findClosestHit(
        prevPosScratch,
        projectile.position,
        projectile.radius,
        getCandidatesForHitTest,
        hitResult,
        hitPointScratch
      );
      if (!didHit || !hitResult.current) continue;
      const hitMob = hitResult.current;
      projectile.position.copy(hitPointScratch);
      if (arrowFacing) {
        placeArrowMeshAtFacing(
          projectile.mesh,
          projectile.position,
          arrowFacing.anchorLocalPos
        );
      }
      ctx.setMobLastHitDirection(hitMob, stepScratch, projectile.velocity);
      if (serverAuthoritative) {
        ctx.markMobHitFlash(hitMob);
        const attack = rollAttackDamage(projectile.damage);
        hitMob.lastHitBy =
          'sourceTower' in projectile ? 'tower' : 'player';
        ctx.spawnFloatingDamageText(
          hitMob,
          attack.damage,
          hitMob.lastHitBy,
          attack.isCrit
        );
        const mobId = hitMob.mobId;
        if (mobId && ctx.sendDealDamage) {
          const source = 'sourceTower' in projectile ? 'tower' : 'player';
          const playerId =
            source === 'tower' && 'sourceTower' in projectile
              ? (projectile as ArrowProjectile).sourceTower.builtBy
              : ctx.getPlayerId?.() ?? '';
          if (playerId) ctx.sendDealDamage(mobId, attack.damage, source, playerId);
        }
        ctx.scene.remove(projectile.mesh);
        projectiles.splice(i, 1);
        continue;
      }
      onHit(projectile, hitMob);
      ctx.scene.remove(projectile.mesh);
      projectiles.splice(i, 1);
    }
  };

  const updateTowerArrowProjectiles = (delta: number) => {
    const arrowFacing = ctx.getArrowFacing();
    updateArrowProjectiles(
      ctx.activeArrowProjectiles,
      delta,
      arrowFacing,
      (projectile, hitMob) => {
        const towerProjectile = projectile as ArrowProjectile;
        const attack = rollAttackDamage(towerProjectile.damage);
        const prevHp = hitMob.hp ?? 1;
        const nextHp = prevHp - attack.damage;
        hitMob.hp = nextHp;
        ctx.markMobHitFlash(hitMob);
        hitMob.lastHitBy = 'tower';
        ctx.spawnFloatingDamageText(
          hitMob,
          attack.damage,
          'tower',
          attack.isCrit
        );
        if (prevHp > 0 && nextHp <= 0) {
          towerProjectile.sourceTower.killCount += 1;
        }
      }
    );
  };

  const updatePlayerArrowProjectiles = (delta: number) => {
    const arrowFacing = ctx.getArrowFacing();
    updateArrowProjectiles(
      ctx.activePlayerArrowProjectiles,
      delta,
      arrowFacing,
      (projectile, hitMob) => {
        const attack = rollAttackDamage(projectile.damage);
        hitMob.hp = (hitMob.hp ?? 0) - attack.damage;
        ctx.markMobHitFlash(hitMob);
        hitMob.lastHitBy = 'player';
        ctx.spawnFloatingDamageText(
          hitMob,
          attack.damage,
          'player',
          attack.isCrit
        );
      }
    );
  };

  return {
    spawnTowerArrowProjectile,
    spawnPlayerArrowProjectile,
    updateTowerArrowProjectiles,
    updatePlayerArrowProjectiles,
    getTowerLaunchTransform,
    getProjectileMobCandidates,
    pickMobInRange,
    pickSelectedMob,
  };
};

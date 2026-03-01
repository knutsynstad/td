import * as THREE from 'three';
import type {
  DestructibleCollider,
  Entity,
  MobEntity,
  StaticCollider,
} from '../../gameplay/types/entities';
import type { StructureStore } from '../../gameplay/structureStore';
import type { SpatialGrid } from '../../world/spatialGrid';
import {
  clamp,
  distanceToColliderSurface,
  resolveCircleAabb,
} from '../../world/collision';

type MobConstants = {
  mobBerserkAttackCooldown: number;
  mobBerserkDamage: number;
  mobBerserkRangeBuffer: number;
  mobBerserkUnreachableGrace: number;
  worldBounds: number;
  mobStagingBoundsPadding: number;
  gridSize: number;
};

type MotionContext = {
  structureStore: StructureStore;
  staticColliders: StaticCollider[];
  spatialGrid: SpatialGrid;
  npcs: Entity[];
  constants: MobConstants;
  playerFacingOffset: { value: number };
  playerVelocitySmoothing: number;
  random: () => number;
  spawnCubeEffects: (pos: THREE.Vector3) => void;
  onStructureDestroyed?: (collider: DestructibleCollider) => void;
  isServerAuthoritative?: () => boolean;
};

export const createEntityMotionSystem = (context: MotionContext) => {
  const nearbyScratch: Entity[] = [];
  const progressScratch: Entity[] = [];
  const hasReachedBlockedTarget = (entity: Entity): boolean => {
    if (entity.kind !== 'player') return false;

    for (const collider of context.staticColliders) {
      const targetInsideCollider =
        Math.abs(entity.target.x - collider.center.x) <= collider.halfSize.x &&
        Math.abs(entity.target.z - collider.center.z) <= collider.halfSize.z;
      if (!targetInsideCollider) continue;

      if (
        distanceToColliderSurface(
          entity.mesh.position,
          entity.radius,
          collider
        ) <= 0.05
      ) {
        return true;
      }
    }
    return false;
  };

  const pickBerserkTarget = (mob: MobEntity): DestructibleCollider | null => {
    const options = context.structureStore.getDestructibleColliders();
    if (options.length === 0) return null;

    let best: DestructibleCollider | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const collider of options) {
      const dx = collider.center.x - mob.mesh.position.x;
      const dz = collider.center.z - mob.mesh.position.z;
      const planarDist = Math.hypot(dx, dz);
      const towerPriorityBonus = collider.type === 'tower' ? 8 : 0;
      const score = planarDist - towerPriorityBonus;
      if (score < bestScore) {
        bestScore = score;
        best = collider;
      }
    }
    return best;
  };

  const updateMobBerserkState = (mob: MobEntity, delta: number) => {
    mob.siegeAttackCooldown = Math.max(mob.siegeAttackCooldown - delta, 0);
    const reachable = !mob.laneBlocked;
    if (reachable) {
      mob.unreachableTime = 0;
      mob.berserkMode = false;
      mob.berserkTarget = null;
      return;
    }

    mob.unreachableTime += delta;
    if (
      !mob.berserkMode &&
      mob.unreachableTime >= context.constants.mobBerserkUnreachableGrace
    ) {
      mob.berserkTarget = pickBerserkTarget(mob);
      mob.berserkMode = mob.berserkTarget !== null;
    }
  };

  const getMobBerserkDirection = (mob: MobEntity): THREE.Vector3 | null => {
    if (!mob.berserkMode) return null;

    if (
      !mob.berserkTarget ||
      !context.structureStore.structureStates.has(mob.berserkTarget)
    ) {
      mob.berserkTarget = pickBerserkTarget(mob);
      if (!mob.berserkTarget) {
        mob.berserkMode = false;
        return null;
      }
    }

    const target = mob.berserkTarget;
    const distanceToSurface = distanceToColliderSurface(
      mob.mesh.position,
      mob.radius,
      target
    );
    if (distanceToSurface <= context.constants.mobBerserkRangeBuffer) {
      if (mob.siegeAttackCooldown <= 0) {
        if (!context.isServerAuthoritative?.()) {
          context.structureStore.damageStructure(
            target,
            context.constants.mobBerserkDamage,
            (collider) => {
              context.spawnCubeEffects(collider.center.clone());
              context.onStructureDestroyed?.(collider);
            }
          );
        }
        mob.siegeAttackCooldown = context.constants.mobBerserkAttackCooldown;
      }
      return new THREE.Vector3(0, 0, 0);
    }

    const dir = new THREE.Vector3(
      target.center.x - mob.mesh.position.x,
      0,
      target.center.z - mob.mesh.position.z
    );
    if (dir.length() <= 0.1) return new THREE.Vector3(0, 0, 0);
    return dir.normalize();
  };

  const applyAvoidance = (
    entity: Entity,
    dir: THREE.Vector3,
    strengthScale = 0.3
  ) => {
    const avoidanceRadius = entity.radius * 2 + 0.5;
    const nearby = context.spatialGrid.getNearbyInto(
      entity.mesh.position,
      avoidanceRadius,
      nearbyScratch
    );

    const avoidance = new THREE.Vector3();
    for (const other of nearby) {
      if (other === entity) continue;
      const dx = entity.mesh.position.x - other.mesh.position.x;
      const dz = entity.mesh.position.z - other.mesh.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 0.001) continue;

      const dist = Math.sqrt(distSq);
      const minDist = entity.radius + other.radius + 0.3;
      if (dist < minDist) {
        const strength = (minDist - dist) / minDist;
        avoidance.x += (dx / dist) * strength;
        avoidance.z += (dz / dist) * strength;
      }
    }

    if (avoidance.length() > 0.001) {
      avoidance.normalize().multiplyScalar(strengthScale);
      dir.add(avoidance).normalize();
    }
  };

  const updateStagedMobMotion = (entity: MobEntity) => {
    entity.velocity.set(0, 0, 0);
    const boundsPadding = context.constants.mobStagingBoundsPadding;
    const minBound = -context.constants.worldBounds - boundsPadding;
    const maxBound = context.constants.worldBounds + boundsPadding;
    entity.mesh.position.x = clamp(entity.mesh.position.x, minBound, maxBound);
    entity.mesh.position.z = clamp(entity.mesh.position.z, minBound, maxBound);
    entity.mesh.position.y = entity.baseY;
  };

  const updateWaypointMobMotion = (
    entity: MobEntity,
    delta: number,
    dir: THREE.Vector3
  ) => {
    updateMobBerserkState(entity, delta);
    if (entity.berserkMode) {
      const berserkDir = getMobBerserkDirection(entity);
      if (berserkDir) {
        dir.copy(berserkDir);
      } else if (entity.laneBlocked) {
        dir.set(-entity.mesh.position.x, 0, -entity.mesh.position.z);
        if (dir.length() > 0.1) dir.normalize();
      }
    } else {
      const waypoints = entity.waypoints!;
      let waypointIdx = entity.waypointIndex!;
      if (waypointIdx < waypoints.length) {
        const targetWaypoint = waypoints[waypointIdx]!;
        const distToWaypoint = entity.mesh.position.distanceTo(targetWaypoint);
        const nearbyForProgress = Math.max(
          0,
          context.spatialGrid.getNearbyInto(
            entity.mesh.position,
            entity.radius * 4,
            progressScratch
          ).length - 1
        );
        const crowdBonus = Math.min(0.35, nearbyForProgress * 0.03);
        const waypointReachRadius = entity.radius + 0.55 + crowdBonus;
        let progressT = 1;
        let passedProgressGate = true;
        if (waypointIdx > 0) {
          const prevWaypoint = waypoints[waypointIdx - 1];
          if (prevWaypoint) {
            const segX = targetWaypoint.x - prevWaypoint.x;
            const segZ = targetWaypoint.z - prevWaypoint.z;
            const segLenSq = segX * segX + segZ * segZ;
            if (segLenSq > 1e-6) {
              const mobFromPrevX = entity.mesh.position.x - prevWaypoint.x;
              const mobFromPrevZ = entity.mesh.position.z - prevWaypoint.z;
              progressT =
                (mobFromPrevX * segX + mobFromPrevZ * segZ) / segLenSq;
              passedProgressGate = progressT >= 0.85;
            }
          }
        }
        let turnDot: number | null = null;
        let isTurnWaypoint = false;
        if (waypointIdx > 0 && waypointIdx < waypoints.length - 1) {
          const prevWp = waypoints[waypointIdx - 1];
          const currWp = waypoints[waypointIdx];
          const nextWp = waypoints[waypointIdx + 1];
          if (prevWp && currWp && nextWp) {
            const inX = currWp.x - prevWp.x;
            const inZ = currWp.z - prevWp.z;
            const outX = nextWp.x - currWp.x;
            const outZ = nextWp.z - currWp.z;
            const inLen = Math.hypot(inX, inZ);
            const outLen = Math.hypot(outX, outZ);
            if (inLen > 1e-6 && outLen > 1e-6) {
              turnDot =
                (inX / inLen) * (outX / outLen) +
                (inZ / inLen) * (outZ / outLen);
              isTurnWaypoint = Math.abs(turnDot) < 0.95;
            }
          }
        }
        const isFinalApproachWaypoint = waypointIdx >= waypoints.length - 3;
        const applyStrictTurnGate = isTurnWaypoint && !isFinalApproachWaypoint;
        const requiredProgress = applyStrictTurnGate
          ? 0.97
          : isFinalApproachWaypoint
            ? 0.9
            : 0.85;
        const strictTurnRadius = entity.radius + 0.45;
        const effectiveReachRadius = applyStrictTurnGate
          ? Math.min(waypointReachRadius, strictTurnRadius)
          : waypointReachRadius;
        const canAdvance =
          distToWaypoint < effectiveReachRadius &&
          progressT >= requiredProgress &&
          passedProgressGate;
        if (canAdvance) {
          waypointIdx++;
          entity.waypointIndex = waypointIdx;
        }
        if (waypointIdx < waypoints.length) {
          dir.set(
            waypoints[waypointIdx].x - entity.mesh.position.x,
            0,
            waypoints[waypointIdx].z - entity.mesh.position.z
          );
          if (dir.length() > 0.1) dir.normalize();
        } else {
          const lastWaypoint = waypoints[waypoints.length - 1];
          if (lastWaypoint) {
            dir.set(
              lastWaypoint.x - entity.mesh.position.x,
              0,
              lastWaypoint.z - entity.mesh.position.z
            );
            if (dir.length() > 0.1) dir.normalize();
          }
        }
      }
      applyAvoidance(entity, dir, 0.12);
    }
  };

  const updateBerserkOnlyMobMotion = (
    entity: MobEntity,
    delta: number,
    dir: THREE.Vector3
  ) => {
    updateMobBerserkState(entity, delta);
    if (entity.berserkMode) {
      const berserkDir = getMobBerserkDirection(entity);
      if (berserkDir) {
        dir.copy(berserkDir);
      } else if (entity.laneBlocked) {
        dir.set(-entity.mesh.position.x, 0, -entity.mesh.position.z);
        if (dir.length() > 0.1) dir.normalize();
      }
    }
  };

  const updatePlayerNpcMotion = (entity: Entity, dir: THREE.Vector3) => {
    if (hasReachedBlockedTarget(entity)) {
      dir.set(0, 0, 0);
    } else {
      dir.set(
        entity.target.x - entity.mesh.position.x,
        0,
        entity.target.z - entity.mesh.position.z
      );
      if (dir.length() > 0.1) {
        dir.normalize();
      } else {
        dir.set(0, 0, 0);
      }
    }
  };

  const desiredVelocityScratch = new THREE.Vector3();

  const applyMotionTail = (
    entity: Entity,
    dir: THREE.Vector3,
    delta: number
  ) => {
    if (dir.length() > 0.1) {
      desiredVelocityScratch.copy(dir).multiplyScalar(entity.speed);
    } else {
      desiredVelocityScratch.set(0, 0, 0);
    }
    if (
      (entity.kind === 'player' || entity.kind === 'npc') &&
      context.playerVelocitySmoothing > 0
    ) {
      const t = Math.min(1, context.playerVelocitySmoothing * delta);
      entity.velocity.lerp(desiredVelocityScratch, t);
      if (entity.velocity.lengthSq() < 1e-4) {
        entity.velocity.set(0, 0, 0);
      }
    } else {
      entity.velocity.copy(desiredVelocityScratch);
    }
    entity.mesh.position.x += entity.velocity.x * delta;
    entity.mesh.position.z += entity.velocity.z * delta;
    for (const collider of context.staticColliders) {
      resolveCircleAabb(entity.mesh.position, entity.radius, collider);
    }
    const boundsPadding =
      entity.kind === 'mob' &&
      (entity.staged ||
        Math.abs(entity.mesh.position.x) > context.constants.worldBounds ||
        Math.abs(entity.mesh.position.z) > context.constants.worldBounds ||
        (entity.waypoints !== undefined &&
          entity.waypointIndex !== undefined &&
          entity.waypointIndex < entity.waypoints.length &&
          (Math.abs(entity.waypoints[entity.waypointIndex]!.x) >
            context.constants.worldBounds ||
            Math.abs(entity.waypoints[entity.waypointIndex]!.z) >
              context.constants.worldBounds)))
        ? context.constants.mobStagingBoundsPadding
        : 0;
    const minBound = -context.constants.worldBounds - boundsPadding;
    const maxBound = context.constants.worldBounds + boundsPadding;
    entity.mesh.position.x = clamp(entity.mesh.position.x, minBound, maxBound);
    entity.mesh.position.z = clamp(entity.mesh.position.z, minBound, maxBound);
    entity.mesh.position.y = entity.baseY;
    if (entity.kind === 'player' || entity.kind === 'npc') {
      const vx = entity.velocity.x;
      const vz = entity.velocity.z;
      if (vx * vx + vz * vz > 1e-6) {
        entity.mesh.rotation.y =
          Math.atan2(vx, vz) - context.playerFacingOffset.value + Math.PI;
      }
    }
  };

  const updateEntityMotion = (entity: Entity, delta: number) => {
    const dir = new THREE.Vector3();
    if (entity.kind === 'mob' && entity.staged) {
      updateStagedMobMotion(entity);
      return;
    }
    if (
      entity.kind === 'mob' &&
      entity.waypoints &&
      entity.waypointIndex !== undefined
    ) {
      updateWaypointMobMotion(entity, delta, dir);
    } else if (entity.kind === 'mob') {
      updateBerserkOnlyMobMotion(entity, delta, dir);
    } else {
      updatePlayerNpcMotion(entity, dir);
    }
    applyMotionTail(entity, dir, delta);
  };

  const updateNpcTargets = () => {
    for (const npc of context.npcs) {
      if (npc.mesh.position.distanceTo(npc.target) < 0.5) {
        npc.target.set(
          (context.random() - 0.5) * context.constants.worldBounds * 1.2,
          0,
          (context.random() - 0.5) * context.constants.worldBounds * 1.2
        );
      }
    }
  };

  return {
    updateEntityMotion,
    updateNpcTargets,
  };
};

import * as THREE from 'three'
import type { DestructibleCollider, Entity, MobEntity, StaticCollider } from '../game/types'
import type { StructureStore } from '../game/structures'
import type { SpatialGrid } from '../utils/SpatialGrid'
import { clamp, distanceToColliderSurface, resolveCircleAabb } from '../physics/collision'

type MobConstants = {
  mobBerserkAttackCooldown: number
  mobBerserkDamage: number
  mobBerserkRangeBuffer: number
  mobBerserkUnreachableGrace: number
  worldBounds: number
  gridSize: number
}

type MotionContext = {
  structureStore: StructureStore
  staticColliders: StaticCollider[]
  spatialGrid: SpatialGrid
  npcs: Entity[]
  constants: MobConstants
  random: () => number
  spawnCubeEffects: (pos: THREE.Vector3) => void
  onStructureDestroyed?: (collider: DestructibleCollider) => void
}

export const createEntityMotionSystem = (context: MotionContext) => {
  const nearbyScratch: Entity[] = []
  const progressScratch: Entity[] = []
  const hasReachedBlockedTarget = (entity: Entity): boolean => {
    if (entity.kind !== 'player') return false

    for (const collider of context.staticColliders) {
      const targetInsideCollider =
        Math.abs(entity.target.x - collider.center.x) <= collider.halfSize.x &&
        Math.abs(entity.target.z - collider.center.z) <= collider.halfSize.z
      if (!targetInsideCollider) continue

      // If target is inside a collider, touching its surface should count as arrival.
      if (distanceToColliderSurface(entity.mesh.position, entity.radius, collider) <= 0.05) {
        return true
      }
    }
    return false
  }

  const pickBerserkTarget = (mob: MobEntity): DestructibleCollider | null => {
    const options = context.structureStore.getDestructibleColliders()
    if (options.length === 0) return null

    let best: DestructibleCollider | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const collider of options) {
      const dx = collider.center.x - mob.mesh.position.x
      const dz = collider.center.z - mob.mesh.position.z
      const planarDist = Math.hypot(dx, dz)
      const towerPriorityBonus = collider.type === 'tower' ? 8 : 0
      const score = planarDist - towerPriorityBonus
      if (score < bestScore) {
        bestScore = score
        best = collider
      }
    }
    return best
  }

  const updateMobBerserkState = (mob: MobEntity, delta: number) => {
    mob.siegeAttackCooldown = Math.max(mob.siegeAttackCooldown - delta, 0)
    const reachable = !mob.laneBlocked
    if (reachable) {
      mob.unreachableTime = 0
      mob.berserkMode = false
      mob.berserkTarget = null
      return
    }

    mob.unreachableTime += delta
    if (!mob.berserkMode && mob.unreachableTime >= context.constants.mobBerserkUnreachableGrace) {
      mob.berserkTarget = pickBerserkTarget(mob)
      mob.berserkMode = mob.berserkTarget !== null
    }
  }

  const getMobBerserkDirection = (mob: MobEntity): THREE.Vector3 | null => {
    if (!mob.berserkMode) return null

    if (!mob.berserkTarget || !context.structureStore.structureStates.has(mob.berserkTarget)) {
      mob.berserkTarget = pickBerserkTarget(mob)
      if (!mob.berserkTarget) {
        mob.berserkMode = false
        return null
      }
    }

    const target = mob.berserkTarget
    const distanceToSurface = distanceToColliderSurface(mob.mesh.position, mob.radius, target)
    if (distanceToSurface <= context.constants.mobBerserkRangeBuffer) {
      if (mob.siegeAttackCooldown <= 0) {
        context.structureStore.damageStructure(target, context.constants.mobBerserkDamage, (collider) => {
          context.spawnCubeEffects(collider.center.clone())
          context.onStructureDestroyed?.(collider)
        })
        mob.siegeAttackCooldown = context.constants.mobBerserkAttackCooldown
      }
      return new THREE.Vector3(0, 0, 0)
    }

    const dir = new THREE.Vector3(target.center.x - mob.mesh.position.x, 0, target.center.z - mob.mesh.position.z)
    if (dir.length() <= 0.1) return new THREE.Vector3(0, 0, 0)
    return dir.normalize()
  }

  const applyAvoidance = (entity: Entity, dir: THREE.Vector3, strengthScale = 0.3) => {
    const avoidanceRadius = entity.radius * 2 + 0.5
    const nearby = context.spatialGrid.getNearbyInto(entity.mesh.position, avoidanceRadius, nearbyScratch)

    const avoidance = new THREE.Vector3()
    for (const other of nearby) {
      if (other === entity) continue
      const dx = entity.mesh.position.x - other.mesh.position.x
      const dz = entity.mesh.position.z - other.mesh.position.z
      const distSq = dx * dx + dz * dz
      if (distSq < 0.001) continue

      const dist = Math.sqrt(distSq)
      const minDist = entity.radius + other.radius + 0.3
      if (dist < minDist) {
        const strength = (minDist - dist) / minDist
        avoidance.x += (dx / dist) * strength
        avoidance.z += (dz / dist) * strength
      }
    }

    if (avoidance.length() > 0.001) {
      avoidance.normalize().multiplyScalar(strengthScale)
      dir.add(avoidance).normalize()
    }
  }

  const updateEntityMotion = (entity: Entity, delta: number) => {
    let dir = new THREE.Vector3()

    if (entity.kind === 'mob' && entity.waypoints && entity.waypointIndex !== undefined) {
      updateMobBerserkState(entity, delta)

      if (entity.berserkMode) {
        const berserkDir = getMobBerserkDirection(entity)
        if (berserkDir) {
          dir.copy(berserkDir)
        }
      } else {
        const waypoints = entity.waypoints
        let waypointIdx = entity.waypointIndex

        if (waypointIdx < waypoints.length) {
          const targetWaypoint = waypoints[waypointIdx]
          const distToWaypoint = entity.mesh.position.distanceTo(targetWaypoint)
          // Let mobs "claim" a waypoint earlier when crowded to reduce waypoint pileups.
          const nearbyForProgress = Math.max(
            0,
            context.spatialGrid.getNearbyInto(entity.mesh.position, entity.radius * 4, progressScratch).length - 1
          )
          const crowdBonus = Math.min(1.4, nearbyForProgress * 0.08)
          const waypointReachRadius = entity.radius + 1.0 + crowdBonus
          if (distToWaypoint < waypointReachRadius) {
            waypointIdx++
            entity.waypointIndex = waypointIdx
          }

          if (waypointIdx < waypoints.length) {
            dir = new THREE.Vector3(
              waypoints[waypointIdx].x - entity.mesh.position.x,
              0,
              waypoints[waypointIdx].z - entity.mesh.position.z
            )
            if (dir.length() > 0.1) dir.normalize()
          } else {
            const lastWaypoint = waypoints[waypoints.length - 1]
            if (lastWaypoint) {
              dir = new THREE.Vector3(
                lastWaypoint.x - entity.mesh.position.x,
                0,
                lastWaypoint.z - entity.mesh.position.z
              )
              if (dir.length() > 0.1) dir.normalize()
            }
          }
        }

        applyAvoidance(entity, dir, 0.12)
      }
    } else if (entity.kind === 'mob') {
      updateMobBerserkState(entity, delta)

      if (entity.berserkMode) {
        const berserkDir = getMobBerserkDirection(entity)
        if (berserkDir) dir.copy(berserkDir)
      }
    } else {
      if (hasReachedBlockedTarget(entity)) {
        dir.set(0, 0, 0)
      } else {
        dir = new THREE.Vector3(entity.target.x - entity.mesh.position.x, 0, entity.target.z - entity.mesh.position.z)
        if (dir.length() > 0.1) {
          dir.normalize()
        } else {
          dir.set(0, 0, 0)
        }
      }
    }

    if (dir.length() > 0.1) {
      entity.velocity.copy(dir).multiplyScalar(entity.speed)
    } else {
      entity.velocity.set(0, 0, 0)
    }

    entity.mesh.position.x += entity.velocity.x * delta
    entity.mesh.position.z += entity.velocity.z * delta

    for (const collider of context.staticColliders) {
      resolveCircleAabb(entity.mesh.position, entity.radius, collider)
    }

    entity.mesh.position.x = clamp(entity.mesh.position.x, -context.constants.worldBounds, context.constants.worldBounds)
    entity.mesh.position.z = clamp(entity.mesh.position.z, -context.constants.worldBounds, context.constants.worldBounds)
    entity.mesh.position.y = entity.baseY
  }

  const updateNpcTargets = () => {
    for (const npc of context.npcs) {
      if (npc.mesh.position.distanceTo(npc.target) < 0.5) {
        npc.target.set(
          (context.random() - 0.5) * context.constants.worldBounds * 1.2,
          0,
          (context.random() - 0.5) * context.constants.worldBounds * 1.2
        )
      }
    }
  }

  return {
    updateEntityMotion,
    updateNpcTargets
  }
}

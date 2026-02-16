import * as THREE from 'three'
import type { DestructibleCollider, Entity, StaticCollider } from '../game/types'
import type { StructureStore } from '../game/structures'
import type { FlowField } from '../pathfinding/FlowField'
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
  flowField: FlowField
  structureStore: StructureStore
  staticColliders: StaticCollider[]
  spatialGrid: SpatialGrid
  npcs: Entity[]
  castleGoal: THREE.Vector3
  constants: MobConstants
  spawnCubeEffects: (pos: THREE.Vector3) => void
}

export const createEntityMotionSystem = (context: MotionContext) => {
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

  const pickBerserkTarget = (mob: Entity): DestructibleCollider | null => {
    const options = context.structureStore.getDestructibleColliders()
    if (options.length === 0) return null

    const towardWall = context.flowField.getDirectionTowardNearestWall(mob.mesh.position)
    let best: DestructibleCollider | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const collider of options) {
      const toTarget = new THREE.Vector3().subVectors(collider.center, mob.mesh.position)
      const planarDist = Math.hypot(toTarget.x, toTarget.z)
      const dirToTarget = planarDist > 0.0001 ? toTarget.multiplyScalar(1 / planarDist) : null
      const alignment = towardWall && dirToTarget ? Math.max(0, towardWall.dot(dirToTarget)) : 0
      const towerPriorityBonus = collider.type === 'tower' ? 8 : 0
      const score = planarDist - alignment * 3 - towerPriorityBonus
      if (score < bestScore) {
        bestScore = score
        best = collider
      }
    }
    return best
  }

  const updateMobBerserkState = (mob: Entity, delta: number) => {
    mob.siegeAttackCooldown = Math.max((mob.siegeAttackCooldown ?? 0) - delta, 0)
    const reachable = context.flowField.isReachable(mob.mesh.position)
    if (reachable) {
      mob.unreachableTime = 0
      mob.berserkMode = false
      mob.berserkTarget = null
      return
    }

    mob.unreachableTime = (mob.unreachableTime ?? 0) + delta
    if (!mob.berserkMode && (mob.unreachableTime ?? 0) >= context.constants.mobBerserkUnreachableGrace) {
      mob.berserkTarget = pickBerserkTarget(mob)
      mob.berserkMode = mob.berserkTarget !== null
    }
  }

  const getMobBerserkDirection = (mob: Entity): THREE.Vector3 | null => {
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
      if ((mob.siegeAttackCooldown ?? 0) <= 0) {
        context.structureStore.damageStructure(target, context.constants.mobBerserkDamage, (collider) => {
          context.spawnCubeEffects(collider.center.clone())
        })
        mob.siegeAttackCooldown = context.constants.mobBerserkAttackCooldown
      }
      return new THREE.Vector3(0, 0, 0)
    }

    const dir = new THREE.Vector3(target.center.x - mob.mesh.position.x, 0, target.center.z - mob.mesh.position.z)
    if (dir.length() <= 0.1) return new THREE.Vector3(0, 0, 0)
    return dir.normalize()
  }

  const applyAvoidance = (entity: Entity, dir: THREE.Vector3) => {
    const avoidanceRadius = entity.radius * 2 + 0.5
    const nearby = context.spatialGrid.getNearby(entity.mesh.position, avoidanceRadius)

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
      avoidance.normalize().multiplyScalar(0.3)
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
        } else {
          dir = context.flowField.getDirection(entity.mesh.position)
        }
      } else {
        const waypoints = entity.waypoints
        let waypointIdx = entity.waypointIndex

        if (waypointIdx < waypoints.length) {
          const targetWaypoint = waypoints[waypointIdx]
          const distToWaypoint = entity.mesh.position.distanceTo(targetWaypoint)
          if (distToWaypoint < entity.radius + 0.5) {
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
            dir = new THREE.Vector3(-entity.mesh.position.x, 0, -entity.mesh.position.z)
            if (dir.length() > 0.1) dir.normalize()
          }
        } else {
          dir = context.flowField.getDirection(entity.mesh.position)
        }

        applyAvoidance(entity, dir)

        if (waypointIdx < waypoints.length && waypointIdx > 0) {
          const expectedPos = waypoints[waypointIdx - 1]
          const distOffTrack = entity.mesh.position.distanceTo(expectedPos)
          if (distOffTrack > context.constants.gridSize * 3) {
            entity.waypoints = context.flowField.computeWaypoints(entity.mesh.position, context.castleGoal)
            entity.waypointIndex = 0
          }
        }
      }
    } else if (entity.kind === 'mob') {
      updateMobBerserkState(entity, delta)

      if (entity.berserkMode) {
        const berserkDir = getMobBerserkDirection(entity)
        if (berserkDir) dir.copy(berserkDir)
      }

      if (!entity.berserkMode) {
        dir = context.flowField.getDirection(entity.mesh.position)
        applyAvoidance(entity, dir)
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
      if (collider.type === 'castle') continue
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
          (Math.random() - 0.5) * context.constants.worldBounds * 1.2,
          0,
          (Math.random() - 0.5) * context.constants.worldBounds * 1.2
        )
      }
    }
  }

  return {
    updateEntityMotion,
    updateNpcTargets
  }
}

import * as THREE from 'three'
import type { DestructibleCollider, Entity, StaticCollider } from '../game/types'
import type { StructureStore } from '../game/structures'
import type { FlowField } from '../pathfinding/FlowField'
import type { SpatialGrid } from '../utils/SpatialGrid'
import { clamp, distanceToColliderSurface, resolveCircleAabb } from '../physics/collision'

type MobConstants = {
  mobSiegeAttackCooldown: number
  mobSiegeDamage: number
  mobSiegeRangeBuffer: number
  mobSiegeUnreachableGrace: number
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
  const pickSiegeTarget = (mob: Entity): DestructibleCollider | null => {
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
      const score = planarDist - alignment * 3
      if (score < bestScore) {
        bestScore = score
        best = collider
      }
    }
    return best
  }

  const updateMobSiegeState = (mob: Entity, delta: number) => {
    mob.siegeAttackCooldown = Math.max((mob.siegeAttackCooldown ?? 0) - delta, 0)
    const reachable = context.flowField.isReachable(mob.mesh.position)
    if (reachable) {
      mob.unreachableTime = 0
      mob.siegeMode = false
      mob.siegeTarget = null
      return
    }

    mob.unreachableTime = (mob.unreachableTime ?? 0) + delta
    if (!mob.siegeMode && (mob.unreachableTime ?? 0) >= context.constants.mobSiegeUnreachableGrace) {
      mob.siegeTarget = pickSiegeTarget(mob)
      mob.siegeMode = mob.siegeTarget !== null
    }
  }

  const getMobSiegeDirection = (mob: Entity): THREE.Vector3 | null => {
    if (!mob.siegeMode) return null

    if (!mob.siegeTarget || !context.structureStore.structureStates.has(mob.siegeTarget)) {
      mob.siegeTarget = pickSiegeTarget(mob)
      if (!mob.siegeTarget) {
        mob.siegeMode = false
        return null
      }
    }

    const target = mob.siegeTarget
    const distanceToSurface = distanceToColliderSurface(mob.mesh.position, mob.radius, target)
    if (distanceToSurface <= context.constants.mobSiegeRangeBuffer) {
      if ((mob.siegeAttackCooldown ?? 0) <= 0) {
        context.structureStore.damageStructure(target, context.constants.mobSiegeDamage, (collider) => {
          context.spawnCubeEffects(collider.center.clone())
        })
        mob.siegeAttackCooldown = context.constants.mobSiegeAttackCooldown
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
      updateMobSiegeState(entity, delta)

      if (entity.siegeMode) {
        const siegeDir = getMobSiegeDirection(entity)
        if (siegeDir) {
          dir.copy(siegeDir)
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
      updateMobSiegeState(entity, delta)

      if (entity.siegeMode) {
        const siegeDir = getMobSiegeDirection(entity)
        if (siegeDir) dir.copy(siegeDir)
      }

      if (!entity.siegeMode) {
        dir = context.flowField.getDirection(entity.mesh.position)
        applyAvoidance(entity, dir)
      }
    } else {
      dir = new THREE.Vector3(entity.target.x - entity.mesh.position.x, 0, entity.target.z - entity.mesh.position.z)
      if (dir.length() > 0.1) {
        dir.normalize()
      } else {
        dir.set(0, 0, 0)
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

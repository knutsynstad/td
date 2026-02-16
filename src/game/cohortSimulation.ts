import * as THREE from 'three'
import type { DestructibleCollider, SpawnerRouteState, StaticCollider } from './types'
import type { StructureStore } from './structures'

const UNIT_HP = 3
const EPS = 1e-5
const PACKET_UNIT_CAP = 18
const SPAWN_PACKET_SPACING = 1.1
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

type LaneData = {
  points: THREE.Vector3[]
  cumulative: number[]
  totalLength: number
  state: SpawnerRouteState
}

type CohortPacket = {
  id: number
  spawnerId: string
  hpPool: number
  distance: number
  speed: number
  laneBlocked: boolean
  unreachableTime: number
  berserk: boolean
  berserkTarget: DestructibleCollider | null
  attackCooldown: number
  lastHitBy?: 'player' | 'tower'
}

export type CohortSample = {
  packetId: number
  spawnerId: string
  position: THREE.Vector3
  count: number
  berserk: boolean
}

export type CohortHitTarget = {
  packetId: number
  position: THREE.Vector3
  count: number
}

type UpdateOptions = {
  delta: number
  constants: {
    mobSpeed: number
    mobBerserkUnreachableGrace: number
    mobBerserkDamage: number
    mobBerserkRangeBuffer: number
    mobBerserkAttackCooldown: number
    worldBounds: number
  }
  structureStore: StructureStore
  staticColliders: StaticCollider[]
}

type UpdateResult = {
  castleHits: number
  deaths: Array<{ pos: THREE.Vector3, count: number, lastHitBy?: 'player' | 'tower' }>
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const buildLaneData = (points: THREE.Vector3[], state: SpawnerRouteState): LaneData => {
  const path = points.length >= 2 ? points.map((p) => p.clone()) : [new THREE.Vector3(), new THREE.Vector3()]
  const cumulative: number[] = [0]
  for (let i = 1; i < path.length; i += 1) {
    const seg = path[i]!.distanceTo(path[i - 1]!)
    cumulative.push(cumulative[i - 1]! + seg)
  }
  return {
    points: path,
    cumulative,
    totalLength: cumulative[cumulative.length - 1] ?? 0,
    state
  }
}

const sampleLanePosition = (lane: LaneData, distance: number): THREE.Vector3 => {
  if (lane.points.length === 0) return new THREE.Vector3()
  if (lane.points.length === 1 || lane.totalLength <= EPS) return lane.points[0]!.clone()
  if (distance < 0) {
    const first = lane.points[0]!
    const second = lane.points[1]!
    const dir = new THREE.Vector3(second.x - first.x, 0, second.z - first.z).normalize()
    return first.clone().addScaledVector(dir, distance)
  }
  const d = clamp(distance, 0, lane.totalLength)
  let segIdx = 0
  while (segIdx + 1 < lane.cumulative.length && lane.cumulative[segIdx + 1]! < d) segIdx += 1
  const a = lane.points[segIdx]!
  const b = lane.points[Math.min(segIdx + 1, lane.points.length - 1)]!
  const start = lane.cumulative[segIdx]!
  const end = lane.cumulative[Math.min(segIdx + 1, lane.cumulative.length - 1)]!
  const span = Math.max(EPS, end - start)
  const t = (d - start) / span
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    0,
    a.z + (b.z - a.z) * t
  )
}

const sampleLaneTangent = (lane: LaneData, distance: number): THREE.Vector3 => {
  if (lane.points.length <= 1) return new THREE.Vector3(1, 0, 0)
  if (distance <= 0) {
    return new THREE.Vector3(
      lane.points[1]!.x - lane.points[0]!.x,
      0,
      lane.points[1]!.z - lane.points[0]!.z
    ).normalize()
  }
  if (distance >= lane.totalLength) {
    const n = lane.points.length
    return new THREE.Vector3(
      lane.points[n - 1]!.x - lane.points[n - 2]!.x,
      0,
      lane.points[n - 1]!.z - lane.points[n - 2]!.z
    ).normalize()
  }
  let segIdx = 0
  while (segIdx + 1 < lane.cumulative.length && lane.cumulative[segIdx + 1]! < distance) segIdx += 1
  const a = lane.points[segIdx]!
  const b = lane.points[Math.min(segIdx + 1, lane.points.length - 1)]!
  const tangent = new THREE.Vector3(b.x - a.x, 0, b.z - a.z)
  if (tangent.lengthSq() <= EPS) return new THREE.Vector3(1, 0, 0)
  return tangent.normalize()
}

const nearestLaneDistance = (lane: LaneData, pos: THREE.Vector3): number => {
  if (lane.points.length <= 1) return 0
  let bestDistSq = Number.POSITIVE_INFINITY
  let bestDistance = 0
  for (let i = 1; i < lane.points.length; i += 1) {
    const a = lane.points[i - 1]!
    const b = lane.points[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const apx = pos.x - a.x
    const apz = pos.z - a.z
    const denom = Math.max(EPS, abx * abx + abz * abz)
    const t = clamp((apx * abx + apz * abz) / denom, 0, 1)
    const px = a.x + abx * t
    const pz = a.z + abz * t
    const dsq = (pos.x - px) * (pos.x - px) + (pos.z - pz) * (pos.z - pz)
    if (dsq < bestDistSq) {
      bestDistSq = dsq
      const segStart = lane.cumulative[i - 1]!
      const segLen = Math.sqrt(abx * abx + abz * abz)
      bestDistance = segStart + segLen * t
    }
  }
  return bestDistance
}

const pickBerserkTarget = (packetPos: THREE.Vector3, options: DestructibleCollider[]): DestructibleCollider | null => {
  let best: DestructibleCollider | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const collider of options) {
    const dx = collider.center.x - packetPos.x
    const dz = collider.center.z - packetPos.z
    const dist = Math.hypot(dx, dz)
    const towerBonus = collider.type === 'tower' ? 8 : 0
    const score = dist - towerBonus
    if (score < bestScore) {
      bestScore = score
      best = collider
    }
  }
  return best
}

export class CohortSimulator {
  private readonly lanes = new Map<string, LaneData>()
  private readonly packets: CohortPacket[] = []
  private nextPacketId = 1

  clear() {
    this.lanes.clear()
    this.packets.length = 0
    this.nextPacketId = 1
  }

  setLane(spawnerId: string, points: THREE.Vector3[], state: SpawnerRouteState) {
    const lane = buildLaneData(points, state)
    this.lanes.set(spawnerId, lane)
    for (const packet of this.packets) {
      if (packet.spawnerId !== spawnerId) continue
      packet.laneBlocked = state !== 'reachable'
      if (!packet.laneBlocked) {
        const pos = this.getPacketPosition(packet)
        packet.distance = nearestLaneDistance(lane, pos)
      }
    }
  }

  spawnUnit(spawnerId: string, speed: number) {
    const lane = this.lanes.get(spawnerId)
    const laneBlocked = !lane || lane.state !== 'reachable'
    const existing = this.packets.find((packet) => {
      if (packet.spawnerId !== spawnerId || packet.berserk) return false
      if (Math.abs(packet.distance) >= 1.2) return false
      return Math.ceil(packet.hpPool / UNIT_HP) < PACKET_UNIT_CAP
    })
    if (existing) {
      existing.hpPool += UNIT_HP
      existing.laneBlocked = laneBlocked
      return
    }
    let spawnDistance = 0
    for (const packet of this.packets) {
      if (packet.spawnerId !== spawnerId) continue
      spawnDistance = Math.min(spawnDistance, packet.distance - SPAWN_PACKET_SPACING)
    }
    this.packets.push({
      id: this.nextPacketId++,
      spawnerId,
      hpPool: UNIT_HP,
      distance: spawnDistance,
      speed,
      laneBlocked,
      unreachableTime: 0,
      berserk: false,
      berserkTarget: null,
      attackCooldown: 0
    })
  }

  private getPacketPosition(packet: CohortPacket): THREE.Vector3 {
    const lane = this.lanes.get(packet.spawnerId)
    if (!lane) return new THREE.Vector3(0, 0, 0)
    return sampleLanePosition(lane, packet.distance)
  }

  getSampled(maxInstances: number): CohortSample[] {
    const samples: CohortSample[] = []
    for (const packet of this.packets) {
      const count = Math.max(0, Math.ceil(packet.hpPool / UNIT_HP))
      if (count <= 0) continue
      const lane = this.lanes.get(packet.spawnerId)
      if (!lane) continue
      const pos = this.getPacketPosition(packet)
      const tangent = sampleLaneTangent(lane, packet.distance)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
      const sampleCount = Math.min(count, Math.max(1, Math.floor(maxInstances / Math.max(1, this.packets.length))))
      for (let i = 0; i < sampleCount; i += 1) {
        const theta = i * GOLDEN_ANGLE
        const streamHalfLen = Math.min(5.2, 0.8 + Math.sqrt(count) * 0.35)
        const streamHalfWidth = Math.min(1.8, 0.25 + Math.sqrt(count) * 0.12)
        const longitudinal = (Math.cos(theta) * 0.6 + (i / Math.max(1, sampleCount - 1) - 0.5)) * streamHalfLen
        const lateral = Math.sin(theta) * streamHalfWidth
        const samplePos = pos
          .clone()
          .addScaledVector(tangent, longitudinal)
          .addScaledVector(normal, lateral)
        samples.push({
          packetId: packet.id,
          spawnerId: packet.spawnerId,
          position: samplePos,
          count,
          berserk: packet.berserk
        })
        if (samples.length >= maxInstances) return samples
      }
    }
    return samples
  }

  pickTargetInRange(center: THREE.Vector3, radius: number): CohortHitTarget | null {
    let best: CohortHitTarget | null = null
    let bestDistToBase = Number.POSITIVE_INFINITY
    for (const packet of this.packets) {
      const count = Math.max(0, Math.ceil(packet.hpPool / UNIT_HP))
      if (count <= 0) continue
      const pos = this.getPacketPosition(packet)
      const distToCenter = pos.distanceTo(center)
      if (distToCenter > radius) continue
      const distToBase = pos.length()
      if (distToBase < bestDistToBase) {
        bestDistToBase = distToBase
        best = { packetId: packet.id, position: pos, count }
      }
    }
    return best
  }

  applyDamage(packetId: number, damage: number, source: 'player' | 'tower'): { killed: number, pos: THREE.Vector3 } | null {
    const packet = this.packets.find((p) => p.id === packetId)
    if (!packet) return null
    const before = Math.ceil(packet.hpPool / UNIT_HP)
    packet.hpPool = Math.max(0, packet.hpPool - damage)
    packet.lastHitBy = source
    const after = Math.ceil(packet.hpPool / UNIT_HP)
    return { killed: Math.max(0, before - after), pos: this.getPacketPosition(packet) }
  }

  update(opts: UpdateOptions): UpdateResult {
    const deaths: UpdateResult['deaths'] = []
    let castleHits = 0
    const destructibles = opts.structureStore.getDestructibleColliders()

    for (let i = this.packets.length - 1; i >= 0; i -= 1) {
      const packet = this.packets[i]!
      if (packet.hpPool <= EPS) {
        deaths.push({ pos: this.getPacketPosition(packet), count: 1, lastHitBy: packet.lastHitBy })
        this.packets.splice(i, 1)
        continue
      }

      packet.attackCooldown = Math.max(0, packet.attackCooldown - opts.delta)
      const lane = this.lanes.get(packet.spawnerId)
      packet.laneBlocked = !lane || lane.state !== 'reachable'
      if (!packet.laneBlocked) {
        packet.unreachableTime = 0
        packet.berserk = false
        packet.berserkTarget = null
      } else {
        packet.unreachableTime += opts.delta
        if (!packet.berserk && packet.unreachableTime >= opts.constants.mobBerserkUnreachableGrace) {
          packet.berserk = true
          packet.berserkTarget = pickBerserkTarget(this.getPacketPosition(packet), destructibles)
        }
      }

      const units = Math.max(1, Math.ceil(packet.hpPool / UNIT_HP))
      const moveSpeed = packet.speed * opts.delta
      if (!packet.berserk && lane && lane.state === 'reachable') {
        packet.distance += moveSpeed
        if (packet.distance >= lane.totalLength - 0.2) {
          castleHits += units
          this.packets.splice(i, 1)
          continue
        }
      } else {
        const pos = this.getPacketPosition(packet)
        if (!packet.berserkTarget || !opts.structureStore.structureStates.has(packet.berserkTarget)) {
          packet.berserkTarget = pickBerserkTarget(pos, destructibles)
        }
        const target = packet.berserkTarget
        if (target) {
          const toTarget = new THREE.Vector3(target.center.x - pos.x, 0, target.center.z - pos.z)
          const dist = Math.hypot(toTarget.x, toTarget.z)
          if (dist <= opts.constants.mobBerserkRangeBuffer + 0.8) {
            if (packet.attackCooldown <= 0) {
              const damage = opts.constants.mobBerserkDamage * units
              opts.structureStore.damageStructure(target, damage)
              packet.attackCooldown = opts.constants.mobBerserkAttackCooldown
            }
          } else if (lane && lane.totalLength > EPS) {
            packet.distance += moveSpeed
            packet.distance = clamp(packet.distance, 0, lane.totalLength)
          }
        }
      }
    }

    return { castleHits, deaths }
  }

  getTotalUnits() {
    let total = 0
    for (const packet of this.packets) total += Math.max(0, Math.ceil(packet.hpPool / UNIT_HP))
    return total
  }

  getSpawnerSummary(spawnerId: string) {
    let count = 0
    let berserk = false
    let samplePos: THREE.Vector3 | null = null
    for (const packet of this.packets) {
      if (packet.spawnerId !== spawnerId) continue
      const units = Math.max(0, Math.ceil(packet.hpPool / UNIT_HP))
      count += units
      berserk = berserk || packet.berserk
      if (!samplePos) samplePos = this.getPacketPosition(packet)
    }
    return { count, berserk, samplePos }
  }
}

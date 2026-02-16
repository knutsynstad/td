import * as THREE from 'three'
import type { SpawnerRouteState } from '../game/types'

const STATE_COLORS: Record<SpawnerRouteState, number> = {
  reachable: 0x56d178,
  unstable: 0xf1c95a,
  blocked: 0xd65757
}

export class SpawnerPathOverlay {
  private readonly scene: THREE.Scene
  private readonly lines = new Map<string, THREE.Line>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  upsert(spawnerId: string, points: THREE.Vector3[], state: SpawnerRouteState) {
    const existing = this.lines.get(spawnerId)
    if (existing) {
      this.scene.remove(existing)
      existing.geometry.dispose()
      const material = existing.material as THREE.LineBasicMaterial
      material.dispose()
      this.lines.delete(spawnerId)
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: STATE_COLORS[state],
      transparent: true,
      opacity: 0.9
    })
    const line = new THREE.Line(geometry, material)
    line.position.y = 0.08
    this.scene.add(line)
    this.lines.set(spawnerId, line)
  }

  remove(spawnerId: string) {
    const line = this.lines.get(spawnerId)
    if (!line) return
    this.scene.remove(line)
    line.geometry.dispose()
    const material = line.material as THREE.LineBasicMaterial
    material.dispose()
    this.lines.delete(spawnerId)
  }

  clear() {
    for (const spawnerId of this.lines.keys()) {
      this.remove(spawnerId)
    }
  }
}

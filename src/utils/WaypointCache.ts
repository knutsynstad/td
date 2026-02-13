import * as THREE from 'three'

export class WaypointCache {
  private readonly cache: Map<string, THREE.Vector3[]>
  private readonly gridSnap: number

  constructor(gridSnap: number) {
    this.cache = new Map()
    this.gridSnap = gridSnap
  }

  private getKey(pos: THREE.Vector3): string {
    const gx = Math.floor(pos.x / this.gridSnap)
    const gz = Math.floor(pos.z / this.gridSnap)
    return `${gx},${gz}`
  }

  get(start: THREE.Vector3): THREE.Vector3[] | null {
    return this.cache.get(this.getKey(start)) || null
  }

  set(start: THREE.Vector3, waypoints: THREE.Vector3[]) {
    this.cache.set(this.getKey(start), waypoints)
  }

  clear() {
    this.cache.clear()
  }
}

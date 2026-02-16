import type { MobCohort } from './types'

export class CohortStore {
  private readonly cohorts = new Map<string, MobCohort>()

  setRepresented(spawnerId: string, x: number, z: number, representedCount: number, berserk: boolean) {
    this.cohorts.set(spawnerId, {
      spawnerId,
      representedCount,
      x,
      z,
      berserk
    })
  }

  clearSpawner(spawnerId: string) {
    this.cohorts.delete(spawnerId)
  }

  clear() {
    this.cohorts.clear()
  }

  getTotalRepresented() {
    let total = 0
    for (const cohort of this.cohorts.values()) {
      total += cohort.representedCount
    }
    return total
  }
}

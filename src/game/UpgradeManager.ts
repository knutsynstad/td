import { getTowerType } from './TowerTypes'
import type { TowerTypeId } from './TowerTypes'
import type { Tower } from './types'

export type UpgradeJob = {
  tower: Tower
  fromTypeId: TowerTypeId
  toTypeId: TowerTypeId
  requiredWorkers: number
  endsAtMs: number
}

export class UpgradeManager {
  private readonly activeJobs = new Map<Tower, UpgradeJob>()
  readonly maxWorkers: number

  constructor(maxWorkers: number) {
    this.maxWorkers = maxWorkers
  }

  get usedWorkers(): number {
    let sum = 0
    for (const job of this.activeJobs.values()) sum += job.requiredWorkers
    return sum
  }

  get availableWorkers(): number {
    return Math.max(0, this.maxWorkers - this.usedWorkers)
  }

  getJob(tower: Tower): UpgradeJob | null {
    return this.activeJobs.get(tower) ?? null
  }

  canStartUpgrade(tower: Tower, toTypeId: TowerTypeId): boolean {
    if (this.activeJobs.has(tower)) return false
    const target = getTowerType(toTypeId)
    return this.availableWorkers >= target.requiredWorkers
  }

  startUpgrade(tower: Tower, toTypeId: TowerTypeId, nowMs: number): UpgradeJob | null {
    if (!this.canStartUpgrade(tower, toTypeId)) return null
    const target = getTowerType(toTypeId)
    const job: UpgradeJob = {
      tower,
      fromTypeId: tower.typeId as TowerTypeId,
      toTypeId,
      requiredWorkers: target.requiredWorkers,
      endsAtMs: nowMs + target.upgradeDurationSec * 1000
    }
    this.activeJobs.set(tower, job)
    return job
  }

  cancelForTower(tower: Tower) {
    this.activeJobs.delete(tower)
  }

  collectCompleted(nowMs: number): UpgradeJob[] {
    const done: UpgradeJob[] = []
    for (const [tower, job] of this.activeJobs.entries()) {
      if (nowMs >= job.endsAtMs) {
        done.push(job)
        this.activeJobs.delete(tower)
      }
    }
    return done
  }
}

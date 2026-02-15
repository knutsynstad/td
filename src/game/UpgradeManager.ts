import { getTowerUpgrade } from './TowerTypes'
import type { TowerUpgradeId } from './TowerTypes'
import type { Tower } from './types'

export type UpgradeJob = {
  tower: Tower
  upgradeId: TowerUpgradeId
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

  canStartUpgrade(tower: Tower, upgradeId: TowerUpgradeId): boolean {
    if (this.activeJobs.has(tower)) return false
    const target = getTowerUpgrade(upgradeId)
    return this.availableWorkers >= target.requiredWorkers
  }

  startUpgrade(tower: Tower, upgradeId: TowerUpgradeId, nowMs: number): UpgradeJob | null {
    if (!this.canStartUpgrade(tower, upgradeId)) return null
    const target = getTowerUpgrade(upgradeId)
    const job: UpgradeJob = {
      tower,
      upgradeId,
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

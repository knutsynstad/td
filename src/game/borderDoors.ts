import * as THREE from 'three'

const DOOR_OFFSETS = [-0.5, 0, 0.5]

export const getAllBorderDoors = (worldBounds: number): THREE.Vector3[] => {
  const offsets = DOOR_OFFSETS.map((ratio) => ratio * worldBounds)
  const doors: THREE.Vector3[] = []

  for (const offset of offsets) {
    doors.push(new THREE.Vector3(offset, 0, -worldBounds))
    doors.push(new THREE.Vector3(offset, 0, worldBounds))
    doors.push(new THREE.Vector3(-worldBounds, 0, offset))
    doors.push(new THREE.Vector3(worldBounds, 0, offset))
  }
  return doors
}

const clampInt = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const pickUniqueRandom = <T>(items: T[], count: number): T[] => {
  const pool = items.slice()
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]!
    pool[j] = tmp!
  }
  return pool.slice(0, count)
}

export const selectActiveDoorsForWave = (
  allDoors: THREE.Vector3[],
  wave: number,
  minSpawners: number,
  maxSpawners: number
): THREE.Vector3[] => {
  if (allDoors.length === 0) return []
  const waveCap = Math.min(maxSpawners, minSpawners + Math.floor(wave / 3))
  const count = clampInt(
    minSpawners + Math.random() * (waveCap - minSpawners + 1),
    minSpawners,
    Math.min(maxSpawners, allDoors.length)
  )
  return pickUniqueRandom(allDoors, count).map((door) => door.clone())
}

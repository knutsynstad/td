import * as THREE from 'three'

export const getAllBorderDoors = (worldBounds: number): THREE.Vector3[] => {
  return [
    new THREE.Vector3(0, 0, -worldBounds),
    new THREE.Vector3(worldBounds, 0, 0),
    new THREE.Vector3(0, 0, worldBounds),
    new THREE.Vector3(-worldBounds, 0, 0)
  ]
}

const clampInt = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const pickUniqueRandom = <T>(items: T[], count: number, random: () => number): T[] => {
  const pool = items.slice()
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
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
  maxSpawners: number,
  random: () => number = Math.random
): THREE.Vector3[] => {
  if (allDoors.length === 0) return []
  const waveCap = Math.min(maxSpawners, minSpawners + Math.floor(wave / 3))
  const count = clampInt(
    minSpawners + random() * (waveCap - minSpawners + 1),
    minSpawners,
    Math.min(maxSpawners, allDoors.length)
  )
  return pickUniqueRandom(allDoors, count, random).map((door) => door.clone())
}

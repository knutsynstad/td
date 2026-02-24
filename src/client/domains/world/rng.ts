export type RandomSource = {
  next: () => number
}

const normalizeSeedText = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

export const hashSeed = (input: string | number): number => {
  const normalized = normalizeSeedText(String(input))
  if (normalized.length === 0) return 0x811c9dc5
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export const deriveSeed = (baseSeed: number, streamName: string): number => {
  return hashSeed(`${baseSeed >>> 0}:${normalizeSeedText(streamName)}`)
}

export const createMulberry32 = (seed: number): RandomSource => {
  let state = seed >>> 0
  return {
    next: () => {
      state += 0x6d2b79f5
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
}

export const createRandomSource = (seed?: number | string): RandomSource => {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return createMulberry32(Math.floor(seed))
  }
  if (typeof seed === 'string') {
    return createMulberry32(hashSeed(seed))
  }
  return { next: () => Math.random() }
}

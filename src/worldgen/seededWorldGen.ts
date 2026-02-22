import { createMulberry32, deriveSeed } from '../utils/rng'

export type RockVariant = 'pebble' | 'small' | 'medium' | 'large'

export type TreePlacement = {
  x: number
  z: number
}

export type RockPlacement = {
  x: number
  z: number
  variant: RockVariant
}

export type GeneratedWorldFeatures = {
  trees: TreePlacement[]
  rocks: RockPlacement[]
}

type WorldGenState = {
  trees: TreePlacement[]
  rocks: RockPlacement[]
  occupied: Set<string>
}

type WorldGenContext = {
  seed: number
  worldBounds: number
  margin: number
  gridStep: number
}

export type WorldGenRule = {
  id: string
  apply: (context: WorldGenContext, state: WorldGenState) => void
}

export type SeededWorldGenConfig = {
  seed: number
  worldBounds: number
  margin?: number
  gridStep?: number
  rules?: WorldGenRule[]
}

const smoothStep = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const hash2 = (seed: number, x: number, z: number) => {
  let h = seed >>> 0
  h ^= Math.imul(x | 0, 0x27d4eb2d)
  h ^= Math.imul(z | 0, 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const valueNoise2D = (seed: number, x: number, z: number, frequency: number) => {
  const fx = x * frequency
  const fz = z * frequency
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = smoothStep(fx - ix)
  const tz = smoothStep(fz - iz)
  const n00 = hash2(seed, ix, iz)
  const n10 = hash2(seed, ix + 1, iz)
  const n01 = hash2(seed, ix, iz + 1)
  const n11 = hash2(seed, ix + 1, iz + 1)
  const nx0 = lerp(n00, n10, tx)
  const nx1 = lerp(n01, n11, tx)
  return lerp(nx0, nx1, tz)
}

const fractalNoise2D = (
  seed: number,
  x: number,
  z: number,
  baseFrequency: number,
  octaves: number,
  lacunarity: number,
  gain: number
) => {
  let amplitude = 1
  let frequency = baseFrequency
  let total = 0
  let normalization = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2D(seed + octave * 1013, x, z, frequency) * amplitude
    normalization += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return normalization > 0 ? total / normalization : 0
}

const getKey = (x: number, z: number) => `${x},${z}`

const pushTree = (state: WorldGenState, x: number, z: number) => {
  const key = getKey(x, z)
  if (state.occupied.has(key)) return
  state.occupied.add(key)
  state.trees.push({ x, z })
}

const pushRock = (state: WorldGenState, x: number, z: number, variant: RockVariant) => {
  const key = getKey(x, z)
  if (state.occupied.has(key)) return
  state.occupied.add(key)
  state.rocks.push({ x, z, variant })
}

const treeRule: WorldGenRule = {
  id: 'tree-clumps',
  apply: (context, state) => {
    const densitySeed = deriveSeed(context.seed, 'trees:density')
    const thresholdSeed = deriveSeed(context.seed, 'trees:threshold')
    const stream = createMulberry32(deriveSeed(context.seed, 'trees:macro'))
    const baseDensity = 0.0008 + stream.next() * 0.0014
    const maxCoord = context.worldBounds - context.margin
    const gradientStartDistance = maxCoord * 0.65
    const gradientEndDistance = maxCoord * 0.99
    for (let x = -maxCoord; x <= maxCoord; x += context.gridStep) {
      for (let z = -maxCoord; z <= maxCoord; z += context.gridStep) {
        const macro = fractalNoise2D(densitySeed, x, z, 0.035, 3, 2.1, 0.56)
        const local = fractalNoise2D(densitySeed ^ 0x9e3779b9, x, z, 0.11, 2, 2, 0.5)
        const clumpBoost = Math.max(0, macro - 0.56) * 1.25 + Math.max(0, local - 0.62) * 0.9
        const radialDistance = Math.hypot(x, z)
        const gradientRange = Math.max(1, gradientEndDistance - gradientStartDistance)
        const gradientT = Math.max(0, Math.min(1, (radialDistance - gradientStartDistance) / gradientRange))
        const edgeDensityBoost = Math.pow(smoothStep(gradientT), 0.45)
        const density = Math.min(0.3, baseDensity + clumpBoost * (0.01 + edgeDensityBoost * 0.28))
        const pick = hash2(thresholdSeed, x, z)
        if (pick < density) pushTree(state, x, z)
      }
    }
  }
}

const selectRockVariant = (seed: number, x: number, z: number, centerWeight: number): RockVariant => {
  const scaleNoise = valueNoise2D(seed, x, z, 0.22)
  const score = scaleNoise * 0.65 + centerWeight * 0.35
  if (score > 0.8) return 'large'
  if (score > 0.62) return 'medium'
  if (score > 0.45) return 'small'
  return 'pebble'
}

const rockRule: WorldGenRule = {
  id: 'rock-patches',
  apply: (context, state) => {
    const patchSeed = deriveSeed(context.seed, 'rocks:patch-centers')
    const shapeSeed = deriveSeed(context.seed, 'rocks:shape')
    const stream = createMulberry32(deriveSeed(context.seed, 'rocks:stream'))
    const patchCount = 6 + Math.floor(stream.next() * 7)
    const maxCoord = context.worldBounds - context.margin - 2
    for (let patchIndex = 0; patchIndex < patchCount; patchIndex += 1) {
      const centerX = Math.round((stream.next() * 2 - 1) * maxCoord)
      const centerZ = Math.round((stream.next() * 2 - 1) * maxCoord)
      const halfSpan = 1 + Math.floor(stream.next() * 4)
      for (let dx = -halfSpan; dx <= halfSpan; dx += 1) {
        for (let dz = -halfSpan; dz <= halfSpan; dz += 1) {
          const x = centerX + dx
          const z = centerZ + dz
          if (Math.abs(x) > maxCoord || Math.abs(z) > maxCoord) continue
          const dist = Math.hypot(dx, dz)
          const radius = halfSpan + 0.35
          if (dist > radius) continue
          const centerWeight = Math.max(0, 1 - dist / radius)
          const patchNoise = hash2(patchSeed + patchIndex * 17, x, z)
          if (patchNoise > 0.35 + centerWeight * 0.6) continue
          const variant = selectRockVariant(shapeSeed, x, z, centerWeight)
          pushRock(state, x, z, variant)
        }
      }
    }
  }
}

export const createDefaultWorldGenRules = (): WorldGenRule[] => [treeRule, rockRule]

export const generateSeededWorldFeatures = (config: SeededWorldGenConfig): GeneratedWorldFeatures => {
  const context: WorldGenContext = {
    seed: config.seed >>> 0,
    worldBounds: Math.floor(config.worldBounds),
    margin: config.margin ?? 3,
    gridStep: Math.max(1, Math.floor(config.gridStep ?? 1))
  }
  const state: WorldGenState = {
    trees: [],
    rocks: [],
    occupied: new Set<string>()
  }
  const rules = config.rules ?? createDefaultWorldGenRules()
  for (const rule of rules) {
    rule.apply(context, state)
  }
  return {
    trees: state.trees,
    rocks: state.rocks
  }
}

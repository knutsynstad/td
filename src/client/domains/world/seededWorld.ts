import { createMulberry32, deriveSeed } from './rng'

export type TreePlacement = {
  x: number
  z: number
  footprint: 1 | 2 | 3 | 4
}

export type RockPlacement = {
  x: number
  z: number
  footprintX: number
  footprintZ: number
  yawQuarterTurns: 0 | 1 | 2 | 3
  modelIndex: 0 | 1
  mirrorX: boolean
  mirrorZ: boolean
  verticalScale: number
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

const pushTree = (state: WorldGenState, x: number, z: number, footprint: 1 | 2 | 3 | 4) => {
  const key = getKey(x, z)
  if (state.occupied.has(key)) return
  state.occupied.add(key)
  state.trees.push({ x, z, footprint })
}

const pushRock = (state: WorldGenState, placement: RockPlacement) => {
  state.rocks.push(placement)
}

const pickTreeFootprint = (seed: number, x: number, z: number): 1 | 2 | 3 | 4 => {
  const roll = hash2(seed, x, z)
  if (roll < 0.12) return 1
  if (roll < 0.84) return 2
  if (roll < 0.99) return 3
  return 4
}

const treeRule: WorldGenRule = {
  id: 'tree-clumps',
  apply: (context, state) => {
    const densitySeed = deriveSeed(context.seed, 'trees:density')
    const thresholdSeed = deriveSeed(context.seed, 'trees:threshold')
    const shapeSeed = deriveSeed(context.seed, 'trees:shape')
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
        if (pick < density) {
          const footprint = pickTreeFootprint(shapeSeed, x, z)
          pushTree(state, x, z, footprint)
        }
      }
    }
  }
}

const pickFootprint = (seed: number, x: number, z: number, centerWeight: number): [number, number] => {
  const roll = hash2(seed, x, z)
  if (centerWeight > 0.78) {
    if (roll < 0.015) return [5, 5]
    if (roll < 0.035) return [5, 4]
    if (roll < 0.055) return [4, 5]
    if (roll < 0.085) return [5, 2]
    if (roll < 0.115) return [2, 5]
    if (roll < 0.48) return [3, 3]
    if (roll < 0.8) return [2, 2]
    if (roll < 0.92) return [1, 2]
    return [2, 3]
  }
  if (centerWeight > 0.58) {
    if (roll < 0.006) return [5, 5]
    if (roll < 0.018) return [5, 3]
    if (roll < 0.03) return [3, 5]
    if (roll < 0.24) return [3, 3]
    if (roll < 0.62) return [2, 2]
    if (roll < 0.84) return [1, 2]
    return [1, 1]
  }
  if (centerWeight > 0.4) {
    if (roll < 0.008) return [5, 2]
    if (roll < 0.016) return [2, 5]
    if (roll < 0.19) return [3, 3]
    if (roll < 0.55) return [2, 2]
    if (roll < 0.81) return [1, 2]
    return [1, 1]
  }
  if (roll < 0.0025) return [5, 1]
  if (roll < 0.005) return [1, 5]
  if (roll < 0.09) return [2, 2]
  if (roll < 0.34) return [1, 2]
  return [1, 1]
}

const createRockPlacement = (seed: number, x: number, z: number, centerWeight: number): RockPlacement => {
  const [baseX, baseZ] = pickFootprint(seed ^ 0x6f31f2d9, x, z, centerWeight)
  const yawQuarterTurns = Math.floor(hash2(seed ^ 0x41c64e6d, x, z) * 4) as 0 | 1 | 2 | 3
  const rotateSwap = yawQuarterTurns % 2 === 1
  const footprintX = rotateSwap ? baseZ : baseX
  const footprintZ = rotateSwap ? baseX : baseZ
  const modelIndex = (hash2(seed ^ 0x1234abcd, x, z) < 0.5 ? 0 : 1) as 0 | 1
  const mirrorX = hash2(seed ^ 0x9e3779b9, x, z) > 0.52
  const mirrorZ = hash2(seed ^ 0x85ebca6b, x, z) > 0.58
  const verticalScale = 0.88 + hash2(seed ^ 0xc2b2ae35, x, z) * 0.38
  return {
    x,
    z,
    footprintX,
    footprintZ,
    yawQuarterTurns,
    modelIndex,
    mirrorX,
    mirrorZ,
    verticalScale
  }
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
          const placement = createRockPlacement(shapeSeed, x, z, centerWeight)
          const halfX = placement.footprintX * 0.5
          const halfZ = placement.footprintZ * 0.5
          if (Math.abs(x) + halfX > context.worldBounds - context.margin) continue
          if (Math.abs(z) + halfZ > context.worldBounds - context.margin) continue
          pushRock(state, placement)
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

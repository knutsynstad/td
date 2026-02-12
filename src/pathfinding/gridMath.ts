export type GridBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export const worldToGrid = (
  x: number,
  z: number,
  worldBounds: number,
  resolution: number,
  size: number
): [number, number] => {
  const gx = Math.floor((x + worldBounds) / resolution)
  const gz = Math.floor((z + worldBounds) / resolution)
  return [clampInt(gx, 0, size - 1), clampInt(gz, 0, size - 1)]
}

export const gridToWorld = (
  gx: number,
  gz: number,
  worldBounds: number,
  resolution: number
): [number, number] => {
  const x = gx * resolution - worldBounds + resolution * 0.5
  const z = gz * resolution - worldBounds + resolution * 0.5
  return [x, z]
}

export const getIndex = (gx: number, gz: number, size: number): number => gz * size + gx

export const isInside = (gx: number, gz: number, size: number): boolean =>
  gx >= 0 && gz >= 0 && gx < size && gz < size

export const expandBounds = (bounds: GridBounds, by: number, size: number): GridBounds => ({
  minX: clampInt(bounds.minX - by, 0, size - 1),
  maxX: clampInt(bounds.maxX + by, 0, size - 1),
  minZ: clampInt(bounds.minZ - by, 0, size - 1),
  maxZ: clampInt(bounds.maxZ + by, 0, size - 1)
})

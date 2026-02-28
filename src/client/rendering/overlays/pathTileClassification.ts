export type PathTileVariant =
  | 'center'
  | 'edge'
  | 'inner-corner'
  | 'outer-corner';

export type PathTileClassification = {
  variant: PathTileVariant;
  directionDx: number;
  directionDz: number;
};

const cardinalGrassOffsets = [
  { key: 'north', dx: 0, dz: -1 },
  { key: 'east', dx: 1, dz: 0 },
  { key: 'south', dx: 0, dz: 1 },
  { key: 'west', dx: -1, dz: 0 },
] as const;

export const parseGridKey = (key: string) => {
  const [xRaw = '0', zRaw = '0'] = key.split(',');
  return { x: Number(xRaw), z: Number(zRaw) };
};

export const classifyPathTile = (
  x: number,
  z: number,
  hasPathAt: (x: number, z: number) => boolean
): PathTileClassification => {
  const north = hasPathAt(x, z - 1);
  const east = hasPathAt(x + 1, z);
  const south = hasPathAt(x, z + 1);
  const west = hasPathAt(x - 1, z);
  const northEast = hasPathAt(x + 1, z - 1);
  const southEast = hasPathAt(x + 1, z + 1);
  const southWest = hasPathAt(x - 1, z + 1);
  const northWest = hasPathAt(x - 1, z - 1);

  const grassCardinals = cardinalGrassOffsets.filter(
    ({ dx, dz }) => !hasPathAt(x + dx, z + dz)
  );
  if (grassCardinals.length === 1) {
    return {
      variant: 'edge',
      directionDx: grassCardinals[0]!.dx,
      directionDz: grassCardinals[0]!.dz,
    };
  }

  if (grassCardinals.length === 2) {
    const hasNorth = grassCardinals.some(({ key }) => key === 'north');
    const hasEast = grassCardinals.some(({ key }) => key === 'east');
    const hasSouth = grassCardinals.some(({ key }) => key === 'south');
    const hasWest = grassCardinals.some(({ key }) => key === 'west');
    if (hasNorth && hasEast)
      return { variant: 'outer-corner', directionDx: 1, directionDz: -1 };
    if (hasEast && hasSouth)
      return { variant: 'outer-corner', directionDx: 1, directionDz: 1 };
    if (hasSouth && hasWest)
      return { variant: 'outer-corner', directionDx: -1, directionDz: 1 };
    if (hasWest && hasNorth)
      return { variant: 'outer-corner', directionDx: -1, directionDz: -1 };
  }

  const innerCornerDirections: Array<{ dx: number; dz: number }> = [];
  if (north && east && !northEast)
    innerCornerDirections.push({ dx: 1, dz: -1 });
  if (east && south && !southEast) innerCornerDirections.push({ dx: 1, dz: 1 });
  if (south && west && !southWest)
    innerCornerDirections.push({ dx: -1, dz: 1 });
  if (west && north && !northWest)
    innerCornerDirections.push({ dx: -1, dz: -1 });
  if (innerCornerDirections.length === 1) {
    const dir = innerCornerDirections[0]!;
    return {
      variant: 'inner-corner',
      directionDx: dir.dx,
      directionDz: dir.dz,
    };
  }

  return { variant: 'center', directionDx: 0, directionDz: 1 };
};

export const directionToYaw = (dx: number, dz: number) => Math.atan2(dx, dz);

export const edgeTileYawOffset = -Math.PI * 0.5;
export const cornerTileYawOffset = Math.PI;

export const snapYawToQuarterTurn = (yaw: number) =>
  Math.round(yaw / (Math.PI * 0.5)) * (Math.PI * 0.5);

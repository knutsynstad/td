export type PathTilePoint = {
  x: number;
  z: number;
};

export type PathTileCollider = {
  center: PathTilePoint;
  halfSize: PathTilePoint;
  type: string;
};

export type PathTileBuildResult = {
  tiles: PathTilePoint[];
  isComplete: boolean;
  firstRejectedCell: PathTilePoint | null;
  firstRejectedReason: 'blocked' | 'out_of_bounds' | 'diagonal' | null;
};

export const buildPathTilesFromPoints = (
  points: readonly PathTilePoint[],
  colliders: readonly PathTileCollider[],
  worldBounds: number,
  halfWidth: number
): PathTileBuildResult => {
  if (points.length === 0) {
    return {
      tiles: [],
      isComplete: false,
      firstRejectedCell: null,
      firstRejectedReason: null,
    };
  }
  const out: PathTilePoint[] = [];
  const seen = new Set<string>();
  let isComplete = true;
  let firstRejectedCell: PathTilePoint | null = null;
  let firstRejectedReason: 'blocked' | 'out_of_bounds' | 'diagonal' | null =
    null;
  const widthHalfCells = Math.max(0, Math.floor(halfWidth));

  const blockedCells = new Set<string>();
  for (const collider of colliders) {
    if (collider.type === 'castle') continue;
    const minGx = Math.floor(collider.center.x - collider.halfSize.x) + 1;
    const maxGx = Math.ceil(collider.center.x + collider.halfSize.x) - 1;
    const minGz = Math.floor(collider.center.z - collider.halfSize.z) + 1;
    const maxGz = Math.ceil(collider.center.z + collider.halfSize.z) - 1;
    for (let gx = minGx; gx <= maxGx; gx += 1) {
      for (let gz = minGz; gz <= maxGz; gz += 1) {
        blockedCells.add(`${gx},${gz}`);
      }
    }
  }
  const isBlockedCell = (x: number, z: number) => blockedCells.has(`${x},${z}`);
  const pushCell = (x: number, z: number) => {
    const gx = Math.round(x);
    const gz = Math.round(z);
    if (Math.abs(gx) > worldBounds || Math.abs(gz) > worldBounds) {
      isComplete = false;
      if (!firstRejectedCell) {
        firstRejectedCell = { x: gx, z: gz };
        firstRejectedReason = 'out_of_bounds';
      }
      return;
    }
    if (isBlockedCell(gx, gz)) {
      isComplete = false;
      if (!firstRejectedCell) {
        firstRejectedCell = { x: gx, z: gz };
        firstRejectedReason = 'blocked';
      }
      return;
    }
    const key = `${gx},${gz}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: gx, z: gz });
  };
  const snappedPoints = points.map((point) => ({
    x: Math.round(point.x),
    z: Math.round(point.z),
  }));
  for (let i = 1; i < snappedPoints.length; i += 1) {
    const a = snappedPoints[i - 1]!;
    const b = snappedPoints[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx !== 0 && dz !== 0) {
      isComplete = false;
      if (!firstRejectedReason) firstRejectedReason = 'diagonal';
      continue;
    }
    if (dx === 0 && dz === 0) {
      for (let ox = -widthHalfCells; ox <= widthHalfCells; ox += 1) {
        pushCell(a.x + ox, a.z);
      }
      continue;
    }
    if (dz === 0) {
      const stepX = Math.sign(dx);
      for (let x = a.x; x !== b.x + stepX; x += stepX) {
        for (let oz = -widthHalfCells; oz <= widthHalfCells; oz += 1) {
          pushCell(x, a.z + oz);
        }
      }
      continue;
    }
    const stepZ = Math.sign(dz);
    for (let z = a.z; z !== b.z + stepZ; z += stepZ) {
      for (let ox = -widthHalfCells; ox <= widthHalfCells; ox += 1) {
        pushCell(a.x + ox, z);
      }
    }
  }

  for (let i = 1; i < snappedPoints.length - 1; i += 1) {
    const prev = snappedPoints[i - 1]!;
    const curr = snappedPoints[i]!;
    const next = snappedPoints[i + 1]!;
    const inDx = Math.sign(curr.x - prev.x);
    const inDz = Math.sign(curr.z - prev.z);
    const outDx = Math.sign(next.x - curr.x);
    const outDz = Math.sign(next.z - curr.z);
    const inLen = Math.abs(curr.x - prev.x) + Math.abs(curr.z - prev.z);
    const outLen = Math.abs(next.x - curr.x) + Math.abs(next.z - curr.z);
    const isTurn =
      (inDx !== outDx || inDz !== outDz) &&
      (inDx === 0 || inDz === 0) &&
      (outDx === 0 || outDz === 0);
    if (!isTurn) continue;
    if (inLen < widthHalfCells || outLen < widthHalfCells) continue;
    for (let a = 0; a <= widthHalfCells; a += 1) {
      for (let b = 0; b <= widthHalfCells; b += 1) {
        if (a === 0 && b === 0) continue;
        pushCell(curr.x + inDx * a - outDx * b, curr.z + inDz * a - outDz * b);
      }
    }
  }

  return { tiles: out, isComplete, firstRejectedCell, firstRejectedReason };
};

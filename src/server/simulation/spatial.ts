export type SpatialIndex<T> = {
  readonly cellSize: number;
  readonly rows: Map<number, Map<number, T[]>>;
};

export const createSpatialIndex = <T>(cellSize: number): SpatialIndex<T> => ({
  cellSize,
  rows: new Map(),
});

const spatialCell = (value: number, cellSize: number): number =>
  Math.floor(value / cellSize);

export const spatialInsert = <T>(
  index: SpatialIndex<T>,
  x: number,
  z: number,
  item: T
): void => {
  const gx = spatialCell(x, index.cellSize);
  const gz = spatialCell(z, index.cellSize);
  let row = index.rows.get(gx);
  if (!row) {
    row = new Map();
    index.rows.set(gx, row);
  }
  const cell = row.get(gz);
  if (cell) {
    cell.push(item);
    return;
  }
  row.set(gz, [item]);
};

export const spatialQueryInto = <T>(
  index: SpatialIndex<T>,
  x: number,
  z: number,
  radius: number,
  out: T[]
): T[] => {
  out.length = 0;
  const minGx = spatialCell(x - radius, index.cellSize);
  const maxGx = spatialCell(x + radius, index.cellSize);
  const minGz = spatialCell(z - radius, index.cellSize);
  const maxGz = spatialCell(z + radius, index.cellSize);
  for (let gx = minGx; gx <= maxGx; gx += 1) {
    const row = index.rows.get(gx);
    if (!row) continue;
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      const cell = row.get(gz);
      if (!cell) continue;
      for (const item of cell) out.push(item);
    }
  }
  return out;
};

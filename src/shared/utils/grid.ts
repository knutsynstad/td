export const snapToGrid = (value: number, gridSize: number): number =>
  Math.round(value / gridSize) * gridSize;

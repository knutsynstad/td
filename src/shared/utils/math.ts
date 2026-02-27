export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const clampInt = (value: number, min: number, max: number): number =>
  clamp(Math.floor(value), min, max);

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const smoothStep = (t: number): number => t * t * (3 - 2 * t);

export const distance2d = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number => Math.hypot(bx - ax, bz - az);

export const normalize2d = (x: number, z: number): { x: number; z: number } => {
  const len = Math.hypot(x, z);
  if (len <= 0.0001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
};

export const manhattan = (dx: number, dz: number): number =>
  Math.abs(dx) + Math.abs(dz);

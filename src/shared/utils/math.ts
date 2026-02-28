export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampInt(value: number, min: number, max: number): number {
  return clamp(Math.floor(value), min, max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function distance2d(
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  return Math.hypot(bx - ax, bz - az);
}

export function normalize2d(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z);
  if (len <= 0.0001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

export function manhattan(dx: number, dz: number): number {
  return Math.abs(dx) + Math.abs(dz);
}

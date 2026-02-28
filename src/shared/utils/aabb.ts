export type Aabb2d = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function aabbFromCenter(
  x: number,
  z: number,
  halfX: number,
  halfZ: number
): Aabb2d {
  return {
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
  };
}

export function intersectsAabb(a: Aabb2d, b: Aabb2d): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ
  );
}

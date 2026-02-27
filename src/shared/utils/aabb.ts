export type Aabb2d = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function intersectsAabb(a: Aabb2d, b: Aabb2d): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

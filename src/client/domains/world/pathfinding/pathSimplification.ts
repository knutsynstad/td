import * as THREE from 'three';

export const simplifyCollinear = (
  points: THREE.Vector3[],
  epsilon = 0.01
): THREE.Vector3[] => {
  if (points.length <= 2) return points.map((p) => p.clone());
  const out: THREE.Vector3[] = [points[0]!.clone()];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const d1x = curr.x - prev.x;
    const d1z = curr.z - prev.z;
    const d2x = next.x - curr.x;
    const d2z = next.z - curr.z;
    const len1 = Math.hypot(d1x, d1z);
    const len2 = Math.hypot(d2x, d2z);
    if (len1 <= 1e-6 || len2 <= 1e-6) {
      out.push(curr.clone());
      continue;
    }
    const dot = (d1x / len1) * (d2x / len2) + (d1z / len1) * (d2z / len2);
    if (1 - Math.abs(dot) > epsilon) out.push(curr.clone());
  }
  out.push(points[points.length - 1]!.clone());
  return out;
};

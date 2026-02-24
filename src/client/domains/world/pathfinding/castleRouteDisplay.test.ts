import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toCastleDisplayRoute } from './castleRouteDisplay';

const makeOptions = () => ({
  castleCenter: new THREE.Vector3(0, 0, 0),
  castleHalfSize: { x: 4, z: 4 },
  gridSize: 1,
  castleFrontDirection: new THREE.Vector2(0, 1),
});

describe('toCastleDisplayRoute', () => {
  it('extends a server route all the way to castle center', () => {
    const points = [
      new THREE.Vector3(0, 0, 20),
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(0, 0, 7),
    ];

    const display = toCastleDisplayRoute(points, makeOptions());
    const last = display[display.length - 1];

    expect(last?.x).toBe(0);
    expect(last?.z).toBe(0);
  });

  it('clips when route enters castle and still reaches center', () => {
    const points = [new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, 2)];

    const display = toCastleDisplayRoute(points, makeOptions());
    const last = display[display.length - 1];

    expect(last?.x).toBe(0);
    expect(last?.z).toBe(0);
    const interiorNonCenterPoints = display.filter(
      (point) =>
        Math.abs(point.x) <= 4 &&
        Math.abs(point.z) <= 4 &&
        (Math.abs(point.x) > 1e-6 || Math.abs(point.z) > 1e-6)
    );
    expect(interiorNonCenterPoints).toHaveLength(0);
  });
});

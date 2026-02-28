import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  solveBallisticIntercept,
  computeFallbackBallisticVelocity,
  rollAttackDamage,
} from './projectiles';

describe('solveBallisticIntercept', () => {
  it('returns a solution for a stationary target', () => {
    const start = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(10, 1, 0);
    const targetVel = new THREE.Vector3(0, 0, 0);
    const gravity = new THREE.Vector3(0, -9.8, 0);

    const result = solveBallisticIntercept(
      start,
      target,
      targetVel,
      20,
      gravity,
      0.1,
      5
    );

    expect(result).not.toBeNull();
    expect(result!.hitTime).toBeGreaterThan(0);
    expect(result!.velocity.length()).toBeCloseTo(20, 0);
  });

  it('returns null when target is unreachable', () => {
    const start = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1000, 0, 0);
    const targetVel = new THREE.Vector3(100, 0, 0);
    const gravity = new THREE.Vector3(0, -50, 0);

    const result = solveBallisticIntercept(
      start,
      target,
      targetVel,
      1,
      gravity,
      0,
      0.5
    );

    expect(result).toBeNull();
  });

  it('handles a moving target', () => {
    const start = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(5, 0, 0);
    const targetVel = new THREE.Vector3(2, 0, 0);
    const gravity = new THREE.Vector3(0, -9.8, 0);

    const result = solveBallisticIntercept(
      start,
      target,
      targetVel,
      20,
      gravity,
      0.05,
      5
    );

    expect(result).not.toBeNull();
    expect(result!.interceptPoint.x).toBeGreaterThan(target.x);
  });
});

describe('computeFallbackBallisticVelocity', () => {
  it('returns a velocity vector', () => {
    const start = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(5, 1, 0);
    const gravity = new THREE.Vector3(0, -9.8, 0);

    const vel = computeFallbackBallisticVelocity(
      start,
      target,
      gravity,
      0.05,
      20,
      5
    );

    expect(vel.length()).toBeGreaterThan(0);
    expect(vel.x).toBeGreaterThan(0);
  });
});

describe('rollAttackDamage', () => {
  it('returns non-negative damage', () => {
    const result = rollAttackDamage(10);

    expect(result.damage).toBeGreaterThanOrEqual(10);
    expect(typeof result.isCrit).toBe('boolean');
  });

  it('crit damage is multiplied', () => {
    const results = Array.from({ length: 200 }, () => rollAttackDamage(10));
    const crits = results.filter((r) => r.isCrit);
    const nonCrits = results.filter((r) => !r.isCrit);

    if (crits.length > 0) {
      expect(crits[0]!.damage).toBe(20);
    }
    if (nonCrits.length > 0) {
      expect(nonCrits[0]!.damage).toBe(10);
    }
  });
});

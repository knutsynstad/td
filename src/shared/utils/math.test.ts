import { describe, expect, it } from 'vitest';
import {
  clamp,
  clampInt,
  distance2d,
  lerp,
  manhattan,
  normalize2d,
  smoothStep,
} from './math';

describe('clamp', () => {
  it('clamps value within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('handles equal min and max', () => {
    expect(clamp(5, 10, 10)).toBe(10);
  });
});

describe('clampInt', () => {
  it('floors then clamps', () => {
    expect(clampInt(5.7, 0, 10)).toBe(5);
    expect(clampInt(-3.2, 0, 10)).toBe(0);
    expect(clampInt(15.9, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('returns a at t=0 and b at t=1', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
});

describe('smoothStep', () => {
  it('returns 0 at t=0 and 1 at t=1', () => {
    expect(smoothStep(0)).toBe(0);
    expect(smoothStep(1)).toBe(1);
  });
  it('returns smooth interpolant at t=0.5', () => {
    expect(smoothStep(0.5)).toBe(0.5);
  });
});

describe('distance2d', () => {
  it('computes 2D hypotenuse', () => {
    expect(distance2d(0, 0, 3, 4)).toBe(5);
    expect(distance2d(1, 1, 4, 5)).toBe(5);
  });
});

describe('normalize2d', () => {
  it('returns unit vector', () => {
    const n = normalize2d(3, 4);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.z).toBeCloseTo(0.8);
  });
  it('returns zero vector for near-zero input', () => {
    const n = normalize2d(0, 0);
    expect(n).toEqual({ x: 0, z: 0 });
  });
});

describe('manhattan', () => {
  it('returns sum of absolute deltas', () => {
    expect(manhattan(3, 4)).toBe(7);
    expect(manhattan(-2, 5)).toBe(7);
  });
});

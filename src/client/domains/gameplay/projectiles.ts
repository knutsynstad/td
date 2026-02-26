import * as THREE from 'three';
import { CRIT_CHANCE, CRIT_MULTIPLIER } from './combat';

const aimPointScratch = new THREE.Vector3();

export const solveBallisticIntercept = (
  start: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  speed: number,
  gravity: THREE.Vector3,
  gravityDelay: number,
  maxTime: number
) => {
  const gravityDisplacementAt = (time: number) => {
    const activeGravityTime = Math.max(0, time - gravityDelay);
    return 0.5 * activeGravityTime * activeGravityTime;
  };
  const evaluate = (time: number) => {
    aimPointScratch
      .copy(targetPos)
      .addScaledVector(targetVelocity, time)
      .sub(start)
      .addScaledVector(gravity, -gravityDisplacementAt(time));
    return aimPointScratch.lengthSq() - speed * speed * time * time;
  };

  const minTime = 0.06;
  const step = 0.04;
  let prevTime = minTime;
  let prevValue = evaluate(prevTime);
  if (Math.abs(prevValue) < 1e-3) {
    const hitTime = prevTime;
    const interceptPoint = targetPos
      .clone()
      .addScaledVector(targetVelocity, hitTime);
    const velocity = interceptPoint
      .clone()
      .sub(start)
      .addScaledVector(gravity, -gravityDisplacementAt(hitTime))
      .divideScalar(hitTime);
    return { hitTime, interceptPoint, velocity };
  }

  for (let t = minTime + step; t <= maxTime; t += step) {
    const value = evaluate(t);
    if (prevValue === 0 || value === 0 || prevValue * value < 0) {
      let lo = prevTime;
      let hi = t;
      let loValue = prevValue;
      for (let i = 0; i < 16; i += 1) {
        const mid = (lo + hi) * 0.5;
        const midValue = evaluate(mid);
        if (Math.abs(midValue) < 1e-4) {
          lo = mid;
          hi = mid;
          break;
        }
        if (loValue * midValue <= 0) {
          hi = mid;
        } else {
          lo = mid;
          loValue = midValue;
        }
      }
      const hitTime = (lo + hi) * 0.5;
      const interceptPoint = targetPos
        .clone()
        .addScaledVector(targetVelocity, hitTime);
      const velocity = interceptPoint
        .clone()
        .sub(start)
        .addScaledVector(gravity, -gravityDisplacementAt(hitTime))
        .divideScalar(hitTime);
      return { hitTime, interceptPoint, velocity };
    }
    prevTime = t;
    prevValue = value;
  }
  return null;
};

export const computeFallbackBallisticVelocity = (
  start: THREE.Vector3,
  targetPos: THREE.Vector3,
  gravity: THREE.Vector3,
  gravityDelay: number,
  speed: number,
  maxTime: number
) => {
  const travelTime = THREE.MathUtils.clamp(
    start.distanceTo(targetPos) / Math.max(speed, 0.001),
    0.08,
    maxTime
  );
  const activeGravityTime = Math.max(0, travelTime - gravityDelay);
  const gravityDisplacement = 0.5 * activeGravityTime * activeGravityTime;
  return targetPos
    .clone()
    .sub(start)
    .addScaledVector(gravity, -gravityDisplacement)
    .divideScalar(travelTime);
};

export const rollAttackDamage = (baseDamage: number) => {
  const isCrit = Math.random() < CRIT_CHANCE;
  return {
    damage: isCrit ? baseDamage * CRIT_MULTIPLIER : baseDamage,
    isCrit,
  };
};

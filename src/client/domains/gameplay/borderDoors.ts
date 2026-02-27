import * as THREE from 'three';
import { clampInt, pickUniqueRandom } from '../../../shared/utils';

export const getAllBorderDoors = (worldBounds: number): THREE.Vector3[] => {
  return [
    new THREE.Vector3(0, 0, -worldBounds),
    new THREE.Vector3(worldBounds, 0, 0),
    new THREE.Vector3(0, 0, worldBounds),
    new THREE.Vector3(-worldBounds, 0, 0),
  ];
};

export const selectActiveDoorsForWave = (
  allDoors: THREE.Vector3[],
  wave: number,
  minSpawners: number,
  maxSpawners: number,
  random: () => number = Math.random
): THREE.Vector3[] => {
  if (allDoors.length === 0) return [];
  const waveCap = Math.min(maxSpawners, minSpawners + Math.floor(wave / 3));
  const count = clampInt(
    minSpawners + random() * (waveCap - minSpawners + 1),
    minSpawners,
    Math.min(maxSpawners, allDoors.length)
  );
  return pickUniqueRandom(allDoors, count, random).map((door) => door.clone());
};

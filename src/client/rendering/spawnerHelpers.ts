import * as THREE from 'three';
import { clamp } from '../domains/world/collision';
import type { WaveSpawner } from '../domains/gameplay/types/entities';

export type SpawnerHelpersConfig = {
  gridSize: number;
  worldBounds: number;
  spawnerEntryInsetCells: number;
  stagingIslandDistance: number;
  stagingIslandSize: number;
};

export type SpawnerHelpers = {
  getSpawnerOutwardNormal: (pos: THREE.Vector3) => THREE.Vector3;
  getSpawnerTangent: (pos: THREE.Vector3) => THREE.Vector3;
  getSpawnerEntryPoint: (pos: THREE.Vector3) => THREE.Vector3;
  getStagingIslandCenter: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerAnchorId: (spawnerPos: THREE.Vector3) => string;
  getSpawnerTowardMap: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerGatePoint: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  getSpawnerBridgeExitPoint: (spawnerPos: THREE.Vector3) => THREE.Vector3;
  buildLaneWaypointsForSpawner: (
    spawner: WaveSpawner,
    lanePathPoints: THREE.Vector3[] | undefined
  ) => THREE.Vector3[] | undefined;
  getForwardWaypointIndex: (
    pos: THREE.Vector3,
    waypoints: THREE.Vector3[],
    minIndex?: number
  ) => number;
  getSpawnContainerCorners: (spawnerPos: THREE.Vector3) => THREE.Vector3[];
};

export const createSpawnerHelpers = (
  config: SpawnerHelpersConfig
): SpawnerHelpers => {
  const {
    gridSize,
    worldBounds,
    spawnerEntryInsetCells,
    stagingIslandDistance,
    stagingIslandSize,
  } = config;

  const getSpawnerOutwardNormal = (pos: THREE.Vector3) => {
    if (Math.abs(pos.x) >= Math.abs(pos.z)) {
      return new THREE.Vector3(Math.sign(pos.x || 1), 0, 0);
    }
    return new THREE.Vector3(0, 0, Math.sign(pos.z || 1));
  };

  const getSpawnerTangent = (pos: THREE.Vector3) => {
    const normal = getSpawnerOutwardNormal(pos);
    return new THREE.Vector3(-normal.z, 0, normal.x);
  };

  const getSpawnerEntryPoint = (pos: THREE.Vector3) => {
    const normal = getSpawnerOutwardNormal(pos);
    const insetDistance = gridSize * spawnerEntryInsetCells;
    const x = Math.round(pos.x - normal.x * insetDistance);
    const z = Math.round(pos.z - normal.z * insetDistance);
    return new THREE.Vector3(
      clamp(x, -worldBounds + insetDistance, worldBounds - insetDistance),
      0,
      clamp(z, -worldBounds + insetDistance, worldBounds - insetDistance)
    );
  };

  const getStagingIslandCenter = (spawnerPos: THREE.Vector3) => {
    const normal = getSpawnerOutwardNormal(spawnerPos);
    return spawnerPos.clone().addScaledVector(normal, stagingIslandDistance);
  };

  const getSpawnerAnchorId = (spawnerPos: THREE.Vector3) =>
    `anchor-${Math.round(spawnerPos.x)},${Math.round(spawnerPos.z)}`;

  const getSpawnerTowardMap = (spawnerPos: THREE.Vector3) =>
    getSpawnerOutwardNormal(spawnerPos).multiplyScalar(-1);

  const getSpawnerGatePoint = (spawnerPos: THREE.Vector3) => {
    const center = getStagingIslandCenter(spawnerPos);
    const towardMap = getSpawnerTowardMap(spawnerPos);
    const islandHalf = stagingIslandSize * 0.5;
    return center.addScaledVector(towardMap, islandHalf - 0.35);
  };

  const getSpawnerBridgeExitPoint = (spawnerPos: THREE.Vector3) => {
    const towardMap = getSpawnerTowardMap(spawnerPos);
    return spawnerPos.clone().addScaledVector(towardMap, gridSize * 0.35);
  };

  const buildLaneWaypointsForSpawner = (
    spawner: WaveSpawner,
    lanePathPoints: THREE.Vector3[] | undefined
  ) => {
    if (!lanePathPoints || lanePathPoints.length === 0) return undefined;
    const entryPoint = getSpawnerEntryPoint(spawner.position);
    return [
      getSpawnerGatePoint(spawner.position),
      getSpawnerBridgeExitPoint(spawner.position),
      entryPoint.clone(),
      ...lanePathPoints.slice(1).map((point) => point.clone()),
    ];
  };

  const getForwardWaypointIndex = (
    pos: THREE.Vector3,
    waypoints: THREE.Vector3[],
    minIndex = 0
  ): number => {
    if (waypoints.length <= 1) return 0;
    let bestIdx = clamp(Math.floor(minIndex), 0, waypoints.length - 1);
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let i = bestIdx; i < waypoints.length; i += 1) {
      const wp = waypoints[i]!;
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const getSpawnContainerCorners = (spawnerPos: THREE.Vector3) => {
    const normal = getSpawnerOutwardNormal(spawnerPos);
    const tangent = getSpawnerTangent(spawnerPos);
    const center = getStagingIslandCenter(spawnerPos);
    const half = stagingIslandSize * 0.5 - 0.8;
    return [
      center
        .clone()
        .addScaledVector(tangent, -half)
        .addScaledVector(normal, -half),
      center
        .clone()
        .addScaledVector(tangent, half)
        .addScaledVector(normal, -half),
      center
        .clone()
        .addScaledVector(tangent, half)
        .addScaledVector(normal, half),
      center
        .clone()
        .addScaledVector(tangent, -half)
        .addScaledVector(normal, half),
    ];
  };

  return {
    getSpawnerOutwardNormal,
    getSpawnerTangent,
    getSpawnerEntryPoint,
    getStagingIslandCenter,
    getSpawnerAnchorId,
    getSpawnerTowardMap,
    getSpawnerGatePoint,
    getSpawnerBridgeExitPoint,
    buildLaneWaypointsForSpawner,
    getForwardWaypointIndex,
    getSpawnContainerCorners,
  };
};

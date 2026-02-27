export const WAVE_SPAWN_BASE = 2;

export const getWaveMobCount = (wave: number): number => (5 + wave * 2) * 8;

export const getWaveSpawnRate = (wave: number): number =>
  WAVE_SPAWN_BASE + wave * 0.2;

export const WAVE_MIN_SPAWNERS = 1;
export const WAVE_MAX_SPAWNERS = 3;

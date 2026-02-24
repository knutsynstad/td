import type { BuildMode } from './types/buildMode';

export type GameState = {
  buildMode: BuildMode;
  isShooting: boolean;
  shootCooldown: number;
  wave: number;
  lives: number;
  nextWaveAt: number;
  energy: number;
  bankEnergy: number;
  eventBannerTimer: number;
  prevMobsCount: number;
  energyPopTimer: number;
};

export const createGameState = (energyCap: number): GameState => ({
  buildMode: 'off',
  isShooting: false,
  shootCooldown: 0,
  wave: 0,
  lives: 1,
  nextWaveAt: 0,
  energy: energyCap,
  bankEnergy: 0,
  eventBannerTimer: 0,
  prevMobsCount: 0,
  energyPopTimer: 0,
});

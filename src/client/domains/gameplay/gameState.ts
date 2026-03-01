import type { BuildMode } from './types/buildMode';

export type GameState = {
  buildMode: BuildMode;
  isShooting: boolean;
  shootCooldown: number;
  wave: number;
  lives: number;
  nextWaveAtMs: number;
  coins: number;
  castleCoins: number;
  eventBannerTimer: number;
  prevMobsCount: number;
  coinsPopTimer: number;
  lastCountdownBannerSecond: number;
};

export const createGameState = (coinsCap: number): GameState => ({
  buildMode: 'off',
  isShooting: false,
  shootCooldown: 0,
  wave: 0,
  lives: 1,
  nextWaveAtMs: 0,
  coins: coinsCap,
  castleCoins: 0,
  eventBannerTimer: 0,
  prevMobsCount: 0,
  coinsPopTimer: 0,
  lastCountdownBannerSecond: -1,
});

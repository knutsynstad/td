type HudElements = {
  wallCountEl: HTMLSpanElement;
  towerCountEl: HTMLSpanElement;
  coinsCountEl: HTMLSpanElement;
  buildWallBtn: HTMLButtonElement;
  buildTowerBtn: HTMLButtonElement;
  waveEl: HTMLSpanElement;
  nextWaveRowEl: HTMLDivElement;
  mobsRowEl: HTMLDivElement;
  nextWavePrimaryEl: HTMLDivElement;
  nextWaveSecondaryEl: HTMLDivElement;
  mobsPrimaryEl: HTMLDivElement;
  mobsSecondaryEl: HTMLDivElement;
  finalCountdownEl: HTMLDivElement;
  shootButton: HTMLButtonElement;
};

type HudState = {
  coins: number;
  wave: number;
  waveComplete: boolean;
  nextWaveAtMs: number;
  mobsCount: number;
  coinsPopTimer: number;
  shootCooldown: number;
  getCountdownMsRemaining: (nextWaveAtMs: number) => number;
};

type HudOptions = {
  coinCostWall: number;
  coinCostTower: number;
  shootCooldownMax: number;
};

export const updateHud = (
  elements: HudElements,
  state: HudState,
  opts: HudOptions
): void => {
  elements.coinsCountEl.textContent = `${Math.floor(state.coins)}`;
  elements.buildWallBtn.disabled = state.coins < opts.coinCostWall;
  elements.buildTowerBtn.disabled = state.coins < opts.coinCostTower;

  if (state.coinsPopTimer > 0) {
    elements.coinsCountEl.classList.add('pop');
  } else {
    elements.coinsCountEl.classList.remove('pop');
  }

  const isPreWaveCountdown = state.wave === 0 && state.nextWaveAtMs !== 0;
  const showNextWave =
    state.nextWaveAtMs !== 0 && (state.waveComplete || isPreWaveCountdown);
  const rawSeconds =
    showNextWave && state.nextWaveAtMs > 0
      ? state.getCountdownMsRemaining(state.nextWaveAtMs) / 1000
      : 0;
  const nextWaveIn = Math.min(60, Math.floor(rawSeconds));
  elements.waveEl.textContent = String(
    showNextWave ? state.wave + 1 : state.wave
  );
  elements.nextWaveRowEl.style.display = showNextWave ? '' : 'none';
  elements.mobsRowEl.style.display = showNextWave ? 'none' : '';
  if (showNextWave) {
    elements.nextWavePrimaryEl.textContent = '';
    elements.nextWaveSecondaryEl.textContent = `In ${nextWaveIn} seconds`;
  } else {
    elements.mobsPrimaryEl.textContent = '';
    elements.mobsSecondaryEl.textContent = `${state.mobsCount} mobs left`;
  }

  if (showNextWave && nextWaveIn > 0 && nextWaveIn <= 5) {
    elements.finalCountdownEl.textContent = String(nextWaveIn);
    elements.finalCountdownEl.classList.add('show');
  } else {
    elements.finalCountdownEl.classList.remove('show');
    elements.finalCountdownEl.textContent = '';
  }

  const cooldownPercent = Math.min(
    1,
    state.shootCooldown / opts.shootCooldownMax
  );
  const readyPercent = (1 - cooldownPercent) * 100;
  elements.shootButton.style.setProperty(
    '--cooldown-clip',
    `inset(0 ${100 - readyPercent}% 0 0)`
  );
  elements.shootButton.classList.toggle('unlocked', cooldownPercent <= 0.01);
  elements.buildWallBtn.style.setProperty(
    '--cooldown-clip',
    'inset(0 100% 0 0)'
  );
  elements.buildTowerBtn.style.setProperty(
    '--cooldown-clip',
    'inset(0 100% 0 0)'
  );
  elements.buildWallBtn.classList.add('unlocked');
  elements.buildTowerBtn.classList.add('unlocked');
};

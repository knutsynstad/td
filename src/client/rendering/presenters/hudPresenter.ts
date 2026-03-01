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
  now: number;
  mobsCount: number;
  coinsPopTimer: number;
  shootCooldown: number;
  toPerfTime: (serverEpochMs: number) => number;
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
  const nextWaveAtPerf =
    showNextWave && state.nextWaveAtMs > 0
      ? state.toPerfTime(state.nextWaveAtMs)
      : 0;
  // diff is ms until next wave; divide by 1000 for seconds. Clamp to 60s max
  // (expected: 10s intermission, 30s after castle death) to avoid wild displays
  // from clock skew or ms/sec unit bugs.
  const rawSeconds = showNextWave
    ? Math.max(0, (nextWaveAtPerf - state.now) / 1000)
    : 0;
  const nextWaveIn = Math.min(60, Math.ceil(rawSeconds));
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

  if (nextWaveIn > 0 && nextWaveIn <= 5) {
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

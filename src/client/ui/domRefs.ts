export type DomRefs = {
  waveEl: HTMLSpanElement;
  mobsRowEl: HTMLDivElement;
  mobsPrimaryEl: HTMLDivElement;
  mobsSecondaryEl: HTMLDivElement;
  wallCountEl: HTMLSpanElement;
  towerCountEl: HTMLSpanElement;
  energyCountEl: HTMLSpanElement;
  finalCountdownEl: HTMLDivElement;
  nextWaveRowEl: HTMLDivElement;
  nextWavePrimaryEl: HTMLDivElement;
  nextWaveSecondaryEl: HTMLDivElement;
  eventBannerEl: HTMLDivElement;
  hudEl: HTMLElement;
  hudActionsEl: HTMLDivElement;
  hudStatusStackEl: HTMLDivElement;
  hudEnergyEl: HTMLDivElement;
  buildWallBtn: HTMLButtonElement;
  buildTowerBtn: HTMLButtonElement;
  shootButton: HTMLButtonElement;
  minimapWrapEl: HTMLDivElement;
  minimapToggleBtn: HTMLButtonElement;
  coinHudCanvasEl: HTMLCanvasElement;
  minimapCanvasEl: HTMLCanvasElement;
  buildModeTitleEl: HTMLSpanElement;
  buildModeHintEl: HTMLSpanElement;
  buildModeCancelBtn: HTMLButtonElement;
  loadingScreenEl: HTMLDivElement;
  loadingProgressFillEl: HTMLDivElement;
  loadingProgressLabelEl: HTMLDivElement;
  minimapCtx: CanvasRenderingContext2D | null;
};

export const createDomRefs = (root: HTMLElement): DomRefs => {
  const mobsRowEl = root.querySelector<HTMLDivElement>('#mobsRow')!;
  const nextWaveRowEl = root.querySelector<HTMLDivElement>('#nextWaveRow')!;
  const minimapCanvasEl = root.querySelector<HTMLCanvasElement>('#hudMinimap')!;

  return {
    waveEl: root.querySelector<HTMLSpanElement>('#wave')!,
    mobsRowEl,
    mobsPrimaryEl: mobsRowEl.querySelector<HTMLDivElement>('.hud-status__primary')!,
    mobsSecondaryEl: mobsRowEl.querySelector<HTMLDivElement>('.hud-status__secondary')!,
    wallCountEl: root.querySelector<HTMLSpanElement>('#wallCount')!,
    towerCountEl: root.querySelector<HTMLSpanElement>('#towerCount')!,
    energyCountEl: root.querySelector<HTMLSpanElement>('#energyCount')!,
    finalCountdownEl: root.querySelector<HTMLDivElement>('#finalCountdown')!,
    nextWaveRowEl,
    nextWavePrimaryEl: nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__primary')!,
    nextWaveSecondaryEl: nextWaveRowEl.querySelector<HTMLDivElement>('.hud-status__secondary')!,
    eventBannerEl: root.querySelector<HTMLDivElement>('#eventBanner')!,
    hudEl: root.querySelector<HTMLElement>('#hud')!,
    hudActionsEl: root.querySelector<HTMLDivElement>('.hud-actions')!,
    hudStatusStackEl: root.querySelector<HTMLDivElement>('.hud-status-stack')!,
    hudEnergyEl: root.querySelector<HTMLDivElement>('.hud-energy')!,
    buildWallBtn: root.querySelector<HTMLButtonElement>('#buildWall')!,
    buildTowerBtn: root.querySelector<HTMLButtonElement>('#buildTower')!,
    shootButton: root.querySelector<HTMLButtonElement>('#shootButton')!,
    minimapWrapEl: root.querySelector<HTMLDivElement>('#hudMinimapWrap')!,
    minimapToggleBtn: root.querySelector<HTMLButtonElement>('#hudMinimapToggle')!,
    coinHudCanvasEl: root.querySelector<HTMLCanvasElement>('#coinHudCanvas')!,
    minimapCanvasEl,
    buildModeTitleEl: root.querySelector<HTMLSpanElement>('#buildModeTitle')!,
    buildModeHintEl: root.querySelector<HTMLSpanElement>('#buildModeHint')!,
    buildModeCancelBtn: root.querySelector<HTMLButtonElement>('#buildModeCancel')!,
    loadingScreenEl: root.querySelector<HTMLDivElement>('#loadingScreen')!,
    loadingProgressFillEl: root.querySelector<HTMLDivElement>('#loadingProgressFill')!,
    loadingProgressLabelEl: root.querySelector<HTMLDivElement>('#loadingProgressLabel')!,
    minimapCtx: minimapCanvasEl.getContext('2d'),
  };
};

type HudElements = {
  wallCountEl: HTMLSpanElement
  towerCountEl: HTMLSpanElement
  energyCountEl: HTMLSpanElement
  buildWallBtn: HTMLButtonElement
  buildTowerBtn: HTMLButtonElement
  waveEl: HTMLSpanElement
  nextWaveRowEl: HTMLDivElement
  mobsRowEl: HTMLDivElement
  nextWavePrimaryEl: HTMLDivElement
  nextWaveSecondaryEl: HTMLDivElement
  mobsPrimaryEl: HTMLDivElement
  mobsSecondaryEl: HTMLDivElement
  finalCountdownEl: HTMLDivElement
  shootButton: HTMLButtonElement
}

type HudState = {
  energy: number
  wave: number
  waveComplete: boolean
  nextWaveAt: number
  now: number
  mobsCount: number
  energyPopTimer: number
  shootCooldown: number
}

type HudOptions = {
  energySymbol: string
  energyCostWall: number
  energyCostTower: number
  shootCooldownMax: number
}

export const updateHud = (
  elements: HudElements,
  state: HudState,
  opts: HudOptions
): void => {
  elements.wallCountEl.textContent = `${opts.energySymbol}${opts.energyCostWall}`
  elements.towerCountEl.textContent = `${opts.energySymbol}${opts.energyCostTower}`
  elements.energyCountEl.textContent = `${Math.floor(state.energy)}`
  elements.buildWallBtn.disabled = state.energy < opts.energyCostWall
  elements.buildTowerBtn.disabled = state.energy < opts.energyCostTower

  if (state.energyPopTimer > 0) {
    elements.energyCountEl.classList.add('pop')
  } else {
    elements.energyCountEl.classList.remove('pop')
  }

  const nextWaveIn =
    state.waveComplete && state.nextWaveAt !== 0
      ? Math.max(0, Math.ceil((state.nextWaveAt - state.now) / 1000))
      : 0
  const showNextWave = state.waveComplete && state.nextWaveAt !== 0
  elements.waveEl.textContent = String(showNextWave ? state.wave + 1 : state.wave)
  elements.nextWaveRowEl.style.display = showNextWave ? '' : 'none'
  elements.mobsRowEl.style.display = showNextWave ? 'none' : ''
  if (showNextWave) {
    elements.nextWavePrimaryEl.textContent = ''
    elements.nextWaveSecondaryEl.textContent = `In ${nextWaveIn} seconds`
  } else {
    elements.mobsPrimaryEl.textContent = ''
    elements.mobsSecondaryEl.textContent = `${state.mobsCount} mobs left`
  }

  if (nextWaveIn > 0 && nextWaveIn <= 5) {
    elements.finalCountdownEl.textContent = String(nextWaveIn)
    elements.finalCountdownEl.classList.add('show')
  } else {
    elements.finalCountdownEl.classList.remove('show')
    elements.finalCountdownEl.textContent = ''
  }

  const cooldownPercent = Math.min(1, state.shootCooldown / opts.shootCooldownMax)
  const clipPercent = (1 - cooldownPercent) * 100
  elements.shootButton.style.setProperty('--cooldown-clip', `inset(0 0 0 ${clipPercent}%)`)
  elements.shootButton.classList.toggle('unlocked', cooldownPercent <= 0.01)
  elements.buildWallBtn.style.setProperty('--cooldown-clip', 'inset(0 100% 0 0)')
  elements.buildTowerBtn.style.setProperty('--cooldown-clip', 'inset(0 100% 0 0)')
  elements.buildWallBtn.classList.add('unlocked')
  elements.buildTowerBtn.classList.add('unlocked')
}

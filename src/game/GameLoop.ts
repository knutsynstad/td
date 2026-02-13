type StepFn = (now: number, delta: number) => void

export const createGameLoop = (step: StepFn) => {
  let lastTime = performance.now()

  const tick = () => {
    const now = performance.now()
    const delta = Math.min((now - lastTime) / 1000, 0.05)
    lastTime = now
    step(now, delta)
    requestAnimationFrame(tick)
  }

  return {
    start() {
      tick()
    }
  }
}

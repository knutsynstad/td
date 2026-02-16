import * as THREE from 'three'

type CubeParticle = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  lifetime: number
  maxLifetime: number
}

type CubeParticleOptions = {
  sizeMin?: number
  sizeMax?: number
  lifetimeMin?: number
  lifetimeMax?: number
  color?: number
  angularVelocityScale?: number
}

type CubeEffectOptions = {
  countMin?: number
  countMax?: number
  speedMin?: number
  speedMax?: number
  verticalMin?: number
  verticalMax?: number
  particle?: CubeParticleOptions
}

export type ParticleSystem = {
  spawnCubeEffects: (pos: THREE.Vector3, options?: CubeEffectOptions) => void
  spawnMobDeathEffects: (pos: THREE.Vector3) => void
  updateParticles: (delta: number) => void
  dispose: () => void
}

export const createParticleSystem = (scene: THREE.Scene): ParticleSystem => {
  const cubeParticles: CubeParticle[] = []

  const createCubeParticle = (
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    options: CubeParticleOptions = {}
  ): CubeParticle => {
    const sizeMin = options.sizeMin ?? 0.15
    const sizeMax = options.sizeMax ?? 0.25
    const size = sizeMin + Math.random() * (sizeMax - sizeMin)
    const lifetimeMin = options.lifetimeMin ?? 1.5
    const lifetimeMax = options.lifetimeMax ?? 1.5
    const maxLifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin)
    const angularScale = options.angularVelocityScale ?? 10
    const particle = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color: options.color ?? 0xff7a7a, transparent: true })
    )
    particle.position.copy(pos)
    scene.add(particle)
    return {
      mesh: particle,
      velocity: velocity.clone(),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * angularScale,
        (Math.random() - 0.5) * angularScale,
        (Math.random() - 0.5) * angularScale
      ),
      lifetime: maxLifetime,
      maxLifetime
    }
  }

  const spawnCubeEffects = (pos: THREE.Vector3, options: CubeEffectOptions = {}) => {
    const countMin = options.countMin ?? 6
    const countMax = options.countMax ?? 10
    const count = countMin + Math.floor(Math.random() * (countMax - countMin + 1))
    const speedMin = options.speedMin ?? 2
    const speedMax = options.speedMax ?? 4
    const verticalMin = options.verticalMin ?? 3
    const verticalMax = options.verticalMax ?? 5
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        verticalMin + Math.random() * (verticalMax - verticalMin),
        Math.sin(angle) * speed
      )
      cubeParticles.push(createCubeParticle(pos.clone(), velocity, options.particle))
    }
  }

  const spawnMobDeathEffects = (pos: THREE.Vector3) => {
    spawnCubeEffects(pos, {
      countMin: 6,
      countMax: 10,
      speedMin: 2.2,
      speedMax: 3.8,
      verticalMin: 3.2,
      verticalMax: 5.2,
      particle: {
        sizeMin: 0.18,
        sizeMax: 0.35,
        lifetimeMin: 1.8,
        lifetimeMax: 2.6,
        angularVelocityScale: 16
      }
    })
  }

  const updateParticles = (delta: number) => {
    for (let i = cubeParticles.length - 1; i >= 0; i--) {
      const particle = cubeParticles[i]!
      particle.lifetime -= delta
      particle.velocity.y -= 9.8 * delta
      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta))

      particle.mesh.rotation.x += particle.angularVelocity.x * delta
      particle.mesh.rotation.y += particle.angularVelocity.y * delta
      particle.mesh.rotation.z += particle.angularVelocity.z * delta

      const opacity = Math.max(0, particle.lifetime / particle.maxLifetime)
      ;(particle.mesh.material as THREE.MeshStandardMaterial).opacity = opacity

      if (particle.lifetime <= 0 || particle.mesh.position.y < -1) {
        scene.remove(particle.mesh)
        particle.mesh.geometry.dispose()
        ;(particle.mesh.material as THREE.Material).dispose()
        cubeParticles.splice(i, 1)
      }
    }
  }

  const dispose = () => {
    for (const particle of cubeParticles) {
      scene.remove(particle.mesh)
      particle.mesh.geometry.dispose()
      ;(particle.mesh.material as THREE.Material).dispose()
    }
    cubeParticles.length = 0
  }

  return {
    spawnCubeEffects,
    spawnMobDeathEffects,
    updateParticles,
    dispose
  }
}

import * as THREE from 'three'

type ParticleInstance = {
  root: THREE.Object3D
  materials: THREE.Material[]
  ownsGeometry: boolean
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
  spawnCoinRewardEffects: (pos: THREE.Vector3) => void
  setCoinParticleTemplate: (template: THREE.Object3D | null) => void
  updateParticles: (delta: number) => void
  dispose: () => void
}

export const createParticleSystem = (scene: THREE.Scene): ParticleSystem => {
  const particles: ParticleInstance[] = []
  let coinParticleTemplate: THREE.Object3D | null = null

  const collectMaterials = (root: THREE.Object3D): THREE.Material[] => {
    const materials: THREE.Material[] = []
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const source = child.material
      if (Array.isArray(source)) {
        const cloned = source.map((material) => {
          const next = material.clone()
          next.transparent = true
          return next
        })
        child.material = cloned
        materials.push(...cloned)
        return
      }
      const cloned = source.clone()
      cloned.transparent = true
      child.material = cloned
      materials.push(cloned)
    })
    return materials
  }

  const setObjectOpacity = (materials: THREE.Material[], opacity: number) => {
    for (const material of materials) {
      if ('opacity' in material) {
        ;(material as THREE.Material & { opacity: number }).opacity = opacity
      }
    }
  }

  const createCubeParticle = (
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    options: CubeParticleOptions = {}
  ): ParticleInstance => {
    const sizeMin = options.sizeMin ?? 0.15
    const sizeMax = options.sizeMax ?? 0.25
    const size = sizeMin + Math.random() * (sizeMax - sizeMin)
    const lifetimeMin = options.lifetimeMin ?? 1.5
    const lifetimeMax = options.lifetimeMax ?? 1.5
    const maxLifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin)
    const angularScale = options.angularVelocityScale ?? 10
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color: options.color ?? 0xff7a7a, transparent: true })
    )
    mesh.position.copy(pos)
    scene.add(mesh)
    const material = mesh.material as THREE.Material
    return {
      root: mesh,
      materials: [material],
      ownsGeometry: true,
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

  const createModelParticle = (
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    template: THREE.Object3D
  ): ParticleInstance => {
    const root = template.clone(true)
    root.position.copy(pos)
    const minScale = 0.22
    const maxScale = 0.36
    const scale = minScale + Math.random() * (maxScale - minScale)
    root.scale.multiplyScalar(scale)
    root.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    const materials = collectMaterials(root)
    scene.add(root)
    const lifetimeMin = 1.5
    const lifetimeMax = 2.2
    const maxLifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin)
    return {
      root,
      materials,
      ownsGeometry: false,
      velocity: velocity.clone(),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
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
      particles.push(createCubeParticle(pos.clone(), velocity, options.particle))
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

  const spawnCoinRewardEffects = (pos: THREE.Vector3) => {
    if (coinParticleTemplate) {
      const count = 3 + Math.floor(Math.random() * 2)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 1.6 + Math.random() * 1.4
        const velocity = new THREE.Vector3(
          Math.cos(angle) * speed,
          2.3 + Math.random() * 1.6,
          Math.sin(angle) * speed
        )
        particles.push(createModelParticle(pos.clone(), velocity, coinParticleTemplate))
      }
      return
    }
    spawnCubeEffects(pos, {
      countMin: 2,
      countMax: 3,
      speedMin: 1.2,
      speedMax: 2.2,
      verticalMin: 2.0,
      verticalMax: 3.1,
      particle: {
        sizeMin: 0.12,
        sizeMax: 0.2,
        lifetimeMin: 0.9,
        lifetimeMax: 1.4,
        color: 0xf0d066,
        angularVelocityScale: 11
      }
    })
  }

  const updateParticles = (delta: number) => {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i]!
      particle.lifetime -= delta
      particle.velocity.y -= 9.8 * delta
      particle.root.position.add(particle.velocity.clone().multiplyScalar(delta))

      particle.root.rotation.x += particle.angularVelocity.x * delta
      particle.root.rotation.y += particle.angularVelocity.y * delta
      particle.root.rotation.z += particle.angularVelocity.z * delta

      const opacity = Math.max(0, particle.lifetime / particle.maxLifetime)
      setObjectOpacity(particle.materials, opacity)

      if (particle.lifetime <= 0 || particle.root.position.y < -1) {
        scene.remove(particle.root)
        if (particle.ownsGeometry) {
          particle.root.traverse((child) => {
            if (child instanceof THREE.Mesh) child.geometry.dispose()
          })
        }
        for (const material of particle.materials) {
          material.dispose()
        }
        particles.splice(i, 1)
      }
    }
  }

  const setCoinParticleTemplate = (template: THREE.Object3D | null) => {
    coinParticleTemplate = template
  }

  const dispose = () => {
    for (const particle of particles) {
      scene.remove(particle.root)
      if (particle.ownsGeometry) {
        particle.root.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose()
        })
      }
      for (const material of particle.materials) {
        material.dispose()
      }
    }
    particles.length = 0
  }

  return {
    spawnCubeEffects,
    spawnMobDeathEffects,
    spawnCoinRewardEffects,
    setCoinParticleTemplate,
    updateParticles,
    dispose
  }
}

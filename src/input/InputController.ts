import * as THREE from 'three'

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
])

type KeyboardDirectionContext = {
  camera: THREE.Camera
  keyboardForward: THREE.Vector3
  keyboardRight: THREE.Vector3
  keyboardMoveDir: THREE.Vector3
}

export const createInputController = () => {
  const pressedMovementKeys = new Set<string>()

  return {
    handleKeyDown(event: KeyboardEvent, isEditableTarget: boolean): boolean {
      if (MOVEMENT_KEYS.has(event.code)) {
        if (!isEditableTarget) {
          pressedMovementKeys.add(event.code)
          return true
        }
      }
      return false
    },

    handleKeyUp(event: KeyboardEvent, isEditableTarget: boolean): boolean {
      if (MOVEMENT_KEYS.has(event.code)) {
        if (!isEditableTarget) {
          pressedMovementKeys.delete(event.code)
          return true
        }
      }
      return false
    },

    clearMovement() {
      pressedMovementKeys.clear()
    },

    getKeyboardMoveDirection(context: KeyboardDirectionContext): THREE.Vector3 | null {
      const up = (pressedMovementKeys.has('KeyW') || pressedMovementKeys.has('ArrowUp')) ? 1 : 0
      const down = (pressedMovementKeys.has('KeyS') || pressedMovementKeys.has('ArrowDown')) ? 1 : 0
      const left = (pressedMovementKeys.has('KeyA') || pressedMovementKeys.has('ArrowLeft')) ? 1 : 0
      const right = (pressedMovementKeys.has('KeyD') || pressedMovementKeys.has('ArrowRight')) ? 1 : 0
      const vertical = up - down
      const horizontal = right - left
      if (vertical === 0 && horizontal === 0) return null

      context.camera.getWorldDirection(context.keyboardForward)
      context.keyboardForward.y = 0
      if (context.keyboardForward.lengthSq() <= 1e-6) {
        context.keyboardForward.set(0, 0, -1)
      } else {
        context.keyboardForward.normalize()
      }

      context.keyboardRight.set(-context.keyboardForward.z, 0, context.keyboardForward.x)
      context.keyboardMoveDir
        .copy(context.keyboardForward)
        .multiplyScalar(vertical)
        .addScaledVector(context.keyboardRight, horizontal)

      if (context.keyboardMoveDir.lengthSq() <= 1e-6) return null
      return context.keyboardMoveDir.normalize().clone()
    }
  }
}

import type { CameraAngleId } from './cameras'

/**
 * A one-slot mailbox between the switcher UI and the auto-cam director living inside
 * the render loop. The player taking a single cut while auto-cam stays on is a core
 * part of directing, and this is the narrowest way to let the UI say so.
 */
let pending: CameraAngleId | null = null

export const requestOverride = (angle: CameraAngleId): void => {
  pending = angle
}

export const consumeOverride = (): CameraAngleId | null => {
  const value = pending
  pending = null
  return value
}

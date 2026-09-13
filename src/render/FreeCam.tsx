import { useCallback, useRef } from 'react'

/**
 * Free cam orbit state and input.
 *
 * Mouse and touch are handled through pointer events with the same code path, so
 * dragging to fly works identically on a laptop and a tablet, and pinch-to-zoom maps
 * onto the same distance the wheel drives.
 */
export interface OrbitState {
  azimuth: number
  polar: number
  distance: number
  targetX: number
}

export const createOrbitState = (trackLength: number): OrbitState => ({
  azimuth: Math.PI * 0.62,
  polar: 0.34,
  distance: 3.4,
  targetX: trackLength * 0.4,
})

const MIN_POLAR = -0.25
const MAX_POLAR = 1.35
const MIN_DISTANCE = 0.6
const MAX_DISTANCE = 16

export function useFreeCam(trackLength: number) {
  const orbit = useRef<OrbitState>(createOrbitState(trackLength))
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPinch = useRef<number | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size >= 2) {
      // Pinch: the distance between the first two contacts drives dolly.
      const [a, b] = Array.from(pointers.current.values())
      const spread = Math.hypot(a.x - b.x, a.y - b.y)
      if (lastPinch.current != null) {
        const factor = lastPinch.current / Math.max(1, spread)
        orbit.current.distance = clamp(orbit.current.distance * factor, MIN_DISTANCE, MAX_DISTANCE)
      }
      lastPinch.current = spread
      return
    }

    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    orbit.current.azimuth -= dx * 0.006
    orbit.current.polar = clamp(orbit.current.polar + dy * 0.005, MIN_POLAR, MAX_POLAR)
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) lastPinch.current = null
  }, [])

  const onWheel = useCallback((event: React.WheelEvent) => {
    orbit.current.distance = clamp(
      orbit.current.distance * (1 + Math.sign(event.deltaY) * 0.12),
      MIN_DISTANCE,
      MAX_DISTANCE,
    )
  }, [])

  /** Nudge the free cam along the track, for the keyboard. */
  const pan = useCallback((delta: number) => {
    orbit.current.targetX = clamp(orbit.current.targetX + delta, -1, trackLength + 3)
  }, [trackLength])

  return {
    orbit,
    pan,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel },
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

import type { TrackSpec } from './types'

/**
 * Track geometry, expressed as functions of arc length `s` measured along the
 * running surface from the start line. s < 0 is up-ramp behind the start line --
 * which matters, because a rear-weighted car's centre of mass sits back there and
 * therefore starts higher. That single fact is most of why rear bias is fast, and
 * it falls out of the geometry rather than being bolted on as a bonus.
 *
 * Layout: straight ramp -> circular transition arc -> flat run.
 * Heights are measured from the flat run-out, which is y = 0.
 */
export interface TrackGeometry {
  spec: TrackSpec
  rampAngle: number
  /** Arc length at which the transition arc begins. */
  transitionStart: number
  /** Arc length at which the transition arc ends and the flat begins. */
  transitionEnd: number
  /** Height of the surface at arc length s. */
  heightAt(s: number): number
  /** Downhill slope angle (radians, >= 0) at arc length s. */
  slopeAt(s: number): number
  /** d(slope)/ds at arc length s. Negative through the arc as the car levels out. */
  slopeGradientAt(s: number): number
  /** Track curvature at s; positive means the surface curves upward (concave). */
  curvatureAt(s: number): number
  /** World-space position of a point on the surface centreline at s. */
  pointAt(s: number): { x: number; y: number }
  /** Lateral offset of the centre of lane index i from the track centreline. */
  laneOffset(lane: number): number
  totalPathLength: number
}

export function buildTrackGeometry(spec: TrackSpec): TrackGeometry {
  const rampAngle = (spec.rampAngleDeg * Math.PI) / 180
  const R = spec.transitionRadius
  const arcLength = R * rampAngle
  /** Height the arc alone accounts for. */
  const arcRise = R * (1 - Math.cos(rampAngle))

  // Place the transition so that the surface height at the start line (s = 0)
  // equals the requested start height.
  const transitionStart = Math.max(0.05, (spec.startHeight - arcRise) / Math.sin(rampAngle))
  const transitionEnd = transitionStart + arcLength

  const heightAt = (s: number): number => {
    if (s >= transitionEnd) return 0
    if (s <= transitionStart) {
      return arcRise + (transitionStart - s) * Math.sin(rampAngle)
    }
    const phi = (transitionEnd - s) / R
    return R * (1 - Math.cos(phi))
  }

  const slopeAt = (s: number): number => {
    if (s >= transitionEnd) return 0
    if (s <= transitionStart) return rampAngle
    return (transitionEnd - s) / R
  }

  const slopeGradientAt = (s: number): number => {
    if (s >= transitionEnd || s <= transitionStart) return 0
    return -1 / R
  }

  const curvatureAt = (s: number): number => {
    if (s >= transitionEnd || s <= transitionStart) return 0
    return 1 / R
  }

  // Horizontal position, integrated along the path.
  const pointAt = (s: number): { x: number; y: number } => {
    const y = heightAt(s)
    if (s <= transitionStart) {
      return { x: s * Math.cos(rampAngle), y }
    }
    const rampX = transitionStart * Math.cos(rampAngle)
    if (s >= transitionEnd) {
      const arcX = R * Math.sin(rampAngle)
      return { x: rampX + arcX + (s - transitionEnd), y }
    }
    const phi = (transitionEnd - s) / R
    const arcX = R * (Math.sin(rampAngle) - Math.sin(phi))
    return { x: rampX + arcX, y }
  }

  const laneOffset = (lane: number): number => {
    const centred = lane - (spec.laneCount - 1) / 2
    return centred * spec.laneSpacing
  }

  return {
    spec,
    rampAngle,
    transitionStart,
    transitionEnd,
    heightAt,
    slopeAt,
    slopeGradientAt,
    curvatureAt,
    pointAt,
    laneOffset,
    totalPathLength: spec.length + spec.runoutLength,
  }
}

/** Named milestones along the track, used by the auto-cam director and overlays. */
export const trackMilestones = (geometry: TrackGeometry) => ({
  gate: 0,
  dropStart: geometry.transitionStart,
  dropEnd: geometry.transitionEnd,
  quarter: geometry.spec.length * 0.25,
  half: geometry.spec.length * 0.5,
  threeQuarter: geometry.spec.length * 0.75,
  finish: geometry.spec.length,
})

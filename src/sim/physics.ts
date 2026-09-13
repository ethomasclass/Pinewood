import { AIR_DENSITY, G, WHEEL } from './units'
import type { BuildAnalysis } from './build'
import type { TrackGeometry } from './track'
import { Rng } from './rng'

/**
 * Longitudinal truth, lateral approximation.
 *
 * The car's centre of mass is integrated along the track's arc length with a fixed
 * timestep. Everything that decides a race -- gravity along the slope, axle-bore
 * friction, aerodynamic drag, wheel spin-up inertia, and the energy cost of lifting
 * a high centre of mass through the transition -- is a real term here, not a fudge.
 *
 * Two consequences fall straight out of the geometry rather than being scripted:
 *   1. Rear-biased weight starts the centre of mass further up the ramp, so the car
 *      falls further over the same run. Rear bias is fast.
 *   2. Levelling out through the transition raises a tall car's centre of mass,
 *      spending energy that a low car never spends. Low is fast.
 *
 * Lateral motion uses a kinematic bicycle model: steer angle turns the car, the car
 * crabs sideways, and the centre guide rail stops it. Light contact costs almost
 * nothing (this is deliberate rail riding); a hard hit costs real speed.
 */

/** Physics timestep. Small enough that rail contact resolves cleanly. */
export const PHYSICS_DT = 1 / 480

export interface CarPhysicsConfig {
  analysis: BuildAnalysis
  /** Net front-axle steer, radians. */
  steer: number
  /** Fixed per-car misalignment from sloppy axle holes, radians. */
  alignmentError: number
  wheelbase: number
  /** Amplitude of the wheel-driven wobble, radians. */
  wobbleAmplitude: number
  wobblePhase: number
  /** Per-run variance multiplier on rolling resistance. */
  frictionVariance: number
  /** Per-run variance multiplier on drag area. */
  dragVariance: number
  /** Gate-release scatter, seconds. Real gates do not drop perfectly together. */
  releaseDelay: number
  /** Lateral offset the car starts with inside its lane, metres. */
  startOffset: number
  /** Scales in-race randomness. Zero makes a run bit-for-bit repeatable. */
  chaos: number
}

export interface CarState {
  lane: number
  /** Arc length of the centre of mass along the track, metres. Starts negative:
   *  the nose is on the start line, so the centre of mass is up-ramp of it. */
  s: number
  v: number
  /** Lateral offset from the lane centreline, metres. */
  y: number
  /** Heading relative to the lane direction, radians. */
  yaw: number
  /** Accumulated wheel rotation, radians. Drives wheel spin and the wobble phase. */
  wheelAngle: number
  /** Body pitch, radians. Follows the track slope. */
  pitch: number
  launched: boolean
  finished: boolean
  finishTime: number
  finishSpeed: number
  /** Set while the front wheels are unloaded. */
  wheelie: boolean
  /** Rail contact accumulated this step, for event reporting. */
  lastContact: { severity: number; side: -1 | 1; speedLost: number } | null
  /** Total energy lost to rail contact, joules. Shown in post-race analysis. */
  energyLostToRail: number
  energyLostToFriction: number
  energyLostToDrag: number
  enteredDrop: boolean
  exitedDrop: boolean
  milestonesPassed: number
}

export function createCarState(lane: number, config: CarPhysicsConfig): CarState {
  return {
    lane,
    // Nose sits on the start line; the centre of mass trails it up the ramp.
    s: -config.analysis.noseOffset,
    v: 0,
    y: config.startOffset,
    yaw: 0,
    wheelAngle: 0,
    pitch: 0,
    launched: false,
    finished: false,
    finishTime: 0,
    finishSpeed: 0,
    wheelie: false,
    lastContact: null,
    energyLostToRail: 0,
    energyLostToFriction: 0,
    energyLostToDrag: 0,
    enteredDrop: false,
    exitedDrop: false,
    milestonesPassed: 0,
  }
}

/** Arc length of the nose, which is what the finish-line sensor actually sees. */
export const noseS = (state: CarState, config: CarPhysicsConfig): number =>
  state.s + config.analysis.noseOffset

export function stepCar(
  state: CarState,
  config: CarPhysicsConfig,
  geometry: TrackGeometry,
  dt: number,
  rng: Rng,
): void {
  const a = config.analysis
  const m = a.totalMass
  const mEff = a.effectiveMass

  const slope = geometry.slopeAt(state.s)
  const slopeGradient = geometry.slopeGradientAt(state.s)
  const curvature = geometry.curvatureAt(state.s)

  state.pitch = -slope

  // --- Normal load. The concave transition presses the car into the track, which
  //     briefly raises friction: the fast line through the drop is not free. ---
  const normalForce = m * G * Math.cos(slope) + m * state.v * state.v * curvature

  // --- Gravity along the path. The second term is the cost of raising a tall car's
  //     centre of mass as the body rotates from ramp angle to flat. It is small,
  //     negative through the transition, and proportional to centre-of-mass height. ---
  const gravityForce = m * G * Math.sin(slope) * (1 + a.comHeightAboveTrack * slopeGradient)

  // --- Axle-bore friction, the dominant loss, plus the braking pad once the car is
  //     past the finish line and into the catch section. ---
  const braking = geometry.brakingAt(state.s)
  const rolling = a.rollingResistance * config.frictionVariance + braking
  let frictionForce = rolling * normalForce

  // --- Aerodynamic drag. ---
  const dragForce = 0.5 * AIR_DENSITY * a.dragArea * config.dragVariance * state.v * state.v

  // --- Front-axle load check: too much rear bias and the nose lifts. ---
  const wheelbase = Math.max(0.02, config.wheelbase)
  const staticFrontLoad = (normalForce * a.comAheadOfRearAxle) / wheelbase
  const pendingAccel = (gravityForce - frictionForce - dragForce) / mEff
  // Accelerating downhill transfers load rearward, unloading the front further.
  const frontLoad = staticFrontLoad - (m * pendingAccel * a.comHeightAboveTrack) / wheelbase
  const wheelie = frontLoad <= 0
  if (wheelie && !state.wheelie) state.wheelie = true
  if (!wheelie && state.wheelie) state.wheelie = false
  if (wheelie) {
    // A wheelie-ing car drags its tail and loses steering authority.
    frictionForce *= 1.9
    state.yaw += rng.jitter(0.004 * config.chaos)
  }

  const netForce = gravityForce - frictionForce - dragForce
  const accel = netForce / mEff

  const vPrev = state.v
  state.v = Math.max(0, state.v + accel * dt)
  // Braking friction cannot push a car backwards, and a car crawling on the catch
  // pad should settle rather than creep.
  if (braking > 0 && state.v < 0.06) state.v = 0
  state.s += state.v * dt
  state.wheelAngle += (state.v / WHEEL.radius) * dt

  state.energyLostToFriction += frictionForce * state.v * dt
  state.energyLostToDrag += dragForce * state.v * dt

  // --- Lateral: steer the car, let it crab, bounce it off the guide rail. ---
  const wobble =
    config.wobbleAmplitude * Math.sin(state.wheelAngle * 1.0 + config.wobblePhase) +
    config.wobbleAmplitude * 0.4 * Math.sin(state.wheelAngle * 2.7 + config.wobblePhase * 1.7)

  // Lateral centre-of-mass offset pulls the car toward the loaded side.
  const lateralPull = (a.com.comZ / wheelbase) * 0.6

  const steerTotal = config.steer + config.alignmentError + wobble + lateralPull
  const steerAuthority = state.wheelie ? 0.25 : 1

  state.yaw += (state.v / wheelbase) * steerTotal * steerAuthority * dt
  // Rolling wheels resist crabbing; this damps the heading back toward straight.
  state.yaw *= Math.exp(-1.6 * dt * Math.max(0.2, state.v))
  state.y += state.v * Math.sin(state.yaw) * dt

  state.lastContact = null
  const clearance = geometry.spec.railClearance
  if (Math.abs(state.y) > clearance) {
    const side: -1 | 1 = state.y > 0 ? 1 : -1
    state.y = side * clearance

    // Rail force acts at wheel height while the car's mass sits above it. The taller
    // the centre of mass, the more the car rocks over the contact point, so the same
    // nudge costs more energy and throws the car further off line. This is where
    // centre-of-mass height earns its place as a real build decision: the direct
    // energy penalty of a high build is small, but its instability is not.
    const rockFactor = 1 + a.comHeightAboveTrack * 22

    const approachSpeed = Math.abs(vPrev * Math.sin(state.yaw))
    const closing = Math.sign(state.yaw) === side && approachSpeed > 0.012

    let lost = 0

    if (closing) {
      // A genuine impact: the car arrives at the rail with lateral speed and bounces.
      const restitution = 0.3
      lost += 0.5 * m * approachSpeed * approachSpeed * (1 - restitution * restitution) * rockFactor
      state.yaw = -state.yaw * restitution * rockFactor
      state.lastContact = {
        // 0.35 m/s of lateral closing speed is already an ugly, audible slam.
        severity: Math.min(1, (approachSpeed / 0.35) * rockFactor),
        side,
        speedLost: 0,
      }
    } else {
      // Sustained contact: the car is running along the rail. Straighten it out and
      // let it scrub. This is deliberate "rail riding" when the steer is tiny, and a
      // long expensive graze when it is not.
      state.yaw *= 0.25
    }

    // Whatever is holding the car against the rail has to be reacted by the rail, and
    // that lateral load scrubs against the wheel flange the whole time it is there.
    const holdingSteer = Math.abs(steerTotal)
    const lateralLoad = Math.min(m * G * 2, (m * state.v * state.v * holdingSteer) / wheelbase)
    const scrubForce = RAIL_FRICTION * lateralLoad * rockFactor
    lost += scrubForce * state.v * dt

    if (lost > 0) {
      const kinetic = 0.5 * mEff * state.v * state.v
      const remaining = Math.max(0, kinetic - lost)
      const newV = Math.sqrt((2 * remaining) / mEff)
      if (state.lastContact) state.lastContact.speedLost = state.v - newV
      state.v = newV
      state.energyLostToRail += lost
    }
  }
}

/** Coefficient of friction between a wheel flange and the centre guide rail. */
const RAIL_FRICTION = 0.2

/** Free-rolling speed a car would reach with no losses at all, for comparison readouts. */
export const idealSpeed = (dropHeight: number): number => Math.sqrt(2 * G * dropHeight)

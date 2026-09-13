import { AIR_DENSITY, AXLE, G, RULES, WHEEL, inches } from './units'
import type { CarBuild, ChassisProfile, ProfilePoint } from './types'

/** Number of stations used to integrate the lofted body. */
const STATIONS = 96

/** Linear interpolation across a profile curve, clamped at both ends. */
export function sampleProfile(points: ProfilePoint[], x: number): number {
  if (points.length === 0) return 0
  if (points.length === 1) return points[0].v
  if (x <= points[0].x) return points[0].v
  const last = points[points.length - 1]
  if (x >= last.x) return last.v
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.v + (b.v - a.v) * t
    }
  }
  return last.v
}

export interface Station {
  /** Metres from the nose. */
  x: number
  halfWidth: number
  /** Height of the deck above the underside datum. */
  top: number
  /** Height of the underside cut above the datum. */
  bottom: number
  area: number
}

/** Sample the lofted body into cross-sections. Shared by the mass integrator and
 *  the mesh builder so the thing you see is exactly the thing that races. */
export function sampleStations(profile: ChassisProfile, count = STATIONS): Station[] {
  const stations: Station[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const x = t * RULES.maxLength
    const halfWidth = Math.max(0, sampleProfile(profile.top, t)) * (RULES.maxWidth / 2)
    const top = Math.max(0, sampleProfile(profile.side, t)) * RULES.maxHeight
    const bottom = profile.bottom ? Math.max(0, sampleProfile(profile.bottom, t)) * RULES.maxHeight : 0
    const height = Math.max(0, top - bottom)
    stations.push({ x, halfWidth, top, bottom, area: 2 * halfWidth * height })
  }
  return stations
}

export interface MassProperties {
  massKg: number
  /** Metres from the nose. */
  comX: number
  /** Metres above the underside of the block. This is what a builder measures. */
  comY: number
  /** Metres from the centreline, positive to the right. */
  comZ: number
  /** Yaw inertia about the centre of mass, kg m^2. */
  yawInertia: number
}

export interface BuildAnalysis {
  stations: Station[]
  bodyVolume: number
  bodyMass: number
  weightMass: number
  wheelMass: number
  totalMass: number
  /** Total mass including the rotational inertia of the wheels, expressed as mass. */
  effectiveMass: number
  com: MassProperties
  /** Centre of mass as a fraction of wheelbase: 0 at the front axle, 1 at the rear. */
  comBalance: number
  /**
   * Centre-of-mass height above the track surface, metres. Every physical use of
   * height -- the energy spent lifting the car level through the transition, weight
   * transfer, and how hard it rocks over a rail contact -- is measured from the
   * contact patch, not from the underside of the block.
   */
  comHeightAboveTrack: number
  /** Signed distance from the centre of mass to the rear axle, metres. Positive is ahead. */
  comAheadOfRearAxle: number
  frontalArea: number
  dragCoefficient: number
  /** Cd * A, the only aero number the integrator needs. */
  dragArea: number
  /** Effective rolling resistance coefficient, dimensionless. */
  rollingResistance: number
  wheelInertia: number
  contactingWheels: number
  /** Distance from the centre of mass to the nose, metres. */
  noseOffset: number
  overWeight: boolean
  massHeadroom: number
  warnings: BuildWarning[]
}

export interface BuildWarning {
  level: 'error' | 'warn' | 'info'
  message: string
}

/** Wheels sit just outboard of the body; this is the axle half-track. */
export const AXLE_HALF_TRACK = inches(1.05)

/**
 * How far the underside of the block rides above the track surface. The rules set a
 * minimum for a reason: the centre guide rail runs down the middle of every lane, and
 * a car with no clearance sits on the rail instead of straddling it.
 *
 * The car's local space measures y from the underside of the block, so the axle sits
 * BELOW wheel-radius height in that frame -- the wheels hang down past the body.
 */
export const RIDE_HEIGHT = RULES.minClearance
/** Axle centre height in the body's local frame. */
export const AXLE_LOCAL_Y = WHEEL.radius - RIDE_HEIGHT

export function analyzeBuild(build: CarBuild): BuildAnalysis {
  const stations = sampleStations(build.profile)

  // --- Body mass properties, integrated station by station. ---
  const dx = RULES.maxLength / (stations.length - 1)
  let volume = 0
  let momentX = 0
  let momentY = 0
  for (const st of stations) {
    const slabVolume = st.area * dx
    volume += slabVolume
    momentX += st.x * slabVolume
    momentY += ((st.top + st.bottom) / 2) * slabVolume
  }
  const bodyMass = volume * build.woodDensity
  const bodyComX = volume > 0 ? momentX / volume : RULES.maxLength / 2
  const bodyComY = volume > 0 ? momentY / volume : RULES.maxHeight / 2

  // --- Accumulate body, added weights and wheels into one mass budget. ---
  let totalMass = bodyMass
  let mx = bodyMass * bodyComX
  let my = bodyMass * bodyComY
  let mz = 0

  let weightMass = 0
  for (const w of build.weights) {
    weightMass += w.massKg
    totalMass += w.massKg
    mx += w.massKg * w.x
    my += w.massKg * w.y
    mz += w.massKg * w.z
  }

  const contactingWheels = build.wheels.raisedFrontWheel ? 3 : 4
  const wheelMass = build.wheels.massEach * 4
  const wheelPositions: Array<{ x: number; y: number; z: number }> = [
    { x: build.wheelbase.frontX, y: AXLE_LOCAL_Y, z: -AXLE_HALF_TRACK },
    { x: build.wheelbase.frontX, y: AXLE_LOCAL_Y, z: AXLE_HALF_TRACK },
    { x: build.wheelbase.rearX, y: AXLE_LOCAL_Y, z: -AXLE_HALF_TRACK },
    { x: build.wheelbase.rearX, y: AXLE_LOCAL_Y, z: AXLE_HALF_TRACK },
  ]
  for (const p of wheelPositions) {
    totalMass += build.wheels.massEach
    mx += build.wheels.massEach * p.x
    my += build.wheels.massEach * p.y
    mz += build.wheels.massEach * p.z
  }

  const comX = totalMass > 0 ? mx / totalMass : RULES.maxLength / 2
  const comY = totalMass > 0 ? my / totalMass : RULES.maxHeight / 2
  const comZ = totalMass > 0 ? mz / totalMass : 0

  // --- Yaw inertia, for the lateral wobble model. ---
  let yawInertia = 0
  for (const st of stations) {
    const slabMass = st.area * dx * build.woodDensity
    const halfWidthTerm = ((2 * st.halfWidth) ** 2) / 12
    yawInertia += slabMass * ((st.x - comX) ** 2 + halfWidthTerm)
  }
  for (const w of build.weights) {
    yawInertia += w.massKg * ((w.x - comX) ** 2 + (w.z - comZ) ** 2)
  }
  for (const p of wheelPositions) {
    yawInertia += build.wheels.massEach * ((p.x - comX) ** 2 + (p.z - comZ) ** 2)
  }
  yawInertia = Math.max(yawInertia, 1e-6)

  // --- Aerodynamics. Frontal area is the largest cross-section the car presents. ---
  let bodyFrontal = 0
  for (const st of stations) bodyFrontal = Math.max(bodyFrontal, st.area)
  // Four wheels present a fixed frontal area that no amount of body carving removes.
  // This is why shape matters less than intuition suggests: a big chunk of the drag
  // is simply not yours to carve away.
  const wheelFrontal = 4 * WHEEL.width * (WHEEL.radius * 2) * 0.75

  const noseBluntness = sampleProfile(build.profile.side, 0)
  const tailBluntness = sampleProfile(build.profile.side, 1)
  const bodyCd = 0.38 + 0.5 * Math.pow(Math.max(0, noseBluntness), 0.85) + 0.12 * tailBluntness
  const wheelCd = 1.05

  const dragArea = bodyCd * bodyFrontal + wheelCd * wheelFrontal
  const frontalArea = bodyFrontal + wheelFrontal
  const dragCoefficient = frontalArea > 0 ? dragArea / frontalArea : bodyCd

  // --- Rolling resistance. Axle-bore friction dominates, and the axle-radius to
  //     wheel-radius ratio is what converts bore friction into resistance at the
  //     contact patch. This is the single biggest lever in the whole car. ---
  const prep =
    0.45 * clamp01(build.axles.polish) +
    0.25 * clamp01(build.wheels.polish) +
    0.3 * clamp01(build.wheels.lubrication)
  const boreFriction = lerp(0.38, 0.08, prep)
  const boreResistance = boreFriction * (AXLE.radius / WHEEL.radius)
  const treadBase = 0.0035 + 0.007 * (1 - clamp01(build.wheels.trueness))
  const tread = build.wheels.raisedFrontWheel ? treadBase * 0.78 : treadBase
  const rollingResistance = boreResistance + tread

  // --- Wheel spin-up inertia, expressed as an equivalent mass. ---
  const singleWheelInertia = 0.62 * build.wheels.massEach * WHEEL.radius ** 2
  const wheelInertia = singleWheelInertia * contactingWheels
  const effectiveMass = totalMass + wheelInertia / WHEEL.radius ** 2

  const comAheadOfRearAxle = build.wheelbase.rearX - comX
  const wheelbaseLength = build.wheelbase.rearX - build.wheelbase.frontX
  const comBalance = wheelbaseLength > 0 ? (comX - build.wheelbase.frontX) / wheelbaseLength : 0.5

  const warnings = collectWarnings(build, {
    totalMass,
    comAheadOfRearAxle,
    comY,
    comZ,
  })

  return {
    stations,
    bodyVolume: volume,
    bodyMass,
    weightMass,
    wheelMass,
    totalMass,
    effectiveMass,
    com: { massKg: totalMass, comX, comY, comZ, yawInertia },
    comBalance,
    comHeightAboveTrack: comY + RIDE_HEIGHT,
    comAheadOfRearAxle,
    frontalArea,
    dragCoefficient,
    dragArea,
    rollingResistance,
    wheelInertia,
    contactingWheels,
    noseOffset: comX,
    overWeight: totalMass > RULES.maxMass + 1e-9,
    massHeadroom: RULES.maxMass - totalMass,
    warnings,
  }
}

function collectWarnings(
  build: CarBuild,
  m: { totalMass: number; comAheadOfRearAxle: number; comY: number; comZ: number },
): BuildWarning[] {
  const out: BuildWarning[] = []
  if (m.totalMass > RULES.maxMass + 1e-9) {
    out.push({ level: 'error', message: 'Over the 5 oz limit. This car would be disqualified.' })
  } else if (RULES.maxMass - m.totalMass > 0.0035) {
    out.push({
      level: 'warn',
      message: 'Well under 5 oz. Unused mass is free energy you are leaving on the ramp.',
    })
  }
  if (m.comAheadOfRearAxle <= 0.004) {
    out.push({
      level: 'error',
      message: 'Centre of mass is at or behind the rear axle. The nose will lift off the track.',
    })
  } else if (m.comAheadOfRearAxle < inches(0.4)) {
    out.push({
      level: 'warn',
      message: 'Centre of mass is very close to the rear axle. Fast, but it will wheelie if you nudge it further.',
    })
  }
  if (m.comY > inches(0.75)) {
    out.push({ level: 'warn', message: 'High centre of mass. Expect more wobble through the transition.' })
  }
  if (Math.abs(m.comZ) > inches(0.12)) {
    out.push({ level: 'warn', message: 'Weight is off-centre laterally. The car will pull toward one rail.' })
  }
  if (Math.abs(build.axles.steerDeg) > 1.2) {
    out.push({ level: 'warn', message: 'Heavy steer. The car will slam the rail rather than ride it.' })
  }
  return out
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Terminal-ish speed check used for the bench readout: the speed at which drag
 *  and rolling resistance would balance gravity on the ramp. */
export function rampBalanceSpeed(analysis: BuildAnalysis, rampAngleDeg: number): number {
  const theta = (rampAngleDeg * Math.PI) / 180
  const net =
    analysis.totalMass * G * Math.sin(theta) -
    analysis.rollingResistance * analysis.totalMass * G * Math.cos(theta)
  if (net <= 0) return 0
  return Math.sqrt((2 * net) / (AIR_DENSITY * analysis.dragArea))
}

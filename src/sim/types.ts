import { inches, ounces, WHEEL } from './units'

/**
 * A point on a chassis profile curve.
 * `x` runs 0 (nose) to 1 (tail) along the block's length.
 * `v` is 0..1 of the block's max half-width (top profile) or max height (side profile).
 */
export interface ProfilePoint {
  x: number
  v: number
}

/**
 * Chassis geometry as two lofted profiles rather than a carved mesh: the side
 * profile sets the height at each station, the top profile sets the half-width.
 * This keeps volume, centre of mass and frontal area analytic, which is what lets
 * the bench show live stats without running a race.
 */
export interface ChassisProfile {
  /** Height of the deck above the underside, per station. */
  side: ProfilePoint[]
  /** Half-width, per station. */
  top: ProfilePoint[]
  /** Underside cut: how much material is removed from the bottom, per station.
   *  Height 0 here means the body sits on the track surface datum. */
  bottom?: ProfilePoint[]
}

export interface WeightPlacement {
  id: string
  /** Metres from the nose. */
  x: number
  /** Metres above the underside of the block. */
  y: number
  /** Metres from the centreline, positive toward the right-hand side. */
  z: number
  massKg: number
  kind: 'tungsten-cube' | 'tungsten-cylinder' | 'lead-putty' | 'steel-rail'
}

export interface WheelSetup {
  /** Mass of a single wheel, kg. Lighter wheels spin up with less energy. */
  massEach: number
  /** 0 = out-of-round and wobbling, 1 = perfectly trued. */
  trueness: number
  /** 0 = raw moulded bore, 1 = polished mirror. Drives axle-bore friction. */
  polish: number
  /** 0 = dry, 1 = fully burnished graphite. */
  lubrication: number
  /** Three-wheel trick: lift one front wheel clear of the track. */
  raisedFrontWheel: boolean
}

export interface AxleSetup {
  /** Net steer of the front axles, degrees. Positive toes the car toward the rail
   *  on its right. Tiny values are the deliberate "rail rider" technique. */
  steerDeg: number
  /** Random per-wheel misalignment, degrees. Sloppy drilling shows up here. */
  alignmentErrorDeg: number
  /** 0 = rough nail, 1 = polished and grooved. */
  polish: number
}

export interface Wheelbase {
  /** Front axle centre, metres from the nose. */
  frontX: number
  /** Rear axle centre, metres from the nose. */
  rearX: number
}

export interface PaintJob {
  bodyColor: string
  accentColor: string
  finish: 'matte' | 'gloss' | 'metallic' | 'glitter'
  stripe: 'none' | 'centre' | 'twin' | 'flames'
  number: string
}

export interface CarBuild {
  id: string
  name: string
  /** Short label for broadcast overlays: 3-4 characters. */
  tag: string
  profile: ChassisProfile
  /** Wood density, kg/m^3. Pine block stock is about 400. */
  woodDensity: number
  weights: WeightPlacement[]
  wheels: WheelSetup
  axles: AxleSetup
  wheelbase: Wheelbase
  paint: PaintJob
  /** Archetype label when this car came from the bot generator. */
  archetype?: BotArchetype
  createdAt?: number
}

export type BotArchetype = 'speed-demon' | 'wildcard' | 'balanced' | 'underdog'

export interface TrackSpec {
  laneCount: number
  /** Lane centre-to-centre spacing, metres. */
  laneSpacing: number
  /** Total running length from start line to finish line, metres (along the surface). */
  length: number
  /** Height of the start line above the flat run-out, metres. */
  startHeight: number
  /** Ramp slope, degrees. */
  rampAngleDeg: number
  /** Radius of the curved transition from ramp to flat, metres. */
  transitionRadius: number
  /** Half-gap between the centre guide rail and a wheel at rest, metres.
   *  This is the lateral slop the car has before it touches the rail. */
  railClearance: number
  /** Run-out beyond the finish line before the track ends, metres. */
  runoutLength: number
  /** How far past the finish line the braking pad starts, metres. Cars coast over
   *  the line and across this gap before the catch section slows them down. */
  brakeStart: number
}

export const DEFAULT_TRACK: TrackSpec = {
  laneCount: 6,
  laneSpacing: inches(4),
  length: 12.8, // 42 ft
  startHeight: 1.22, // 48 in
  rampAngleDeg: 26,
  transitionRadius: 1.6,
  railClearance: inches(0.22),
  runoutLength: 3.4,
  brakeStart: 0.95,
}

export const STOCK_WHEELS: WheelSetup = {
  massEach: WHEEL.stockMass,
  trueness: 0.7,
  polish: 0.3,
  lubrication: 0.3,
  raisedFrontWheel: false,
}

export const STOCK_AXLES: AxleSetup = {
  steerDeg: 0,
  alignmentErrorDeg: 0.35,
  polish: 0.3,
}

/** Standard pre-cut axle slots: 1 5/8 in from each end of the block. */
export const STOCK_WHEELBASE: Wheelbase = {
  frontX: inches(1.625),
  rearX: inches(7 - 1.625),
}

export const MAX_MASS = ounces(5)

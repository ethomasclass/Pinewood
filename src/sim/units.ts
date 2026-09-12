/**
 * Unit helpers. The simulation runs entirely in SI (metres, kilograms, seconds).
 * Pinewood derby rules are written in inches and ounces, so conversions live here
 * and nowhere else.
 */

export const IN_TO_M = 0.0254
export const M_TO_IN = 1 / IN_TO_M
export const OZ_TO_KG = 0.028349523125
export const KG_TO_OZ = 1 / OZ_TO_KG
export const FT_TO_M = 0.3048

export const inches = (v: number) => v * IN_TO_M
export const ounces = (v: number) => v * OZ_TO_KG
export const feet = (v: number) => v * FT_TO_M

export const toInches = (v: number) => v * M_TO_IN
export const toOunces = (v: number) => v * KG_TO_OZ

/** Gravity, m/s^2. */
export const G = 9.80665
/** Air density at room temperature, kg/m^3. */
export const AIR_DENSITY = 1.204

/** Regulation limits, from standard BSA pinewood derby rules. */
export const RULES = {
  maxLength: inches(7),
  maxWidth: inches(1.75),
  maxHeight: inches(1.25),
  /** Underside clearance the track's centre guide rail needs. */
  minClearance: inches(0.375),
  maxMass: ounces(5),
  /** Width across the outside of the wheels may not exceed this. */
  maxTrack: inches(2.75),
} as const

/** Official wheel/axle dimensions. These matter: axle radius over wheel radius
 *  is the lever that turns axle-bore friction into rolling resistance. */
export const WHEEL = {
  radius: inches(1.18) / 2,
  width: inches(0.375),
  /** Stock wheel mass, kg. Light-weighted wheels go lower. */
  stockMass: 0.0027,
} as const

export const AXLE = {
  radius: inches(0.087) / 2,
} as const

export const formatTime = (seconds: number) => seconds.toFixed(4)
/** Broadcast-facing timing: hundredths, as the doc specifies for the on-screen clock. */
export const formatBroadcastTime = (seconds: number) => seconds.toFixed(3)
export const formatSpeedMph = (metresPerSecond: number) => (metresPerSecond * 2.23694).toFixed(1)
/** Scale speed the way derby broadcasts do: a 1:1 car at 1/24 scale reads like a real racer. */
export const formatScaleMph = (metresPerSecond: number) => (metresPerSecond * 2.23694 * 24).toFixed(0)

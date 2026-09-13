import { analyzeBuild } from './build'
import { PROFILE_PRESETS, cloneProfile, presetById } from './presets'
import { Rng } from './rng'
import { RULES, WHEEL, inches, ounces } from './units'
import {
  STOCK_WHEELBASE,
  type BotArchetype,
  type CarBuild,
  type PaintJob,
  type WeightPlacement,
} from './types'

/**
 * Bot car generation.
 *
 * Archetypes differ in how they are *built*, not in how they are scored. A Speed
 * Demon is fast because its axles are polished and its mass sits low and rearward;
 * a Wildcard wobbles because its wheels are genuinely out of round. Nothing here
 * touches the outcome directly -- the simulation still decides who wins.
 */

export const ARCHETYPE_INFO: Record<BotArchetype, { name: string; blurb: string }> = {
  'speed-demon': {
    name: 'Speed Demon',
    blurb: 'Textbook build. Low, rear-biased, mirror-polished axles. Clean and undramatic.',
  },
  wildcard: {
    name: 'Wildcard',
    blurb: 'Novelty shape, questionable wheels. Might wobble into the rail, might steal a heat.',
  },
  balanced: {
    name: 'Balanced',
    blurb: 'A careful pack car. Nothing wrong with it, nothing special about it.',
  },
  underdog: {
    name: 'Underdog',
    blurb: 'Built the night before. Under weight, rough axles, all heart.',
  },
}

const PALETTE = [
  '#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ff006e',
  '#06d6a0', '#ffbe0b', '#3a86ff', '#fb5607', '#118ab2', '#d90429',
]

const NAMES: Record<BotArchetype, string[]> = {
  'speed-demon': ['Blue Streak', 'Silver Bullet', 'Quicksilver', 'Lightning Rod', 'The Ruler', 'Red Shift'],
  wildcard: ['Hot Dog', 'Bathtub Betty', 'The Toaster', 'Pickle Rocket', 'Cardboard King', 'Mystery Meat'],
  balanced: ['Steady Eddie', 'Pack Mule', 'The Scout', 'Middle Child', 'Old Reliable', 'Dad Helped'],
  underdog: ['Last Minute', 'Duct Tape', 'Sawdust', 'The Splinter', 'Second Try', 'Good Enough'],
}

/**
 * Adds ballast until the car hits the target weight, placed at the requested spot.
 * Returns the placements; if the car is already at or over weight, returns nothing.
 */
export function ballastToWeight(
  build: CarBuild,
  targetMass: number,
  placement: { x: number; y: number; z?: number },
  kind: WeightPlacement['kind'] = 'tungsten-cylinder',
): WeightPlacement[] {
  const bare: CarBuild = { ...build, weights: [] }
  const analysis = analyzeBuild(bare)
  const needed = targetMass - analysis.totalMass
  if (needed <= 1e-6) return []

  // Split the ballast into a few pieces so it reads as real hardware on the bench
  // rather than one magic lump, and so the player can see what is movable.
  const pieces = needed > ounces(1.2) ? 3 : needed > ounces(0.5) ? 2 : 1
  const each = needed / pieces
  const spread = inches(0.28)
  const out: WeightPlacement[] = []
  for (let i = 0; i < pieces; i++) {
    const offset = (i - (pieces - 1) / 2) * spread
    out.push({
      id: `w${i}`,
      x: clampX(placement.x + offset),
      y: placement.y,
      z: placement.z ?? 0,
      massKg: each,
      kind,
    })
  }
  return out
}

const clampX = (x: number) => Math.min(RULES.maxLength - inches(0.2), Math.max(inches(0.2), x))

export function generateBotCar(
  archetype: BotArchetype,
  seed: number,
  index: number,
  taken?: Set<string>,
): CarBuild {
  const rng = new Rng(seed)
  const paint = randomPaint(rng, archetype)
  const name = pickName(rng, archetype, taken)

  let build: CarBuild
  switch (archetype) {
    case 'speed-demon':
      build = speedDemon(rng)
      break
    case 'wildcard':
      build = wildcard(rng)
      break
    case 'underdog':
      build = underdog(rng)
      break
    default:
      build = balanced(rng)
  }

  build.id = `bot-${archetype}-${index}-${seed.toString(36)}`
  build.name = name
  build.tag = tagFor(name, index)
  build.paint = paint
  build.archetype = archetype
  build.createdAt = Date.now()
  return build
}

/** Two cars called "Silver Bullet" in one field makes the ticker unreadable. */
function pickName(rng: Rng, archetype: BotArchetype, taken?: Set<string>): string {
  const pool = NAMES[archetype]
  if (!taken) return rng.pick(pool)
  const free = pool.filter((n) => !taken.has(n))
  const chosen = free.length > 0 ? rng.pick(free) : `${rng.pick(pool)} II`
  taken.add(chosen)
  return chosen
}

function tagFor(name: string, index: number): string {
  const words = name.split(' ')
  const initials = words.map((w) => w[0]).join('').toUpperCase()
  return (initials.length >= 2 ? initials : name.slice(0, 3).toUpperCase()).slice(0, 3) + (index + 1)
}

function randomPaint(rng: Rng, archetype: BotArchetype): PaintJob {
  const body = rng.pick(PALETTE)
  let accent = rng.pick(PALETTE)
  if (accent === body) accent = '#f8f9fa'
  return {
    bodyColor: body,
    accentColor: accent,
    finish: archetype === 'wildcard' ? rng.pick(['glitter', 'metallic', 'gloss'] as const) : rng.pick(['gloss', 'matte', 'metallic'] as const),
    stripe: rng.pick(['none', 'centre', 'twin', 'flames'] as const),
    number: String(rng.int(89) + 10),
  }
}

/** Rear axle pushed back to the end of the block: the standard fast-build move. */
const extendedWheelbase = () => ({
  frontX: inches(0.75),
  rearX: RULES.maxLength - inches(0.6),
})

function speedDemon(rng: Rng): CarBuild {
  const preset = rng.bool(0.65) ? presetById('wedge') : presetById('dragster')
  const wheelbase = extendedWheelbase()
  const base: CarBuild = {
    id: '',
    name: '',
    tag: '',
    profile: cloneProfile(preset.profile),
    woodDensity: 400,
    weights: [],
    wheels: {
      massEach: WHEEL.stockMass * rng.range(0.72, 0.86),
      trueness: rng.range(0.93, 0.99),
      polish: rng.range(0.88, 0.99),
      lubrication: rng.range(0.88, 0.99),
      raisedFrontWheel: rng.bool(0.8),
    },
    axles: {
      // A deliberate whisper of steer: the car leans on the rail instead of
      // bouncing between the rails. This is the real technique, and it is fast.
      steerDeg: rng.range(0.05, 0.18) * (rng.bool() ? 1 : -1),
      alignmentErrorDeg: rng.range(0.01, 0.05),
      polish: rng.range(0.9, 0.99),
    },
    wheelbase,
    paint: randomPaint(rng, 'speed-demon'),
  }
  base.weights = ballastToWeight(base, RULES.maxMass, {
    x: wheelbase.rearX - inches(rng.range(0.6, 1.1)),
    y: inches(rng.range(0.12, 0.26)),
  })
  return base
}

function balanced(rng: Rng): CarBuild {
  const preset = rng.pick([presetById('wedge'), presetById('arrow'), presetById('dolphin')])
  const wheelbase = rng.bool(0.5) ? extendedWheelbase() : { ...STOCK_WHEELBASE }
  const base: CarBuild = {
    id: '',
    name: '',
    tag: '',
    profile: cloneProfile(preset.profile),
    woodDensity: 400,
    weights: [],
    wheels: {
      massEach: WHEEL.stockMass * rng.range(0.9, 1),
      trueness: rng.range(0.72, 0.9),
      polish: rng.range(0.55, 0.78),
      lubrication: rng.range(0.55, 0.8),
      raisedFrontWheel: rng.bool(0.25),
    },
    axles: {
      steerDeg: rng.range(-0.22, 0.22),
      alignmentErrorDeg: rng.range(0.06, 0.18),
      polish: rng.range(0.55, 0.8),
    },
    wheelbase,
    paint: randomPaint(rng, 'balanced'),
  }
  base.weights = ballastToWeight(base, RULES.maxMass - ounces(rng.range(0, 0.12)), {
    x: wheelbase.rearX - inches(rng.range(1.2, 2.4)),
    y: inches(rng.range(0.2, 0.5)),
  })
  return base
}

function wildcard(rng: Rng): CarBuild {
  const preset = rng.pick([presetById('novelty'), presetById('dolphin'), rng.pick(PROFILE_PRESETS)])
  const wheelbase = rng.bool(0.4) ? extendedWheelbase() : { ...STOCK_WHEELBASE }
  const base: CarBuild = {
    id: '',
    name: '',
    tag: '',
    profile: cloneProfile(preset.profile),
    woodDensity: 400,
    weights: [],
    wheels: {
      massEach: WHEEL.stockMass * rng.range(0.85, 1.1),
      // Genuinely out of round. The wobble you see is the wobble it has.
      trueness: rng.range(0.35, 0.62),
      polish: rng.range(0.4, 0.85),
      lubrication: rng.range(0.4, 0.9),
      raisedFrontWheel: rng.bool(0.3),
    },
    axles: {
      steerDeg: rng.range(-0.5, 0.5),
      alignmentErrorDeg: rng.range(0.18, 0.42),
      polish: rng.range(0.4, 0.85),
    },
    wheelbase,
    paint: randomPaint(rng, 'wildcard'),
  }
  base.weights = ballastToWeight(
    base,
    RULES.maxMass - ounces(rng.range(0, 0.25)),
    {
      x: rng.range(inches(2.2), wheelbase.rearX - inches(0.4)),
      y: inches(rng.range(0.3, 0.95)),
      z: inches(rng.range(-0.18, 0.18)),
    },
    'lead-putty',
  )
  return base
}

function underdog(rng: Rng): CarBuild {
  const preset = rng.pick([presetById('block'), presetById('wedge'), presetById('plank')])
  const base: CarBuild = {
    id: '',
    name: '',
    tag: '',
    profile: cloneProfile(preset.profile),
    woodDensity: 400,
    weights: [],
    wheels: {
      massEach: WHEEL.stockMass,
      trueness: rng.range(0.55, 0.75),
      polish: rng.range(0.15, 0.4),
      lubrication: rng.range(0.1, 0.4),
      raisedFrontWheel: false,
    },
    axles: {
      steerDeg: rng.range(-0.32, 0.32),
      alignmentErrorDeg: rng.range(0.2, 0.4),
      polish: rng.range(0.1, 0.35),
    },
    wheelbase: { ...STOCK_WHEELBASE },
    paint: randomPaint(rng, 'underdog'),
  }
  // Under weight, because nobody remembered to bring the scale.
  base.weights = ballastToWeight(base, RULES.maxMass - ounces(rng.range(0.3, 0.9)), {
    x: rng.range(inches(2.4), inches(4.2)),
    y: inches(rng.range(0.25, 0.6)),
  })
  return base
}

export const ALL_ARCHETYPES: BotArchetype[] = ['speed-demon', 'balanced', 'wildcard', 'underdog']

/** Builds a field with a spread of archetypes, so a broadcast has someone to root for. */
export function generateField(count: number, seed: number, mix?: BotArchetype[]): CarBuild[] {
  const rng = new Rng(seed)
  const taken = new Set<string>()
  const out: CarBuild[] = []
  for (let i = 0; i < count; i++) {
    const archetype = mix && mix[i] ? mix[i] : defaultMix(i, rng)
    out.push(generateBotCar(archetype, (seed + i * 7919) >>> 0, i, taken))
  }
  return out
}

function defaultMix(index: number, rng: Rng): BotArchetype {
  // Guarantee a favourite and a wildcard early so the field always has a story.
  if (index === 0) return 'speed-demon'
  if (index === 1) return 'wildcard'
  return rng.pick(ALL_ARCHETYPES)
}

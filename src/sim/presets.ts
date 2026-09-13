import type { ChassisProfile } from './types'

/**
 * Preset chassis profiles. Each is just a set of control points, so a player can
 * grab any one of them on the bench and drag it into something of their own --
 * presets are a starting position, not a locked choice.
 */
export interface ProfilePreset {
  id: string
  name: string
  blurb: string
  profile: ChassisProfile
}

const flat = (v: number) => [
  { x: 0, v },
  { x: 1, v },
]

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: 'block',
    name: 'The Block',
    blurb: 'Straight out of the box. Heavy, blunt, and slower than it looks.',
    profile: { side: flat(1), top: flat(1) },
  },
  {
    id: 'wedge',
    name: 'Classic Wedge',
    blurb: 'The shape that wins pack races. Low nose, full tail for weight.',
    profile: {
      side: [
        { x: 0, v: 0.11 },
        { x: 0.28, v: 0.32 },
        { x: 0.62, v: 0.62 },
        { x: 1, v: 0.92 },
      ],
      top: [
        { x: 0, v: 0.72 },
        { x: 0.25, v: 0.92 },
        { x: 1, v: 1 },
      ],
    },
  },
  {
    id: 'dragster',
    name: 'Dragster',
    blurb: 'Long, thin, low. Minimal frontal area with the mass pushed rearward.',
    profile: {
      side: [
        { x: 0, v: 0.12 },
        { x: 0.5, v: 0.2 },
        { x: 0.74, v: 0.24 },
        { x: 0.82, v: 0.78 },
        { x: 1, v: 0.86 },
      ],
      top: [
        { x: 0, v: 0.34 },
        { x: 0.3, v: 0.4 },
        { x: 0.74, v: 0.52 },
        { x: 0.82, v: 1 },
        { x: 1, v: 1 },
      ],
    },
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    blurb: 'Stepped deck with a rounded snout. Looks quick; the stopwatch disagrees.',
    profile: {
      side: [
        { x: 0, v: 0.18 },
        { x: 0.12, v: 0.34 },
        { x: 0.3, v: 0.3 },
        { x: 0.45, v: 0.44 },
        { x: 0.62, v: 0.8 },
        { x: 0.86, v: 0.88 },
        { x: 1, v: 0.7 },
      ],
      top: [
        { x: 0, v: 0.5 },
        { x: 0.2, v: 0.86 },
        { x: 0.7, v: 1 },
        { x: 1, v: 0.9 },
      ],
    },
  },
  {
    id: 'arrow',
    name: 'Arrow',
    blurb: 'Knife nose in plan view. Narrow up front, broad shoulders at the back.',
    profile: {
      side: [
        { x: 0, v: 0.14 },
        { x: 0.4, v: 0.3 },
        { x: 0.7, v: 0.54 },
        { x: 1, v: 0.74 },
      ],
      top: [
        { x: 0, v: 0.3 },
        { x: 0.35, v: 0.66 },
        { x: 0.72, v: 0.95 },
        { x: 1, v: 1 },
      ],
    },
  },
  {
    id: 'plank',
    name: 'Low Plank',
    blurb: 'Almost nothing above the axles. All the mass has to go somewhere low.',
    profile: {
      side: [
        { x: 0, v: 0.13 },
        { x: 0.2, v: 0.24 },
        { x: 0.8, v: 0.24 },
        { x: 1, v: 0.2 },
      ],
      top: [
        { x: 0, v: 0.55 },
        { x: 0.3, v: 1 },
        { x: 1, v: 1 },
      ],
    },
  },
  {
    id: 'novelty',
    name: 'Hot Dog Cart',
    blurb: 'Tall, proud, and aerodynamically criminal. Worth it.',
    profile: {
      side: [
        { x: 0, v: 0.3 },
        { x: 0.15, v: 0.95 },
        { x: 0.55, v: 1 },
        { x: 0.75, v: 0.45 },
        { x: 1, v: 0.55 },
      ],
      top: [
        { x: 0, v: 0.7 },
        { x: 0.2, v: 1 },
        { x: 0.8, v: 1 },
        { x: 1, v: 0.8 },
      ],
    },
  },
]

export const presetById = (id: string): ProfilePreset =>
  PROFILE_PRESETS.find((p) => p.id === id) ?? PROFILE_PRESETS[1]

export const cloneProfile = (profile: ChassisProfile): ChassisProfile => ({
  side: profile.side.map((p) => ({ ...p })),
  top: profile.top.map((p) => ({ ...p })),
  bottom: profile.bottom?.map((p) => ({ ...p })),
})

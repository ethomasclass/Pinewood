import * as THREE from 'three'
import type { TrackGeometry } from '../sim/track'
import type { CarFrame, RaceEntry } from '../sim/race'

/**
 * The switcher's camera angles, in the spirit of a real broadcast truck: each one is
 * a fixed idea about what the shot is for, not a free-flying camera. A director's
 * skill is choosing between them at the right moment, which only works if each angle
 * has a strong, predictable character.
 */

export type FixedAngleId = 'gate' | 'ramp' | 'finish' | 'overhead' | 'free'
export type CameraAngleId = FixedAngleId | `lane-${number}`

export interface CameraAngleInfo {
  id: CameraAngleId
  label: string
  short: string
  hotkey: string
  description: string
}

export const FIXED_ANGLES: CameraAngleInfo[] = [
  {
    id: 'gate',
    label: 'Starting Gate',
    short: 'GATE',
    hotkey: '1',
    description: 'Tight on the pin drop and the first inch of motion.',
  },
  {
    id: 'ramp',
    label: 'Ramp Cam',
    short: 'RAMP',
    hotkey: '2',
    description: 'Side-on through the descent, where weight placement shows.',
  },
  {
    id: 'finish',
    label: 'Finish Line',
    short: 'FIN',
    hotkey: '3',
    description: 'Locked across all lanes at the line. Doubles as the photo finish.',
  },
  {
    id: 'overhead',
    label: 'Overhead',
    short: 'OVER',
    hotkey: '4',
    description: 'Top-down on the whole field. Best read of the gaps.',
  },
  {
    id: 'free',
    label: 'Free Cam',
    short: 'FREE',
    hotkey: '5',
    description: 'Your own orbit. Drag to fly, for style shots between heats.',
  },
]

/** Lane cams take the number keys after the fixed angles. */
export const laneHotkey = (lane: number): string => String(lane + 6)

export interface ShotContext {
  track: TrackGeometry
  frames: CarFrame[]
  entries: RaceEntry[]
  /** Index into frames/entries of the car currently in front. */
  leaderIndex: number
  aspect: number
}

export interface Shot {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
  up: THREE.Vector3
  /** 0 snaps to the pose; higher values ease toward it. Tracking shots ease. */
  smoothing: number
}

const Y_UP = new THREE.Vector3(0, 1, 0)
const Z_UP = new THREE.Vector3(0, 0, 1)

/** World position of a car's nose, offset above the deck. */
function carPoint(ctx: ShotContext, index: number, lift = 0.03): THREE.Vector3 {
  const frame = ctx.frames[index]
  const entry = ctx.entries[index]
  if (!frame || !entry) return new THREE.Vector3(0, 0, 0)
  const p = ctx.track.pointAt(frame.s)
  const slope = ctx.track.slopeAt(frame.s)
  return new THREE.Vector3(
    p.x + Math.sin(slope) * lift,
    p.y + Math.cos(slope) * lift,
    ctx.track.laneOffset(entry.lane) + frame.y,
  )
}

function packCentre(ctx: ShotContext): THREE.Vector3 {
  if (ctx.frames.length === 0) return new THREE.Vector3()
  const sum = new THREE.Vector3()
  for (let i = 0; i < ctx.frames.length; i++) sum.add(carPoint(ctx, i))
  return sum.divideScalar(ctx.frames.length)
}

export function computeShot(angle: CameraAngleId, ctx: ShotContext): Shot {
  const { track } = ctx
  const spec = track.spec
  const halfWidth = (spec.laneCount * spec.laneSpacing) / 2

  if (angle.startsWith('lane-')) {
    const lane = Number(angle.slice(5))
    const index = ctx.entries.findIndex((e) => e.lane === lane)
    if (index >= 0) return laneShot(ctx, index)
  }

  switch (angle) {
    case 'gate': {
      // Down-track and low, looking back up at the pins. The whole point of this
      // shot is that the cars come at you out of the gate.
      // Beside and just below the gate, at car height, so the field launches straight
      // at the lens. Holding it level with the start line keeps the ramp from
      // occluding the cars the way a down-track position does.
      const gate = track.pointAt(0)
      const down = track.pointAt(0.78)
      return {
        position: new THREE.Vector3(down.x, gate.y - 0.06, halfWidth + 0.34),
        target: new THREE.Vector3(gate.x - 0.06, gate.y + 0.035, 0),
        fov: 44,
        up: Y_UP,
        smoothing: 0,
      }
    }
    case 'ramp': {
      // Dollies alongside the leader through the descent.
      const lead = ctx.frames[ctx.leaderIndex]
      const s = lead ? Math.max(0.3, lead.s - 0.45) : 0.9
      const p = track.pointAt(s)
      const look = ctx.leaderIndex >= 0 ? carPoint(ctx, ctx.leaderIndex) : new THREE.Vector3(p.x, p.y, 0)
      return {
        position: new THREE.Vector3(p.x, p.y + 0.26, halfWidth + 0.82),
        target: look,
        fov: 40,
        up: Y_UP,
        smoothing: 10,
      }
    }
    case 'finish': {
      // Locked. Never moves, never tracks -- that is what makes it trustworthy for
      // a photo finish, and why the replay system reaches for it first.
      const line = track.pointAt(spec.length)
      return {
        position: new THREE.Vector3(line.x + 0.46, line.y + 0.13, halfWidth + 0.3),
        target: new THREE.Vector3(line.x - 0.1, line.y + 0.03, 0),
        fov: 34,
        up: Y_UP,
        smoothing: 0,
      }
    }
    case 'overhead': {
      const centre = packCentre(ctx)
      // Frame every lane with a little margin, whatever the lane count is.
      const needed = spec.laneCount * spec.laneSpacing * 1.45
      const height = needed / (2 * Math.tan(THREE.MathUtils.degToRad(50 / 2)))
      return {
        position: new THREE.Vector3(centre.x + 0.35, centre.y + Math.max(1.4, height), 0),
        target: new THREE.Vector3(centre.x + 0.35, centre.y, 0),
        fov: 50,
        up: Z_UP,
        smoothing: 8,
      }
    }
    default: {
      const centre = packCentre(ctx)
      return {
        position: new THREE.Vector3(centre.x - 1.2, centre.y + 0.7, halfWidth + 1.5),
        target: centre,
        fov: 45,
        up: Y_UP,
        smoothing: 6,
      }
    }
  }
}

/** Chase cam: low, behind, slightly inside the lane. Makes speed legible. */
function laneShot(ctx: ShotContext, index: number): Shot {
  const frame = ctx.frames[index]
  const entry = ctx.entries[index]
  const track = ctx.track
  const behind = Math.max(-0.8, frame.s - 0.62)
  const p = track.pointAt(behind)
  const slope = track.slopeAt(behind)
  const laneZ = track.laneOffset(entry.lane)
  return {
    position: new THREE.Vector3(
      p.x + Math.sin(slope) * 0.14,
      p.y + Math.cos(slope) * 0.14,
      laneZ + 0.1,
    ),
    target: carPoint(ctx, index, 0.02),
    fov: 42,
    up: Y_UP,
    smoothing: 14,
  }
}

/**
 * Applies a shot to the camera. A cut snaps; a tracking shot eases. Snapping on the
 * cut is deliberate -- broadcast switchers hard cut, and a lerp between angles reads
 * as a video game camera rather than a director taking the shot.
 */
export function applyShot(
  camera: THREE.PerspectiveCamera,
  shot: Shot,
  dt: number,
  snap: boolean,
  scratch: { target: THREE.Vector3 },
): void {
  if (snap || shot.smoothing <= 0) {
    camera.position.copy(shot.position)
    scratch.target.copy(shot.target)
  } else {
    const alpha = 1 - Math.exp(-shot.smoothing * dt)
    camera.position.lerp(shot.position, alpha)
    scratch.target.lerp(shot.target, alpha)
  }
  camera.up.copy(shot.up)
  camera.lookAt(scratch.target)
  if (camera.fov !== shot.fov) {
    camera.fov = snap ? shot.fov : THREE.MathUtils.lerp(camera.fov, shot.fov, 1 - Math.exp(-8 * dt))
    camera.updateProjectionMatrix()
  }
}

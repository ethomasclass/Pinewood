import { analyzeBuild, type BuildAnalysis } from './build'
import { PHYSICS_DT, createCarState, noseS, stepCar, type CarPhysicsConfig, type CarState } from './physics'
import { Rng, deriveSeed, hashString } from './rng'
import { buildTrackGeometry, trackMilestones, type TrackGeometry } from './track'
import { PHOTO_FINISH_THRESHOLD, type Milestone, type RaceEvent } from './events'
import { DEFAULT_TRACK, type CarBuild, type TrackSpec } from './types'

/** Recording sample rate. Replay scrubbing and camera work interpolate between these. */
export const FRAME_RATE = 120

export interface RaceEntry {
  lane: number
  build: CarBuild
}

export interface CarFrame {
  /** Nose position along the track, metres. What the sensors and overlays care about. */
  s: number
  v: number
  y: number
  yaw: number
  pitch: number
  wheelAngle: number
  /** Running position in the field, 1-based. */
  position: number
  wheelie: boolean
}

export interface CarResult {
  lane: number
  build: CarBuild
  analysis: BuildAnalysis
  finished: boolean
  /** Elapsed time from gate release to the nose breaking the finish beam. */
  elapsed: number
  position: number
  /** Gap to the winner, seconds. */
  gap: number
  finishSpeed: number
  topSpeed: number
  railHits: number
  energyLostToRail: number
  energyLostToFriction: number
  energyLostToDrag: number
  hadWheelie: boolean
}

export interface RaceRecording {
  frameRate: number
  duration: number
  /** frames[carIndex][frameIndex] */
  frames: CarFrame[][]
  entries: RaceEntry[]
}

export interface RaceResult {
  seed: number
  track: TrackSpec
  geometry: TrackGeometry
  entries: RaceEntry[]
  results: CarResult[]
  events: RaceEvent[]
  recording: RaceRecording
  winner: number
  photoFinish: boolean
  margin: number
}

export interface SimulateOptions {
  seed: number
  track?: TrackSpec
  /** Scales the per-run randomness. 0 makes repeat runs bit-identical. */
  variance?: number
  maxDuration?: number
}

/**
 * Runs one heat to completion and returns everything the rest of the game needs:
 * an ordered result, a full state recording for replay, and the event stream that
 * the auto-cam, announcer and overlays all consume.
 */
export function simulateRace(entries: RaceEntry[], options: SimulateOptions): RaceResult {
  const track = options.track ?? DEFAULT_TRACK
  const geometry = buildTrackGeometry(track)
  const milestones = trackMilestones(geometry)
  const variance = options.variance ?? 1
  const maxDuration = options.maxDuration ?? 12

  const analyses = entries.map((e) => analyzeBuild(e.build))
  const configs: CarPhysicsConfig[] = entries.map((entry, i) =>
    buildConfig(entry, analyses[i], deriveSeed(options.seed, i * 17 + 3), variance),
  )
  const states: CarState[] = entries.map((entry, i) => createCarState(entry.lane, configs[i]))
  const rngs = entries.map((_, i) => new Rng(deriveSeed(options.seed, i * 31 + 101)))

  const events: RaceEvent[] = []
  const frames: CarFrame[][] = entries.map(() => [])
  const topSpeeds = entries.map(() => 0)
  const railHits = entries.map(() => 0)
  const wheelies = entries.map(() => false)

  events.push({ t: 0, type: 'race-armed' })
  events.push({ t: 0, type: 'gate-release' })

  let time = 0
  let frameTime = 0
  const frameStep = 1 / FRAME_RATE
  let leader = -1
  let finishedCount = 0
  const finishOrder: Array<{ index: number; elapsed: number; speed: number }> = []

  // Emit the first frame before any motion so playback starts on the grid.
  pushFrames(frames, states, configs, entries, geometry)

  while (time < maxDuration && finishedCount < entries.length) {
    for (let i = 0; i < entries.length; i++) {
      const state = states[i]
      if (state.finished) continue
      const config = configs[i]

      if (!state.launched) {
        if (time >= config.releaseDelay) {
          state.launched = true
          events.push({ t: time, type: 'car-launch', lane: state.lane })
        } else {
          continue
        }
      }

      const before = noseS(state, config)
      stepCar(state, config, geometry, PHYSICS_DT, rngs[i])
      const after = noseS(state, config)

      topSpeeds[i] = Math.max(topSpeeds[i], state.v)
      if (state.wheelie) wheelies[i] = true

      if (state.lastContact && state.lastContact.severity > 0.06) {
        railHits[i]++
        events.push({
          t: time,
          type: 'rail-contact',
          lane: state.lane,
          severity: state.lastContact.severity,
          side: state.lastContact.side,
          speedLost: state.lastContact.speedLost,
        })
      }

      if (!state.enteredDrop && after >= milestones.dropStart) {
        state.enteredDrop = true
        events.push({ t: time, type: 'drop-enter', lane: state.lane })
      }
      if (!state.exitedDrop && after >= milestones.dropEnd) {
        state.exitedDrop = true
        events.push({ t: time, type: 'drop-exit', lane: state.lane, speed: state.v })
      }

      const milestoneList: Array<[number, Milestone]> = [
        [milestones.quarter, 'quarter'],
        [milestones.half, 'half'],
        [milestones.threeQuarter, 'three-quarter'],
      ]
      for (let mi = state.milestonesPassed; mi < milestoneList.length; mi++) {
        const [pos, name] = milestoneList[mi]
        if (after >= pos) {
          state.milestonesPassed = mi + 1
          events.push({
            t: time,
            type: 'milestone',
            lane: state.lane,
            milestone: name,
            position: standingOf(i, states, configs),
          })
        } else break
      }

      if (after >= track.length) {
        // Interpolate the exact beam-break time rather than snapping to the timestep.
        const span = after - before
        const frac = span > 1e-9 ? (track.length - before) / span : 0
        const exact = time + frac * PHYSICS_DT
        state.finished = true
        state.finishTime = exact
        state.finishSpeed = state.v
        finishedCount++
        finishOrder.push({ index: i, elapsed: exact, speed: state.v })
      }
    }

    time += PHYSICS_DT

    // Leader tracking, evaluated on nose position.
    const currentLeader = leadingIndex(states, configs)
    if (currentLeader >= 0 && currentLeader !== leader) {
      if (leader >= 0) {
        const gap =
          noseS(states[currentLeader], configs[currentLeader]) - noseS(states[leader], configs[leader])
        events.push({
          t: time,
          type: 'lead-change',
          lane: states[currentLeader].lane,
          previousLane: states[leader].lane,
          gap: Math.abs(gap),
        })
      }
      leader = currentLeader
    }

    while (frameTime + frameStep <= time) {
      frameTime += frameStep
      pushFrames(frames, states, configs, entries, geometry)
    }
  }

  // One trailing frame so playback has somewhere to settle.
  pushFrames(frames, states, configs, entries, geometry)

  finishOrder.sort((a, b) => a.elapsed - b.elapsed)
  const winnerIndex = finishOrder.length > 0 ? finishOrder[0].index : 0
  const winnerTime = finishOrder.length > 0 ? finishOrder[0].elapsed : 0

  const results: CarResult[] = entries.map((entry, i) => {
    const placeIndex = finishOrder.findIndex((f) => f.index === i)
    const state = states[i]
    return {
      lane: entry.lane,
      build: entry.build,
      analysis: analyses[i],
      finished: state.finished,
      elapsed: state.finished ? state.finishTime : Number.POSITIVE_INFINITY,
      position: placeIndex >= 0 ? placeIndex + 1 : entries.length,
      gap: state.finished ? state.finishTime - winnerTime : Number.POSITIVE_INFINITY,
      finishSpeed: state.finishSpeed,
      topSpeed: topSpeeds[i],
      railHits: railHits[i],
      energyLostToRail: state.energyLostToRail,
      energyLostToFriction: state.energyLostToFriction,
      energyLostToDrag: state.energyLostToDrag,
      hadWheelie: wheelies[i],
    }
  })

  for (const entry of finishOrder) {
    const r = results[entry.index]
    events.push({
      t: entry.elapsed,
      type: 'car-finish',
      lane: r.lane,
      position: r.position,
      elapsed: r.elapsed,
      speed: r.finishSpeed,
      gap: r.gap,
    })
  }

  const margin =
    finishOrder.length > 1 ? finishOrder[1].elapsed - finishOrder[0].elapsed : Number.POSITIVE_INFINITY
  const photoFinish = margin <= PHOTO_FINISH_THRESHOLD

  const lastFinish = finishOrder.length > 0 ? finishOrder[finishOrder.length - 1].elapsed : time
  events.push({ t: lastFinish, type: 'race-finish', winner: entries[winnerIndex].lane })
  if (photoFinish) {
    const contenders = finishOrder
      .filter((f) => f.elapsed - finishOrder[0].elapsed <= PHOTO_FINISH_THRESHOLD)
      .map((f) => entries[f.index].lane)
    events.push({ t: lastFinish, type: 'photo-finish', lanes: contenders, margin })
  }

  events.sort((a, b) => a.t - b.t)

  const duration = frames[0] ? (frames[0].length - 1) / FRAME_RATE : 0

  return {
    seed: options.seed,
    track,
    geometry,
    entries,
    results,
    events,
    recording: { frameRate: FRAME_RATE, duration, frames, entries },
    winner: entries[winnerIndex].lane,
    photoFinish,
    margin,
  }
}

function buildConfig(
  entry: RaceEntry,
  analysis: BuildAnalysis,
  seed: number,
  variance: number,
): CarPhysicsConfig {
  // Two independent sources of randomness, and the split matters:
  //   `car`  -- permanent quirks derived from the build itself. The same car always
  //             pulls the same way, in every race, forever.
  //   `run`  -- day-of scatter: wax, dust, humidity, how the gate let go. Small.
  const car = new Rng(hashString(entry.build.id || entry.build.name || 'unnamed'))
  const run = new Rng(seed)
  const deg = Math.PI / 180
  const build = entry.build
  const errorSign = car.bool() ? 1 : -1
  return {
    analysis,
    steer: build.axles.steerDeg * deg,
    alignmentError:
      build.axles.alignmentErrorDeg * deg * errorSign * (1 + run.jitter(0.2 * variance)),
    wheelbase: Math.max(0.02, build.wheelbase.rearX - build.wheelbase.frontX),
    wobbleAmplitude:
      (1 - build.wheels.trueness) * 0.0055 * (1 + analysis.com.comY * 26) * (1 + run.jitter(0.2 * variance)),
    wobblePhase: car.range(0, Math.PI * 2),
    frictionVariance: 1 + run.jitter(0.035 * variance),
    dragVariance: 1 + run.jitter(0.02 * variance),
    releaseDelay: Math.max(0, run.range(0, 0.004) * variance),
    startOffset: run.jitter(0.0012 * variance),
    chaos: variance,
  }
}

function pushFrames(
  frames: CarFrame[][],
  states: CarState[],
  configs: CarPhysicsConfig[],
  entries: RaceEntry[],
  geometry: TrackGeometry,
): void {
  for (let i = 0; i < entries.length; i++) {
    const state = states[i]
    frames[i].push({
      s: noseS(state, configs[i]),
      v: state.v,
      y: state.y,
      yaw: state.yaw,
      pitch: -geometry.slopeAt(state.s),
      wheelAngle: state.wheelAngle,
      position: standingOf(i, states, configs),
      wheelie: state.wheelie,
    })
  }
}

/** Index of the car currently at the front, or -1 if nobody has launched. */
function leadingIndex(states: CarState[], configs: CarPhysicsConfig[]): number {
  let best = -1
  let bestProgress = -Infinity
  for (let i = 0; i < states.length; i++) {
    if (!states[i].launched) continue
    const progress = effectiveProgress(states[i], configs[i])
    if (progress > bestProgress) {
      bestProgress = progress
      best = i
    }
  }
  return best
}

function standingOf(index: number, states: CarState[], configs: CarPhysicsConfig[]): number {
  const mine = effectiveProgress(states[index], configs[index])
  let position = 1
  for (let i = 0; i < states.length; i++) {
    if (i === index) continue
    if (effectiveProgress(states[i], configs[i]) > mine) position++
  }
  return position
}

/** Finished cars keep their order; running cars are ranked by nose position. */
function effectiveProgress(state: CarState, config: CarPhysicsConfig): number {
  if (state.finished) return 1e6 - state.finishTime
  return noseS(state, config)
}

/** Interpolate a recording at an arbitrary time. Used by playback and replay scrub. */
export function sampleRecording(recording: RaceRecording, time: number): CarFrame[] {
  const exact = Math.max(0, time) * recording.frameRate
  const i0 = Math.floor(exact)
  const frac = exact - i0
  return recording.frames.map((carFrames) => {
    if (carFrames.length === 0) {
      return { s: 0, v: 0, y: 0, yaw: 0, pitch: 0, wheelAngle: 0, position: 1, wheelie: false }
    }
    const a = carFrames[Math.min(i0, carFrames.length - 1)]
    const b = carFrames[Math.min(i0 + 1, carFrames.length - 1)]
    return {
      s: a.s + (b.s - a.s) * frac,
      v: a.v + (b.v - a.v) * frac,
      y: a.y + (b.y - a.y) * frac,
      yaw: a.yaw + (b.yaw - a.yaw) * frac,
      pitch: a.pitch + (b.pitch - a.pitch) * frac,
      wheelAngle: a.wheelAngle + (b.wheelAngle - a.wheelAngle) * frac,
      position: frac < 0.5 ? a.position : b.position,
      wheelie: frac < 0.5 ? a.wheelie : b.wheelie,
    }
  })
}

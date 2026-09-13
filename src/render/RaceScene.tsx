import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Track, Venue } from './Track'
import { CarMesh, useCarHandle } from './Car'
import { buildTrackGeometry } from '../sim/track'
import { sampleRecording, type CarFrame, type RaceResult } from '../sim/race'
import { EventScheduler, type RaceEvent } from '../sim/events'
import { AutoCamDirector, bestReplayAngle } from '../broadcast/autocam'
import { consumeOverride } from '../broadcast/directorBus'
import { CommentaryEngine } from '../broadcast/commentary'
import { applyShot, computeShot, type CameraAngleId } from '../broadcast/cameras'
import { playback, publishReadout } from '../state/playback'
import { useStore } from '../state/store'
import { useFeed } from '../state/feed'
import { playFinish, playGate, playRail, setCrowdLevel, setRoll, startCrowd, startRoll } from '../audio/sfx'
import type { OrbitState } from './FreeCam'

/**
 * Everything the broadcast needs, driven from one loop.
 *
 * The order here is the point: sample the recording, move the cars, fire the events
 * that are due, let the director decide what is on air, then place the camera. The
 * director, the announcer, the overlays and the sound all read the same event stream,
 * so they can never disagree about what just happened.
 */
export function RaceScene({ orbit }: { orbit: React.RefObject<OrbitState> }) {
  const race = useStore((s) => s.race)
  const trackSpec = useStore((s) => s.track)
  const geometry = useMemo(() => buildTrackGeometry(trackSpec), [trackSpec])

  const applyFns = useRef<Array<((frame: CarFrame) => void) | null>>([])
  const gateRef = useRef<THREE.Group>(null)

  if (!race) return null

  return (
    <>
      <Lighting />
      <Track track={geometry} gateRef={gateRef} />
      <Venue track={geometry} />
      {race.entries.map((entry, index) => (
        <CarActor
          key={`${entry.lane}-${entry.build.id}`}
          index={index}
          build={entry.build}
          laneOffset={geometry.laneOffset(entry.lane)}
          track={geometry}
          register={(i, fn) => {
            applyFns.current[i] = fn
          }}
        />
      ))}
      <DirectorLoop race={race} applyFns={applyFns} orbit={orbit} gateRef={gateRef} />
    </>
  )
}

function Lighting() {
  return (
    <>
      <hemisphereLight args={['#fff3dd', '#7d6a4f', 1.5]} />
      <ambientLight intensity={0.32} color="#ffe9c9" />
      <directionalLight
        position={[4, 7, 5]}
        intensity={1.85}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-6, 4, -4]} intensity={0.35} color="#cfe3ff" />
    </>
  )
}

function CarActor({
  index,
  build,
  laneOffset,
  track,
  register,
}: {
  index: number
  build: Parameters<typeof useCarHandle>[0]
  laneOffset: number
  track: Parameters<typeof useCarHandle>[2]
  register: (index: number, fn: ((frame: CarFrame) => void) | null) => void
}) {
  const { groupRef, wheelRefs, apply } = useCarHandle(build, laneOffset, track)
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    register(index, (frame) => applyRef.current(frame))
    return () => register(index, null)
  }, [index, register])

  return <CarMesh build={build} groupRef={groupRef} wheelRefs={wheelRefs} />
}

/** How long after the last car is timed before the results board comes up. Long
 *  enough to watch the field roll into the catch section, short enough not to wait
 *  on the slowest car rolling to a complete stop. */
const RESULTS_DELAY = 1.8

function DirectorLoop({
  race,
  applyFns,
  orbit,
  gateRef,
}: {
  race: RaceResult
  applyFns: React.RefObject<Array<((frame: CarFrame) => void) | null>>
  orbit: React.RefObject<OrbitState>
  gateRef: React.RefObject<THREE.Group | null>
}) {
  const { camera, size } = useThree()
  const scratch = useRef({ target: new THREE.Vector3() })
  const previousAngle = useRef<CameraAngleId | null>(null)
  const finished = useRef(false)

  /** When the last car breaks the beam. The recording runs on past this while the
   *  field coasts to a stop, so the results board keys off the timing, not the tape. */
  const lastFinishAt = useMemo(() => {
    const times = race.results.map((r) => r.elapsed).filter((t) => Number.isFinite(t))
    return times.length > 0 ? Math.max(...times) : race.recording.duration
  }, [race])

  const director = useMemo(() => new AutoCamDirector(), [])
  const commentary = useMemo(
    () => new CommentaryEngine(race.entries, race.seed),
    [race.entries, race.seed],
  )
  const scheduler = useMemo(() => new EventScheduler(race.events), [race.events])

  useEffect(() => {
    director.reset()
    commentary.reset()
    scheduler.reset()
    useFeed.getState().clear()
    useFeed.getState().setStartLights(0)
    finished.current = false
    previousAngle.current = null
    startCrowd()
    startRoll()
  }, [director, commentary, scheduler])

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const store = useStore.getState()
    const replay = store.replay

    // --- The player can steal one shot without switching auto-cam off. ---
    const override = consumeOverride()
    if (override) director.override(override, playback.time)

    // --- Advance the clock. Slow motion multiplies whatever rate is in play. ---
    if (playback.playing && !playback.scrubbing) {
      const slow = store.slowMo ? (replay ? 0.4 : 0.3) : 1
      const rate = (replay ? replay.rate : playback.rate) * slow
      playback.time += dt * rate
    }

    if (replay) {
      if (playback.time >= replay.endTime) {
        playback.time = replay.resumeAt
        scheduler.seek(playback.time)
        store.endReplay()
      } else if (playback.time < replay.startTime) {
        playback.time = replay.startTime
      }
    }

    const recordingDuration = race.recording.duration
    const sampleTime = Math.min(playback.time, recordingDuration)
    const frames = sampleRecording(race.recording, sampleTime)

    // --- Move the cars. ---
    const fns = applyFns.current
    for (let i = 0; i < frames.length; i++) fns[i]?.(frames[i])

    // --- Drop the gate. Fast, mechanical, and done inside a tenth of a second. ---
    if (gateRef.current) {
      const drop = Math.min(1, Math.max(0, playback.time / 0.09))
      gateRef.current.rotation.z = -drop * 1.45
    }

    // --- Fire the events that have come due. Replays run silent, the way a real
    //     broadcast does: the announcer talks over them live. ---
    if (!replay) {
      scheduler.advanceTo(playback.time)
    }

    let leaderIndex = 0
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].position < frames[leaderIndex].position) leaderIndex = i
    }

    const ctx = {
      track: race.geometry,
      frames,
      entries: race.entries,
      leaderIndex,
      aspect: size.width / Math.max(1, size.height),
    }

    // --- Decide what is on air. ---
    let angle: CameraAngleId
    if (replay) {
      angle = replay.angle
    } else if (store.autoCam) {
      angle = director.update(playback.time, {
        track: race.geometry,
        entries: race.entries,
        leaderLane: race.entries[leaderIndex]?.lane ?? 0,
        leadProgress: frames[leaderIndex]?.s ?? 0,
      })
    } else {
      angle = store.activeAngle
    }

    const snap = previousAngle.current !== angle
    previousAngle.current = angle

    if (angle === 'free' && orbit.current) {
      applyOrbit(camera as THREE.PerspectiveCamera, orbit.current, ctx.track.spec.length, snap, dt, scratch.current)
    } else {
      const shot = computeShot(angle, ctx)
      applyShot(camera as THREE.PerspectiveCamera, shot, dt, snap, scratch.current)
    }

    // --- Sound follows the picture. ---
    const onAirSpeed = frames[leaderIndex]?.v ?? 0
    setRoll(playback.time < recordingDuration ? onAirSpeed : 0)
    const closeness = closenessOf(frames)
    setCrowdLevel(0.02 + closeness * 0.11)

    publishReadout({
      time: playback.time,
      frames,
      leaderIndex,
      onAir: angle,
      directorReason: store.autoCam ? director.reason : 'Manual',
      autoCam: store.autoCam,
      replaying: Boolean(replay),
    })

    // --- Hand over to the results board once the race is done and any automatic
    //     replay has played out. ---
    if (!finished.current && !replay && playback.time > lastFinishAt + RESULTS_DELAY) {
      finished.current = true
      useStore.getState().finishHeat()
    }
  })

  // Event side effects: sound, the announcer, and the overlays.
  useEffect(() => {
    const unsubscribe = scheduler.subscribe((event: RaceEvent) => {
      const feed = useFeed.getState()
      const before = commentary.all.length
      commentary.consume(event, race.results)
      for (let i = before; i < commentary.all.length; i++) feed.addLine(commentary.all[i])

      director.onEvent(event, {
        track: race.geometry,
        entries: race.entries,
        leaderLane: race.winner,
        leadProgress: 0,
      })

      switch (event.type) {
        case 'gate-release':
          playGate()
          feed.setStartLights(4)
          break
        case 'rail-contact':
          if (event.severity > 0.2) playRail(event.severity)
          break
        case 'car-finish':
          if (event.position === 1) playFinish()
          break
        case 'photo-finish': {
          feed.setPhotoFinish({ lanes: event.lanes, margin: event.margin })
          // The signature moment: cut to the best angle and roll it in slow motion.
          const angle = bestReplayAngle(race.events, race.entries)
          // Roughly three and a half seconds on air: long enough to see the noses
          // separate, short enough that the room does not go quiet.
          useStore.getState().startReplay({
            startTime: Math.max(0, event.t - 0.75),
            endTime: event.t + 0.22,
            angle,
            rate: 0.26,
            resumeAt: event.t + 0.22,
            label: 'PHOTO FINISH',
          })
          break
        }
        default:
          break
      }
    })
    return unsubscribe
  }, [scheduler, commentary, director, race])

  return null
}

/** How tight the race is right now, 0..1, used to drive the crowd. */
function closenessOf(frames: CarFrame[]): number {
  if (frames.length < 2) return 0
  const sorted = [...frames].sort((a, b) => b.s - a.s)
  const gap = sorted[0].s - sorted[1].s
  return Math.max(0, 1 - gap / 0.35)
}

function applyOrbit(
  camera: THREE.PerspectiveCamera,
  orbit: OrbitState,
  trackLength: number,
  snap: boolean,
  dt: number,
  scratch: { target: THREE.Vector3 },
): void {
  const target = new THREE.Vector3(orbit.targetX ?? trackLength * 0.4, 0.25, 0)
  const position = new THREE.Vector3(
    target.x + orbit.distance * Math.cos(orbit.polar) * Math.cos(orbit.azimuth),
    target.y + orbit.distance * Math.sin(orbit.polar),
    target.z + orbit.distance * Math.cos(orbit.polar) * Math.sin(orbit.azimuth),
  )
  applyShot(
    camera,
    { position, target, fov: 45, up: new THREE.Vector3(0, 1, 0), smoothing: snap ? 0 : 12 },
    dt,
    snap,
    scratch,
  )
}

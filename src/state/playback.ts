import { useSyncExternalStore } from 'react'
import type { CarFrame } from '../sim/race'

/**
 * The playback clock and the live race readout.
 *
 * Both live deliberately outside React. The render loop writes to them sixty times a
 * second; React subscribers are woken on a throttle so the ticker updates smoothly
 * without asking the reconciler to walk the tree at frame rate.
 */

export interface PlaybackClock {
  time: number
  rate: number
  playing: boolean
  duration: number
  /** Set when the viewer is scrubbing, so the loop stops advancing the clock. */
  scrubbing: boolean
}

export const playback: PlaybackClock = {
  time: 0,
  rate: 1,
  playing: false,
  duration: 0,
  scrubbing: false,
}

export interface LiveReadout {
  time: number
  frames: CarFrame[]
  leaderIndex: number
  onAir: string
  directorReason: string
  autoCam: boolean
  replaying: boolean
}

let readout: LiveReadout = {
  time: 0,
  frames: [],
  leaderIndex: 0,
  onAir: 'GATE',
  directorReason: '',
  autoCam: true,
  replaying: false,
}

let version = 0
const listeners = new Set<() => void>()
let lastPublish = 0

/** Publishes at most every `throttleMs`; a forced publish is used on discrete changes. */
export function publishReadout(next: LiveReadout, force = false, throttleMs = 45): void {
  readout = next
  const now = performance.now()
  if (!force && now - lastPublish < throttleMs) return
  lastPublish = now
  version++
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLiveReadout(): LiveReadout {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  )
  return readout
}

export const resetPlayback = (duration: number): void => {
  playback.time = 0
  playback.rate = 1
  playback.playing = true
  playback.duration = duration
  playback.scrubbing = false
}

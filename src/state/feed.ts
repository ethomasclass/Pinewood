import { create } from 'zustand'
import type { CommentaryLine } from '../broadcast/commentary'

/** Discrete broadcast output: announcer lines and the big on-screen moments. */
interface FeedState {
  lines: CommentaryLine[]
  photoFinish: { lanes: number[]; margin: number } | null
  /** Countdown state for the start-light graphic: -1 idle, 0..3 lights, 4 away. */
  startLights: number
  addLine(line: CommentaryLine): void
  setPhotoFinish(value: FeedState['photoFinish']): void
  setStartLights(value: number): void
  clear(): void
}

export const useFeed = create<FeedState>((set, get) => ({
  lines: [],
  photoFinish: null,
  startLights: -1,
  addLine(line) {
    set({ lines: [...get().lines, line].slice(-24) })
  },
  setPhotoFinish(value) {
    set({ photoFinish: value })
  },
  setStartLights(value) {
    set({ startLights: value })
  },
  clear() {
    set({ lines: [], photoFinish: null, startLights: -1 })
  },
}))

import { create } from 'zustand'
import { simulateRace, type RaceEntry, type RaceResult } from '../sim/race'
import { generateField } from '../sim/archetypes'
import { randomSeed } from '../sim/rng'
import { DEFAULT_TRACK, type BotArchetype, type CarBuild, type TrackSpec } from '../sim/types'
import type { CameraAngleId } from '../broadcast/cameras'
import { resetPlayback } from './playback'
import { useFeed } from './feed'

export type Phase = 'setup' | 'live' | 'results'
export type RaceFormat = 'single' | 'bo3'

export interface ReplayWindow {
  startTime: number
  endTime: number
  angle: CameraAngleId
  rate: number
  /** Where to return the clock when the replay ends. */
  resumeAt: number
  label: string
}

export interface Clip {
  id: string
  label: string
  raceSeed: number
  startTime: number
  endTime: number
  angle: CameraAngleId
  createdAt: number
}

export interface OverlayToggles {
  ticker: boolean
  lowerThird: boolean
  commentary: boolean
  startLights: boolean
  speedTrap: boolean
}

interface AppState {
  phase: Phase
  track: TrackSpec
  fieldSize: number
  archetypeMix: BotArchetype[]
  format: RaceFormat
  seed: number

  field: CarBuild[]
  race: RaceResult | null
  heat: number
  seriesWins: Record<number, number>
  seriesComplete: boolean

  activeAngle: CameraAngleId
  autoCam: boolean
  slowMo: boolean
  overlays: OverlayToggles
  replay: ReplayWindow | null
  clips: Clip[]

  setFieldSize(n: number): void
  setArchetype(lane: number, archetype: BotArchetype): void
  setFormat(format: RaceFormat): void
  rerollField(): void
  startBroadcast(): void
  runHeat(): void
  setAngle(angle: CameraAngleId): void
  toggleAutoCam(): void
  toggleSlowMo(): void
  toggleOverlay(key: keyof OverlayToggles): void
  startReplay(window: ReplayWindow): void
  endReplay(): void
  saveClip(clip: Omit<Clip, 'id' | 'createdAt'>): void
  deleteClip(id: string): void
  finishHeat(): void
  backToSetup(): void
}

const CLIP_STORAGE_KEY = 'pinewood.clips.v1'

const loadClips = (): Clip[] => {
  try {
    const raw = localStorage.getItem(CLIP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Clip[]) : []
  } catch {
    return []
  }
}

const saveClips = (clips: Clip[]) => {
  try {
    localStorage.setItem(CLIP_STORAGE_KEY, JSON.stringify(clips.slice(-40)))
  } catch {
    // Storage being unavailable must never break a broadcast.
  }
}

const defaultMix = (size: number): BotArchetype[] => {
  const pool: BotArchetype[] = ['speed-demon', 'wildcard', 'balanced', 'underdog', 'balanced', 'speed-demon', 'wildcard', 'underdog']
  return Array.from({ length: size }, (_, i) => pool[i % pool.length])
}

const entriesFrom = (field: CarBuild[]): RaceEntry[] => field.map((build, lane) => ({ lane, build }))

export const useStore = create<AppState>((set, get) => ({
  phase: 'setup',
  track: DEFAULT_TRACK,
  fieldSize: 6,
  archetypeMix: defaultMix(6),
  format: 'single',
  seed: randomSeed(),

  field: [],
  race: null,
  heat: 1,
  seriesWins: {},
  seriesComplete: false,

  activeAngle: 'gate',
  autoCam: true,
  slowMo: false,
  overlays: { ticker: true, lowerThird: true, commentary: true, startLights: true, speedTrap: true },
  replay: null,
  clips: loadClips(),

  setFieldSize(n) {
    const size = Math.max(2, Math.min(8, n))
    const mix = get().archetypeMix.slice(0, size)
    while (mix.length < size) mix.push(defaultMix(size)[mix.length])
    set({
      fieldSize: size,
      archetypeMix: mix,
      track: { ...get().track, laneCount: size },
      field: [],
    })
  },

  setArchetype(lane, archetype) {
    const mix = [...get().archetypeMix]
    mix[lane] = archetype
    set({ archetypeMix: mix, field: [] })
  },

  setFormat(format) {
    set({ format })
  },

  rerollField() {
    const seed = randomSeed()
    set({ seed, field: generateField(get().fieldSize, seed, get().archetypeMix) })
  },

  startBroadcast() {
    const state = get()
    const field = state.field.length === state.fieldSize
      ? state.field
      : generateField(state.fieldSize, state.seed, state.archetypeMix)
    set({
      field,
      phase: 'live',
      heat: 1,
      seriesWins: {},
      seriesComplete: false,
      race: null,
      replay: null,
    })
    get().runHeat()
  },

  runHeat() {
    const state = get()
    // Each heat gets its own variance seed: same cars, live day-of scatter.
    const heatSeed = (state.seed + state.heat * 7717) >>> 0
    const race = simulateRace(entriesFrom(state.field), { seed: heatSeed, track: state.track })
    set({ race, activeAngle: 'gate', replay: null })
    resetPlayback(race.recording.duration + 1.6)
  },

  setAngle(angle) {
    set({ activeAngle: angle })
  },

  toggleAutoCam() {
    set({ autoCam: !get().autoCam })
  },

  toggleSlowMo() {
    set({ slowMo: !get().slowMo })
  },

  toggleOverlay(key) {
    set({ overlays: { ...get().overlays, [key]: !get().overlays[key] } })
  },

  startReplay(window) {
    set({ replay: window })
  },

  endReplay() {
    set({ replay: null })
  },

  saveClip(clip) {
    const next: Clip = { ...clip, id: `clip-${Date.now().toString(36)}`, createdAt: Date.now() }
    const clips = [...get().clips, next]
    saveClips(clips)
    set({ clips })
  },

  deleteClip(id) {
    const clips = get().clips.filter((c) => c.id !== id)
    saveClips(clips)
    set({ clips })
  },

  finishHeat() {
    const state = get()
    if (!state.race) return
    const winner = state.race.winner
    const seriesWins = { ...state.seriesWins, [winner]: (state.seriesWins[winner] ?? 0) + 1 }
    const needed = state.format === 'bo3' ? 2 : 1
    const complete = Object.values(seriesWins).some((w) => w >= needed)
    useFeed.getState().setPhotoFinish(null)
    set({ seriesWins, seriesComplete: complete, phase: 'results' })
  },

  backToSetup() {
    set({ phase: 'setup', race: null, replay: null, heat: 1, seriesWins: {}, seriesComplete: false })
  },
}))

/** Advances to the next heat of a series. */
export const nextHeat = () => {
  const state = useStore.getState()
  useStore.setState({ heat: state.heat + 1, phase: 'live' })
  useStore.getState().runHeat()
}

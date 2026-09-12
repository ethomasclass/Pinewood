/**
 * The race-state event stream.
 *
 * Everything downstream of the simulation -- the auto-cam director, the announcer,
 * and the on-screen overlays -- reads this and only this. Building it first is what
 * keeps those three features from each inventing their own idea of what happened.
 */

export type RaceEventType =
  | 'race-armed'
  | 'gate-release'
  | 'car-launch'
  | 'drop-enter'
  | 'drop-exit'
  | 'lead-change'
  | 'rail-contact'
  | 'wobble'
  | 'wheelie'
  | 'milestone'
  | 'car-finish'
  | 'race-finish'
  | 'photo-finish'

export type Milestone = 'quarter' | 'half' | 'three-quarter'

interface BaseEvent {
  /** Race time in seconds, 0 at gate release. */
  t: number
  type: RaceEventType
}

export interface RaceArmedEvent extends BaseEvent {
  type: 'race-armed'
}
export interface GateReleaseEvent extends BaseEvent {
  type: 'gate-release'
}
export interface CarLaunchEvent extends BaseEvent {
  type: 'car-launch'
  lane: number
}
export interface DropEnterEvent extends BaseEvent {
  type: 'drop-enter'
  lane: number
}
export interface DropExitEvent extends BaseEvent {
  type: 'drop-exit'
  lane: number
  speed: number
}
export interface LeadChangeEvent extends BaseEvent {
  type: 'lead-change'
  lane: number
  previousLane: number
  /** Gap back to the car that just lost the lead, metres. */
  gap: number
}
export interface RailContactEvent extends BaseEvent {
  type: 'rail-contact'
  lane: number
  /** 0..1, scaled by how hard the car hit. */
  severity: number
  side: -1 | 1
  speedLost: number
}
export interface WobbleEvent extends BaseEvent {
  type: 'wobble'
  lane: number
  severity: number
}
export interface WheelieEvent extends BaseEvent {
  type: 'wheelie'
  lane: number
}
export interface MilestoneEvent extends BaseEvent {
  type: 'milestone'
  lane: number
  milestone: Milestone
  position: number
}
export interface CarFinishEvent extends BaseEvent {
  type: 'car-finish'
  lane: number
  position: number
  elapsed: number
  speed: number
  /** Gap to the winner, seconds. Zero for the winner. */
  gap: number
}
export interface RaceFinishEvent extends BaseEvent {
  type: 'race-finish'
  winner: number
}
export interface PhotoFinishEvent extends BaseEvent {
  type: 'photo-finish'
  lanes: number[]
  /** Margin between the top two, seconds. */
  margin: number
}

export type RaceEvent =
  | RaceArmedEvent
  | GateReleaseEvent
  | CarLaunchEvent
  | DropEnterEvent
  | DropExitEvent
  | LeadChangeEvent
  | RailContactEvent
  | WobbleEvent
  | WheelieEvent
  | MilestoneEvent
  | CarFinishEvent
  | RaceFinishEvent
  | PhotoFinishEvent

/** A finish closer than this triggers the photo-finish treatment. */
export const PHOTO_FINISH_THRESHOLD = 0.035

export type RaceEventListener = (event: RaceEvent) => void

/**
 * Replays a recorded event list against listeners as playback time advances.
 * Live directing and replay playback both run through this, so a replay fires the
 * exact same cuts and announcer lines the live race did.
 */
export class EventScheduler {
  private cursor = 0
  private listeners = new Set<RaceEventListener>()

  constructor(private events: RaceEvent[]) {}

  subscribe(listener: RaceEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Fire every event at or before `time` that has not fired yet. */
  advanceTo(time: number): void {
    while (this.cursor < this.events.length && this.events[this.cursor].t <= time) {
      const event = this.events[this.cursor++]
      for (const listener of this.listeners) listener(event)
    }
  }

  /** Rewind to a given time without firing anything (used when scrubbing a replay). */
  seek(time: number): void {
    this.cursor = 0
    while (this.cursor < this.events.length && this.events[this.cursor].t <= time) this.cursor++
  }

  reset(): void {
    this.cursor = 0
  }
}

export const eventsBetween = (events: RaceEvent[], from: number, to: number): RaceEvent[] =>
  events.filter((e) => e.t >= from && e.t <= to)

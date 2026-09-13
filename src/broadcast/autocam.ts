import type { RaceEvent } from '../sim/events'
import type { CameraAngleId } from './cameras'
import type { TrackGeometry } from '../sim/track'
import type { RaceEntry } from '../sim/race'

/**
 * The AI director.
 *
 * It reads the same event stream the announcer and overlays read, and it plays by
 * broadcast rules rather than game-camera rules: every cut has a reason, no shot is
 * shorter than a beat the viewer can register, and the finish line is locked off
 * before the cars arrive rather than chased after they do.
 *
 * The player can take a single cut without switching auto-cam off. The director
 * yields for a couple of seconds and then quietly resumes, which is what makes
 * riding auto-cam and stealing the shots that matter a real way to direct.
 */

interface CutRequest {
  angle: CameraAngleId
  priority: number
  /** Ignore this request after this time. */
  expires: number
  reason: string
}

/** No shot shorter than this: a cut the viewer cannot register is a mistake. */
const MIN_SHOT = 0.5
/** Sitting on one angle longer than this reads as a dead broadcast. */
const MAX_SHOT = 2.2
/** How long the director yields after the player steals a cut. */
export const OVERRIDE_DURATION = 2.6

export interface AutoCamContext {
  track: TrackGeometry
  entries: RaceEntry[]
  leaderLane: number
  /** Furthest nose position in the field, metres. */
  leadProgress: number
}

export class AutoCamDirector {
  private current: CameraAngleId = 'gate'
  // Starting at zero rather than -Infinity matters: the opening shot is the gate, and
  // it has to be allowed to hold rather than immediately ageing out into a fallback.
  private shotStartedAt = 0
  private queue: CutRequest[] = []
  private lockedToFinish = false
  private lastReason = 'Opening shot'
  private overrideUntil = -Infinity
  private overrideAngle: CameraAngleId | null = null

  reset(): void {
    this.current = 'gate'
    this.shotStartedAt = 0
    this.queue = []
    this.lockedToFinish = false
    this.lastReason = 'Opening shot'
    this.overrideUntil = -Infinity
    this.overrideAngle = null
  }

  /** The player grabbed one shot. Honour it, then resume directing. */
  override(angle: CameraAngleId, time: number): void {
    this.overrideAngle = angle
    this.overrideUntil = time + OVERRIDE_DURATION
    this.current = angle
    this.shotStartedAt = time
    this.lastReason = 'Manual override'
  }

  get reason(): string {
    return this.lastReason
  }

  get overriding(): boolean {
    return this.overrideAngle !== null
  }

  onEvent(event: RaceEvent, ctx: AutoCamContext): void {
    switch (event.type) {
      case 'gate-release':
        this.request({ angle: 'gate', priority: 5, expires: event.t + 0.9, reason: 'Gate drop' })
        break
      case 'drop-enter':
        // Only the first car into the transition earns the cut; after that it is old news.
        this.request({ angle: 'ramp', priority: 6, expires: event.t + 0.8, reason: 'Into the drop' })
        break
      case 'drop-exit':
        this.request({
          angle: `lane-${ctx.leaderLane}`,
          priority: 4,
          expires: event.t + 0.9,
          reason: 'Out of the transition',
        })
        break
      case 'lead-change':
        this.request({
          angle: `lane-${event.lane}`,
          priority: 8,
          expires: event.t + 0.7,
          reason: `Lead change to lane ${event.lane + 1}`,
        })
        break
      case 'race-finish':
        // The timing is done; release the finish lock and go wide so the viewer sees
        // the field roll out rather than staring at an empty line.
        this.lockedToFinish = false
        this.request({ angle: 'overhead', priority: 9, expires: event.t + 2.5, reason: 'Field rolls out' })
        break
      case 'rail-contact':
        if (event.severity > 0.45) {
          this.request({
            angle: `lane-${event.lane}`,
            priority: 6,
            expires: event.t + 0.6,
            reason: `Lane ${event.lane + 1} into the rail`,
          })
        }
        break
      case 'milestone':
        if (event.milestone === 'three-quarter') {
          // Get to the finish line and stay there. Chasing the finish never works.
          this.lockedToFinish = true
          this.request({ angle: 'finish', priority: 10, expires: event.t + 3, reason: 'Setting the finish' })
        } else if (event.milestone === 'half') {
          this.request({ angle: 'overhead', priority: 3, expires: event.t + 0.8, reason: 'Reading the gaps' })
        }
        break
      default:
        break
    }
  }

  private request(cut: CutRequest): void {
    this.queue.push(cut)
  }

  /** Returns the angle the director wants on air right now. */
  update(time: number, ctx: AutoCamContext): CameraAngleId {
    if (this.overrideAngle) {
      if (time < this.overrideUntil) return this.overrideAngle
      this.overrideAngle = null
      // Resuming: force a fresh decision rather than sitting on the stolen shot.
      this.shotStartedAt = -Infinity
    }

    this.queue = this.queue.filter((c) => c.expires >= time)
    const elapsed = time - this.shotStartedAt

    if (this.lockedToFinish) {
      if (this.current !== 'finish') this.take('finish', time, 'Locked on the line')
      return this.current
    }

    let best: CutRequest | null = null
    for (const cut of this.queue) {
      if (cut.angle === this.current) continue
      if (!best || cut.priority > best.priority) best = cut
    }

    if (best && elapsed >= MIN_SHOT) {
      this.queue = this.queue.filter((c) => c !== best)
      this.take(best.angle, time, best.reason)
      return this.current
    }

    // Nothing asked for a cut and the shot has gone stale: fall back to whoever is
    // winning, which is the shot a viewer wants by default.
    if (elapsed >= MAX_SHOT) {
      const fallback: CameraAngleId =
        ctx.leadProgress < ctx.track.transitionStart
          ? 'ramp'
          : this.current === `lane-${ctx.leaderLane}`
            ? 'overhead'
            : `lane-${ctx.leaderLane}`
      this.take(fallback, time, this.current === fallback ? this.lastReason : 'Staying with the leader')
      return this.current
    }

    return this.current
  }

  private take(angle: CameraAngleId, time: number, reason: string): void {
    this.current = angle
    this.shotStartedAt = time
    this.lastReason = reason
  }
}

/**
 * Picks the angle a replay should be cut from. A close finish is always worth the
 * locked finish camera; a crash is worth the lane it happened in.
 */
export function bestReplayAngle(events: RaceEvent[], entries: RaceEntry[]): CameraAngleId {
  const photo = events.find((e) => e.type === 'photo-finish')
  if (photo) return 'finish'
  const bigHit = events
    .filter((e): e is Extract<RaceEvent, { type: 'rail-contact' }> => e.type === 'rail-contact')
    .sort((a, b) => b.severity - a.severity)[0]
  if (bigHit && bigHit.severity > 0.6) return `lane-${bigHit.lane}`
  const lastLead = [...events].reverse().find((e) => e.type === 'lead-change')
  if (lastLead && lastLead.type === 'lead-change') return `lane-${lastLead.lane}`
  return entries.length > 0 ? 'finish' : 'overhead'
}

import { Rng } from '../sim/rng'
import { PHOTO_FINISH_THRESHOLD, type RaceEvent } from '../sim/events'
import type { CarResult, RaceEntry } from '../sim/race'
import { formatBroadcastTime } from '../sim/units'

/**
 * The announcer. Warm and a little corny, because that is what a real pack derby
 * sounds like -- somebody's dad on a borrowed PA, not an esports caster.
 *
 * Lines are drawn from the same event stream the director uses, with a seeded RNG so
 * a replay of a race says the same things the live call did.
 */

export interface CommentaryLine {
  t: number
  text: string
  tone: 'call' | 'colour' | 'result'
}

const nameOf = (entries: RaceEntry[], lane: number): string =>
  entries.find((e) => e.lane === lane)?.build.name ?? `Lane ${lane + 1}`

const OPENERS = [
  'Gate is set, and here we go!',
  'Pins are up... and away they go!',
  'Board is clear, cars are loaded, and we are racing!',
  'And the gate drops!',
]

const DROP_LINES = [
  'Down the ramp they come.',
  'Here comes the drop, this is where the weight tells.',
  'Into the transition, and watch who carries it best.',
  'Over the crest, and the pack sorts itself out.',
]

const LEAD_LINES = [
  '{car} takes the lead!',
  'It is {car} going to the front!',
  'A change at the front, {car} has it!',
  '{car} noses ahead!',
]

const RAIL_LINES = [
  '{car} is into the rail, and that is going to cost.',
  'Oh, {car} bounces off the guide there.',
  '{car} caught the rail, you can hear it from here.',
  'That is a rub for {car}, not what you want.',
]

const WOBBLE_LINES = [
  '{car} is wandering a little.',
  'Bit of a shimmy from {car}.',
  '{car} is not sitting square on the track.',
]

const CLOSE_LINES = [
  'This is going to be close!',
  'Nothing in it at the line!',
  'Too close to call from here!',
  'Get the judges up, this one is tight!',
]

const WIN_LINES = [
  '{car} takes it, {time}!',
  'It is {car}! {time} on the clock.',
  '{car} wins it in {time}!',
]

const UPSET_LINES = [
  'Nobody had {car} in this one!',
  'Well how about that, {car} has done it!',
  'The garage favourites are beaten, {car} spoils the party!',
]

const CORNY = [
  'Somewhere a parent is pretending they did not help with the sanding.',
  'That is a lot of graphite for one small block of pine.',
  'Reminder that the concession stand closes after heat six.',
  'Beautiful paint on that one. Slow, but beautiful.',
  'Four ounces of wood, one ounce of tungsten, all the hope in the world.',
]

export class CommentaryEngine {
  private rng: Rng
  private lines: CommentaryLine[] = []
  private lastLineAt = -Infinity
  private lastWobbleAt = -Infinity
  private usedCorny = new Set<number>()

  constructor(
    private entries: RaceEntry[],
    seed: number,
  ) {
    this.rng = new Rng(seed)
  }

  reset(): void {
    this.lines = []
    this.lastLineAt = -Infinity
    this.lastWobbleAt = -Infinity
    this.usedCorny.clear()
  }

  get all(): CommentaryLine[] {
    return this.lines
  }

  /** Latest lines first, capped for the on-screen ticker. */
  recent(limit = 4): CommentaryLine[] {
    return this.lines.slice(-limit).reverse()
  }

  private say(t: number, text: string, tone: CommentaryLine['tone'], minGap = 0.45): void {
    // An announcer who never draws breath is exhausting.
    if (t - this.lastLineAt < minGap && tone !== 'result') return
    this.lastLineAt = t
    this.lines.push({ t, text, tone })
  }

  private template(pool: string[], replacements: Record<string, string>): string {
    let text = this.rng.pick(pool)
    for (const [key, value] of Object.entries(replacements)) {
      text = text.replaceAll(`{${key}}`, value)
    }
    return text
  }

  consume(event: RaceEvent, results?: CarResult[]): void {
    switch (event.type) {
      case 'gate-release':
        this.say(event.t, this.rng.pick(OPENERS), 'call', 0)
        break
      case 'drop-enter':
        this.say(event.t, this.rng.pick(DROP_LINES), 'call', 0.8)
        break
      case 'lead-change':
        this.say(
          event.t,
          this.template(LEAD_LINES, { car: nameOf(this.entries, event.lane) }),
          'call',
          0.3,
        )
        break
      case 'rail-contact':
        if (event.severity > 0.5) {
          this.say(event.t, this.template(RAIL_LINES, { car: nameOf(this.entries, event.lane) }), 'colour', 0.7)
        } else if (event.severity > 0.25 && event.t - this.lastWobbleAt > 1.5) {
          this.lastWobbleAt = event.t
          this.say(event.t, this.template(WOBBLE_LINES, { car: nameOf(this.entries, event.lane) }), 'colour', 0.9)
        }
        break
      case 'milestone':
        if (event.milestone === 'half' && this.rng.bool(0.3)) {
          const index = this.rng.int(CORNY.length)
          if (!this.usedCorny.has(index)) {
            this.usedCorny.add(index)
            this.say(event.t, CORNY[index], 'colour', 1.2)
          }
        }
        break
      case 'car-finish':
        if (event.position === 1) {
          // A close one gets called close first. Announcing the winner and only then
          // noting it was tight reads backwards.
          const runnerUpGap = results
            ?.filter((r) => r.position === 2)
            .map((r) => r.gap)
            .find((gap) => Number.isFinite(gap))
          if (runnerUpGap !== undefined && runnerUpGap <= PHOTO_FINISH_THRESHOLD) {
            this.say(event.t - 0.001, this.rng.pick(CLOSE_LINES), 'call', 0)
          }
          this.say(
            event.t,
            this.template(WIN_LINES, {
              car: nameOf(this.entries, event.lane),
              time: `${formatBroadcastTime(event.elapsed)} seconds`,
            }),
            'result',
            0,
          )
          if (results) this.maybeUpset(event.t, event.lane, results)
        }
        break
      default:
        break
    }
  }

  /** An underdog or wildcard beating a field with a speed build is worth calling out. */
  private maybeUpset(t: number, winnerLane: number, results: CarResult[]): void {
    const winner = results.find((r) => r.lane === winnerLane)
    if (!winner) return
    const archetype = winner.build.archetype
    if (archetype !== 'underdog' && archetype !== 'wildcard') return
    const hadFavourite = results.some((r) => r.build.archetype === 'speed-demon')
    if (!hadFavourite) return
    this.say(t + 0.35, this.template(UPSET_LINES, { car: winner.build.name }), 'result', 0)
  }
}

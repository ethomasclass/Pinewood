import { describe, expect, it } from 'vitest'
import { analyzeBuild } from '../build'
import { simulateRace, sampleRecording } from '../race'
import { cloneProfile, presetById } from '../presets'
import { ballastToWeight, generateField } from '../archetypes'
import { RULES, WHEEL, inches, toOunces } from '../units'
import { DEFAULT_TRACK, STOCK_WHEELBASE, type CarBuild } from '../types'

function testCar(
  overrides: Partial<CarBuild> = {},
  ballast?: { x: number; y: number; target?: number },
): CarBuild {
  const base: CarBuild = {
    id: 'test',
    name: 'Test',
    tag: 'TST',
    profile: cloneProfile(presetById('wedge').profile),
    woodDensity: 400,
    weights: [],
    wheels: { massEach: WHEEL.stockMass, trueness: 0.9, polish: 0.8, lubrication: 0.8, raisedFrontWheel: false },
    axles: { steerDeg: 0, alignmentErrorDeg: 0.02, polish: 0.8 },
    wheelbase: { ...STOCK_WHEELBASE },
    paint: { bodyColor: '#f00', accentColor: '#fff', finish: 'gloss', stripe: 'none', number: '1' },
    ...overrides,
  }
  if (ballast) {
    base.weights = ballastToWeight(base, ballast.target ?? RULES.maxMass, { x: ballast.x, y: ballast.y })
  }
  return base
}

const soloTime = (build: CarBuild, seed = 1, variance = 0) =>
  simulateRace([{ lane: 0, build }], { seed, variance }).results[0].elapsed

describe('build analysis', () => {
  it('gives a bare regulation block a realistic mass', () => {
    const block = testCar({ profile: cloneProfile(presetById('block').profile) })
    const a = analyzeBuild(block)
    // A real BSA pine block plus wheels is a little under 4 oz before ballast.
    expect(toOunces(a.totalMass)).toBeGreaterThan(3.5)
    expect(toOunces(a.totalMass)).toBeLessThan(4.3)
  })

  it('ballasts a car to exactly the 5 oz limit', () => {
    const car = testCar({}, { x: inches(4.5), y: inches(0.3) })
    const a = analyzeBuild(car)
    expect(toOunces(a.totalMass)).toBeCloseTo(5, 3)
    expect(a.overWeight).toBe(false)
  })

  it('flags a car whose mass sits behind the rear axle', () => {
    const car = testCar({}, { x: inches(6.6), y: inches(0.3) })
    const a = analyzeBuild(car)
    expect(a.comAheadOfRearAxle).toBeLessThan(inches(0.4))
    expect(a.warnings.some((w) => w.level === 'error' || w.level === 'warn')).toBe(true)
  })
})

describe('race timing', () => {
  it('produces run times in the expected band for a 32 ft track', () => {
    const car = testCar({}, { x: inches(4), y: inches(0.3) })
    const t = soloTime(car)
    expect(t).toBeGreaterThan(2.5)
    expect(t).toBeLessThan(3.6)
  })

  it('never beats the frictionless bound', () => {
    const car = testCar({}, { x: inches(4), y: inches(0.3) })
    const t = soloTime(car)
    // Lossless lower bound for this geometry, computed from energy alone.
    expect(t).toBeGreaterThan(2.4)
  })
})

describe('what actually wins races', () => {
  it('rewards moving mass rearward', () => {
    const front = testCar({}, { x: inches(2), y: inches(0.3) })
    const rear = testCar({}, { x: inches(5.4), y: inches(0.3) })
    expect(soloTime(rear)).toBeLessThan(soloTime(front))
  })

  it('rewards a low centre of mass once the car has any misalignment', () => {
    const opts = { axles: { steerDeg: 0, alignmentErrorDeg: 0.25, polish: 0.8 } }
    const low = testCar(opts, { x: inches(4.5), y: inches(0.15) })
    const high = testCar(opts, { x: inches(4.5), y: inches(1.0) })
    const lowTimes = [1, 2, 3, 4].map((s) => soloTime(low, s, 1))
    const highTimes = [1, 2, 3, 4].map((s) => soloTime(high, s, 1))
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(lowTimes)).toBeLessThan(mean(highTimes))
    // ... and a high car is less repeatable, not just slower.
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
    expect(spread(highTimes)).toBeGreaterThan(spread(lowTimes))
  })

  it('makes axle preparation the single biggest lever', () => {
    const make = (prep: number) =>
      testCar(
        {
          axles: { steerDeg: 0, alignmentErrorDeg: 0.02, polish: prep },
          wheels: { massEach: WHEEL.stockMass, trueness: 0.9, polish: prep, lubrication: prep, raisedFrontWheel: false },
        },
        { x: inches(4.5), y: inches(0.3) },
      )
    const rough = soloTime(make(0.1))
    const polished = soloTime(make(0.95))
    const prepGain = rough - polished

    const front = soloTime(testCar({}, { x: inches(2), y: inches(0.3) }))
    const rear = soloTime(testCar({}, { x: inches(5.4), y: inches(0.3) }))
    const placementGain = front - rear

    expect(prepGain).toBeGreaterThan(0.05)
    expect(prepGain).toBeGreaterThan(placementGain)
  })

  it('rewards running at the full 5 oz limit', () => {
    const light = testCar({}, { x: inches(4.5), y: inches(0.3), target: RULES.maxMass * 0.6 })
    const heavy = testCar({}, { x: inches(4.5), y: inches(0.3) })
    expect(soloTime(heavy)).toBeLessThan(soloTime(light))
  })

  it('keeps the aerodynamic effect real but smaller than friction', () => {
    const block = testCar({ profile: cloneProfile(presetById('block').profile) }, { x: inches(4.5), y: inches(0.3) })
    const plank = testCar({ profile: cloneProfile(presetById('plank').profile) }, { x: inches(4.5), y: inches(0.3) })
    const shapeGain = soloTime(block) - soloTime(plank)
    expect(shapeGain).toBeGreaterThan(0)
    expect(shapeGain).toBeLessThan(0.09)
  })

  it('punishes a badly aligned car', () => {
    const straight = testCar({ axles: { steerDeg: 0, alignmentErrorDeg: 0.02, polish: 0.8 } }, { x: inches(4.5), y: inches(0.3) })
    const crooked = testCar({ axles: { steerDeg: 0, alignmentErrorDeg: 0.5, polish: 0.8 } }, { x: inches(4.5), y: inches(0.3) })
    expect(soloTime(crooked, 1, 1)).toBeGreaterThan(soloTime(straight, 1, 1))
  })
})

describe('determinism', () => {
  it('reproduces a race exactly from the same seed', () => {
    const builds = generateField(4, 7)
    const entries = builds.map((build, lane) => ({ lane, build }))
    const a = simulateRace(entries, { seed: 42 })
    const b = simulateRace(entries, { seed: 42 })
    expect(a.results.map((r) => r.elapsed)).toEqual(b.results.map((r) => r.elapsed))
    expect(a.events.length).toBe(b.events.length)
  })

  it('varies between seeds without changing who deserves to win', () => {
    const builds = generateField(4, 7)
    const entries = builds.map((build, lane) => ({ lane, build }))
    const a = simulateRace(entries, { seed: 42 })
    const b = simulateRace(entries, { seed: 4242 })
    expect(a.results.map((r) => r.elapsed)).not.toEqual(b.results.map((r) => r.elapsed))
    // Run-to-run variance should be small: hundredths, not tenths.
    for (let i = 0; i < a.results.length; i++) {
      expect(Math.abs(a.results[i].elapsed - b.results[i].elapsed)).toBeLessThan(0.12)
    }
  })

  it('makes zero variance perfectly repeatable', () => {
    const car = testCar({}, { x: inches(4), y: inches(0.3) })
    expect(soloTime(car, 1, 0)).toBe(soloTime(car, 999, 0))
  })
})

describe('archetypes', () => {
  it('ranks speed demons ahead of underdogs across many fields', () => {
    let demonWins = 0
    let races = 0
    for (let seed = 1; seed <= 12; seed++) {
      const builds = generateField(6, seed * 1013, ['speed-demon', 'balanced', 'wildcard', 'underdog', 'balanced', 'underdog'])
      const entries = builds.map((build, lane) => ({ lane, build }))
      const r = simulateRace(entries, { seed: seed * 31 })
      const winner = r.results.find((x) => x.position === 1)!
      races++
      if (winner.build.archetype === 'speed-demon') demonWins++
    }
    // Not rigged, but a well-built car should win the clear majority of the time.
    expect(demonWins / races).toBeGreaterThan(0.7)
  })
})

describe('the run-out', () => {
  const field = () => generateField(5, 31).map((build, lane) => ({ lane, build }))

  it('keeps cars rolling after the beam instead of freezing them on the line', () => {
    const race = simulateRace(field(), { seed: 3 })
    const winner = race.results.find((r) => r.position === 1)!
    const index = race.entries.findIndex((e) => e.lane === winner.lane)

    const atFinish = sampleRecording(race.recording, winner.elapsed)[index]
    const later = sampleRecording(race.recording, winner.elapsed + 0.25)[index]

    expect(atFinish.s).toBeGreaterThanOrEqual(DEFAULT_TRACK.length - 0.02)
    // Still travelling a quarter second after being timed, and further down the track.
    expect(later.s).toBeGreaterThan(atFinish.s + 0.2)
    expect(later.v).toBeGreaterThan(1)
  })

  it('records past the last finish so the roll-out is on tape', () => {
    const race = simulateRace(field(), { seed: 3 })
    const lastFinish = Math.max(...race.results.map((r) => r.elapsed).filter(Number.isFinite))
    expect(race.recording.duration).toBeGreaterThan(lastFinish + 0.3)
  })

  it('brings every car to rest in the catch section', () => {
    const race = simulateRace(field(), { seed: 3 })
    const final = sampleRecording(race.recording, race.recording.duration)
    for (const frame of final) {
      expect(frame.v).toBeLessThan(0.1)
      // Past the line, and stopped before the end of the run-out.
      expect(frame.s).toBeGreaterThan(DEFAULT_TRACK.length)
      expect(frame.s).toBeLessThanOrEqual(DEFAULT_TRACK.length + DEFAULT_TRACK.runoutLength + 0.01)
    }
  })

  it('does not let the braking pad affect the timed part of the race', () => {
    // The pad starts past the line, so it must not touch the recorded time at all.
    const race = simulateRace(field(), { seed: 3 })
    const slow = simulateRace(field(), {
      seed: 3,
      track: { ...DEFAULT_TRACK, brakeStart: DEFAULT_TRACK.brakeStart + 1.2 },
    })
    expect(race.results.map((r) => r.elapsed)).toEqual(slow.results.map((r) => r.elapsed))
  })
})

describe('recording', () => {
  it('records frames that reach the finish line and interpolate cleanly', () => {
    const builds = generateField(4, 11)
    const entries = builds.map((build, lane) => ({ lane, build }))
    const race = simulateRace(entries, { seed: 5 })
    expect(race.recording.frames[0].length).toBeGreaterThan(100)
    const atFinish = sampleRecording(race.recording, race.recording.duration)
    expect(Math.max(...atFinish.map((f) => f.s))).toBeGreaterThanOrEqual(DEFAULT_TRACK.length)
    const mid = sampleRecording(race.recording, 1.0)
    expect(mid.every((f) => Number.isFinite(f.s) && Number.isFinite(f.v))).toBe(true)
  })

  it('emits the event types the broadcast layer depends on', () => {
    const builds = generateField(6, 21)
    const entries = builds.map((build, lane) => ({ lane, build }))
    const race = simulateRace(entries, { seed: 9 })
    const types = new Set(race.events.map((e) => e.type))
    expect(types.has('gate-release')).toBe(true)
    expect(types.has('drop-enter')).toBe(true)
    expect(types.has('car-finish')).toBe(true)
    expect(types.has('race-finish')).toBe(true)
    expect(types.has('milestone')).toBe(true)
    // Events must be ordered for the scheduler to replay them correctly.
    for (let i = 1; i < race.events.length; i++) {
      expect(race.events[i].t).toBeGreaterThanOrEqual(race.events[i - 1].t)
    }
  })
})

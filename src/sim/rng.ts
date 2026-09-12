/**
 * Seeded, deterministic PRNG. Every source of randomness in the simulation draws
 * from one of these so that a (build, seed) pair always reproduces exactly --
 * the determinism requirement that replays, ghosts and rematches depend on.
 */

export class Rng {
  private state: number

  constructor(seed: number) {
    // Avoid the degenerate zero state.
    this.state = (seed >>> 0) || 0x9e3779b9
  }

  /** mulberry32: small, fast, and good enough for simulation jitter. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Symmetric jitter in [-amount, +amount). */
  jitter(amount: number): number {
    return this.range(-amount, amount)
  }

  /** Approximately normal, mean 0, standard deviation 1 (sum of uniforms). */
  normal(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability
  }
}

/** Derive a stable child seed so per-lane randomness never correlates between lanes. */
export const deriveSeed = (seed: number, salt: number): number => {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export const randomSeed = () => (Math.random() * 0xffffffff) >>> 0

/**
 * Stable hash of a string, used to seed a car's permanent quirks from its identity.
 * A crooked axle points the same way in every race it ever runs; only the magnitude
 * of the error wanders run to run. Seeding those two things separately is what stops
 * a rematch from feeling like a different car.
 */
export const hashString = (value: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

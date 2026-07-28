/**
 * Deterministic seeded RNG (mulberry32). Same seed -> same sequence, so any
 * pipeline using it (polish) is reproducible within JS. This does NOT match
 * Python's RNG — cross-language identity is only claimed for the deterministic
 * generators (greedy, repair), which use no randomness.
 */

/** Exclusive upper bound on a seed: mulberry32's state is a uint32. */
const SEED_MAX = 2 ** 32;

/** Whether `seed` names a distinct RNG stream rather than aliasing onto another one. */
export function isSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed < SEED_MAX;
}

/** `seed` if it is a valid seed; throws otherwise. */
export function checkSeed(seed: number): number {
  if (!isSeed(seed)) {
    throw new Error(`seed ${seed} must be an integer in [0, ${SEED_MAX})`);
  }
  return seed;
}

export class RNG {
  private state: number;

  constructor(seed: number) {
    // VALIDATED, NOT COERCED. `seed >>> 0` accepted every number and mapped a great many of
    // them onto the same stream: `0.9`, `-0`, `NaN` and `2**32` all became 0, and `s` and
    // `s + 2**32` were indistinguishable. Seed is the app's "give me a different arrangement"
    // control, so aliasing is a silent refusal of the only request the user made — and it was
    // the one numeric option in the core still coerced rather than checked, while `k`, `mind`,
    // `minDist`, `polishIters` and `priorWeight` all throw or fall back explicitly.
    this.state = checkSeed(seed);
  }

  /** Float in [0, 1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.random() * n);
  }

  /** Two distinct indices in [0, len), len >= 2. */
  twoDistinct(len: number): [number, number] {
    const a = this.int(len);
    let b = this.int(len - 1);
    if (b >= a) b += 1;
    return [a, b];
  }
}

/**
 * Deterministic seeded RNG (mulberry32): same seed, same sequence, so polish is reproducible
 * within JS. It does NOT match Python's RNG — cross-language identity is claimed only for the
 * RNG-free generators.
 */

/** Exclusive upper bound on a seed: mulberry32's state is a uint32. */
const SEED_MAX = 2 ** 32;

/** Whether `seed` names a distinct stream rather than aliasing onto another one. */
export function isSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed < SEED_MAX;
}

export function checkSeed(seed: number): number {
  if (!isSeed(seed)) {
    throw new Error(`seed ${seed} must be an integer in [0, ${SEED_MAX})`);
  }
  return seed;
}

export class RNG {
  private state: number;

  constructor(seed: number) {
    // Validated, not coerced: `seed >>> 0` maps `0.9`, `-0`, `NaN`, `2**32` and `s + 2**32` all
    // onto some other seed's stream, silently refusing the different arrangement the user asked
    // for.
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

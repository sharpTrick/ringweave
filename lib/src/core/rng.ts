/**
 * Deterministic seeded RNG (mulberry32). Same seed -> same sequence, so any
 * pipeline using it (polish) is reproducible within JS. This does NOT match
 * Python's RNG — cross-language identity is only claimed for the deterministic
 * generators (greedy, repair), which use no randomness.
 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
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

  /** Fisher–Yates shuffle in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** k distinct samples from [0, n) (small k; reservoir not needed here). */
  sample(n: number, k: number): number[] {
    const idx = Array.from({ length: n }, (_, i) => i);
    this.shuffle(idx);
    return idx.slice(0, k);
  }
}

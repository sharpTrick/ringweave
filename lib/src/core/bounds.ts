/**
 * Moore-style lower bounds on ASPL and diameter for a k-regular graph on n
 * vertices. This is the 0%-reference every result is scored against.
 * Faithful port of Python `moore_lower_bounds`, edge cases included.
 */
export interface MooreBounds {
  asplLb: number;
  diameterLb: number;
}

export function mooreLowerBounds(n: number, k: number): MooreBounds {
  if (!Number.isFinite(n) || !Number.isFinite(k) || k <= 0 || n <= 1) {
    return { asplLb: 0, diameterLb: 0 };
  }
  let remaining = n - 1;
  let total = 0;
  let shell = k;
  let dist = 1;
  let diameterLb = 0;
  while (remaining > 0) {
    const take = Math.min(shell, remaining);
    total += dist * take;
    remaining -= take;
    diameterLb = dist;
    dist += 1;
    if (k === 1) {
      shell = 0;
    } else if (k === 2) {
      shell = k;
    } else {
      shell = shell * (k - 1);
    }
    if (shell === 0) {
      total += dist * remaining;
      diameterLb = dist;
      remaining = 0;
    }
  }
  return { asplLb: total / (n - 1), diameterLb };
}

/** ASPL gap: (aspl - lower bound) / lower bound. 0 = provably optimal. */
export function asplGap(aspl: number, n: number, k: number): number {
  const { asplLb } = mooreLowerBounds(n, k);
  if (asplLb <= 0) return 0;
  return (aspl - asplLb) / asplLb;
}

/** Exact ASPL of the cycle graph C_n (used in tests). */
export function cycleAspl(n: number): number {
  if (n < 2) return 0;
  let s: number;
  if (n % 2 === 0) {
    const half = n / 2;
    let sum = 0;
    for (let i = 1; i < half; i++) sum += i;
    s = 2 * sum + half;
  } else {
    const half = (n - 1) / 2;
    let sum = 0;
    for (let i = 1; i <= half; i++) sum += i;
    s = 2 * sum;
  }
  return s / (n - 1);
}

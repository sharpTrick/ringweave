/**
 * Moore-style lower bounds on ASPL and diameter for a k-regular graph on n vertices — the
 * 0%-reference every result is scored against. Port of Python `moore_lower_bounds`, edge cases
 * included.
 */
import { MAX_ROSTER } from "./graph.js";

export interface MooreBounds {
  asplLb: number;
  diameterLb: number;
}

export function mooreLowerBounds(n: number, k: number): MooreBounds {
  // No connected graph with max degree <= 1 exists above n=2, so a Moore-tree bound for k=1
  // describes an unbuildable graph and `asplGap` returns a NEGATIVE gap.
  if (k === 1 && n > 2) return { asplLb: 0, diameterLb: 0 };
  // A non-integer k drives `shell *= k-1` (k-1 < 1) into a denormal fixed point that never
  // reaches 0 — an infinite loop. The n cap stops the k=2 O(n) branch stalling on an absurd size.
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(k) ||
    k <= 0 ||
    n <= 1 ||
    n > MAX_ROSTER
  ) {
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
    // Moore-tree branching is (k-1) per shell, but degenerates at low k: k=1 has no onward
    // neighbours, and k=2 is a cycle whose shell stays 2 rather than shrinking to 1.
    if (k === 1) {
      shell = 0;
    } else if (k === 2) {
      shell = k;
    } else {
      shell = shell * (k - 1);
    }
    // `remaining > 0` matters: with every vertex already placed, advancing `diameterLb` anyway
    // claims a LOWER BOUND above what an achievable graph reaches.
    if (shell === 0 && remaining > 0) {
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

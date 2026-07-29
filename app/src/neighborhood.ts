/**
 * Who is one step away, and who is two.
 *
 * Extracted so the graph canvas's hover highlight and the person explorer share
 * one derivation instead of each computing it. This is deduplication, not a
 * change of algorithm: the O(k²) walk over adjacency stays, deliberately.
 *
 * The tempting "improvement" is to replace it with a single `bfsDistances` pass
 * and bucket on `dist === 1` / `dist === 2`. That is a pessimisation here. Degree
 * is capped at BUDDY_MAX = 12, so this is at most 144 set operations, while
 * `bfsDistances` is O(n + m) — around 7,000 at the n = 1000 roster ceiling — and
 * the canvas runs this on every hover.
 */

export interface Neighborhood {
  /** Direct buddies. */
  first: Set<number>;
  /** Buddies of buddies, excluding the focus and anyone already a direct buddy. */
  second: Set<number>;
}

const EMPTY: Neighborhood = { first: new Set(), second: new Set() };

/**
 * BOUNDED BY DEGREE, NOT BY n — the constraint is the whole reason this function exists in the
 * app rather than in the core, and it is invisible from the signature. Both call sites feed it a
 * graph whose degree is capped at BUDDY_MAX = 12 (generation enforces it; `importGraph`'s
 * per-vertex gate refuses a file that breaks it), so the walk is at most ~144 set operations. On
 * a graph without that cap it is O(d²) with no ceiling, and the core's `bfsDistances` is the
 * right call instead. See the module docblock for why the "improvement" runs the other way here.
 */
export function neighborhood(adjacency: number[][], focus: number | null): Neighborhood {
  if (focus == null) return EMPTY;
  const first = new Set<number>();
  const second = new Set<number>();
  for (const b of adjacency[focus] ?? []) first.add(b);
  for (const b of adjacency[focus] ?? []) {
    for (const c of adjacency[b] ?? []) {
      if (c !== focus && !first.has(c)) second.add(c);
    }
  }
  return { first, second };
}

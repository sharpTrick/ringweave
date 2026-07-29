export interface Neighborhood {
  /** Direct buddies. */
  first: Set<number>;
  /** Buddies of buddies, excluding the focus and anyone already a direct buddy. */
  second: Set<number>;
}

const EMPTY: Neighborhood = { first: new Set(), second: new Set() };

/**
 * BOUNDED BY DEGREE, NOT BY n, and the signature does not show it: both call sites feed a graph
 * whose degree is capped at BUDDY_MAX. On a graph without that cap this is O(d²) with no ceiling,
 * and the core's `bfsDistances` is the right call instead.
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

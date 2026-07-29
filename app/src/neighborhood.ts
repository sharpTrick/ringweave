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

/** How many two-step people the explorer card lists before collapsing the rest into "+N more". */
const SECOND_LIMIT = 24;

export interface RelatedChips {
  first: number[];
  secondShown: number[];
  /** Two-step people past `SECOND_LIMIT`, counted for the "+N more" note. */
  secondHidden: number;
}

/**
 * Exactly the people the explorer card renders as clickable chips, in render order.
 *
 * Shared with the back-stack rule so that both answer one question — a person past the "+N more"
 * cutoff is not reachable from the card, and a rule derived from the full two-step set would treat
 * them as if they were.
 */
export function relatedChips(adjacency: number[][], focus: number | null): RelatedChips {
  const { first, second } = neighborhood(adjacency, focus);
  const ascending = (set: Set<number>) => Array.from(set).sort((a, b) => a - b);
  const all = ascending(second);
  return {
    first: ascending(first),
    secondShown: all.slice(0, SECOND_LIMIT),
    secondHidden: Math.max(0, all.length - SECOND_LIMIT),
  };
}

/** Membership test over {@link relatedChips}: is `to` one of the chips shown for `from`? */
export function isShownRelated(adjacency: number[][], from: number, to: number): boolean {
  const { first, secondShown } = relatedChips(adjacency, from);
  return first.includes(to) || secondShown.includes(to);
}

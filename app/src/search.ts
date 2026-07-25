/**
 * Fuzzy roster search (F8).
 *
 * Subsequence matching, as the mock does it: every character of the query must
 * appear in the name in order, but not necessarily adjacently — so "jsmi" finds
 * "John Smith". Matching is case-insensitive and diacritic-naive, which is what
 * the roster parser's own comparisons already assume.
 *
 * Ranking is added here; the mock has none. Result order has to be deterministic
 * like everything else in this app, and "whichever the array happened to hold
 * first" is not an order a user can learn.
 */

/** Where each query character landed in the name, or null when it doesn't match. */
export function fuzzyMatch(query: string, name: string): number[] | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  const haystack = name.toLowerCase();
  const positions: number[] = [];
  let at = 0;
  for (const ch of q) {
    const found = haystack.indexOf(ch, at);
    if (found < 0) return null;
    positions.push(found);
    at = found + 1;
  }
  return positions;
}

export interface Match {
  /** Roster index. */
  index: number;
  /** Character offsets in the name that the query matched, ascending. */
  positions: number[];
}

/**
 * How scattered a match is: 0 when the matched characters are adjacent, rising
 * as they spread out. `"smi"` against `"Smith"` scores 0; against
 * `"S… m… i…"` it scores the intervening gaps.
 */
function spread(positions: number[]): number {
  return positions[positions.length - 1] - positions[0] - (positions.length - 1);
}

/**
 * The best `limit` matches, ordered by where the match starts, then how tightly
 * it clusters, then roster position.
 *
 * Roster index is the final tie-break rather than alphabetical order, so the
 * ordering is total: two people can share a name only in case, which the roster
 * parser already de-duplicates, but a total order means the list never reshuffles
 * between renders.
 */
export function rankMatches(query: string, names: string[], limit: number): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i < names.length; i++) {
    const positions = fuzzyMatch(query, names[i]);
    if (positions !== null) matches.push({ index: i, positions });
  }
  matches.sort(
    (a, b) =>
      a.positions[0] - b.positions[0] ||
      spread(a.positions) - spread(b.positions) ||
      a.index - b.index,
  );
  return limit >= 0 ? matches.slice(0, limit) : matches;
}

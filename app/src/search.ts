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

/**
 * Match an ALREADY-normalized needle. Split from `fuzzyMatch` so `rankMatches` can
 * normalize the query once instead of once per roster name — at the 1000-person
 * ceiling the public form did |query| x 1000 characters of redundant lowercasing on
 * every keystroke.
 */
function matchNormalized(needle: string, name: string): number[] | null {
  // CODE POINTS on both sides, which is what makes `spread` mean what it says. The query was
  // already iterated by code point (`for...of`) while the offsets came from `indexOf`, i.e. UTF-16
  // code units — so `spread` subtracted a code-POINT count from a code-UNIT span and reported
  // scatter for a name that matched contiguously: `fuzzyMatch("Año😀b", "Año😀b")`, the tightest
  // match possible, scored 1 instead of 0 and was ranked below genuinely scattered matches. Same
  // unit confusion `clamp.ts`'s `codePointsIfOver` exists for; this was the last site.
  const haystack = Array.from(name.toLowerCase());
  const positions: number[] = [];
  let at = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, at);
    if (found < 0) return null;
    positions.push(found);
    at = found + 1;
  }
  return positions;
}

/** Where each query character landed in the name, or null when it doesn't match. */
export function fuzzyMatch(query: string, name: string): number[] | null {
  const needle = query.trim().toLowerCase();
  return needle === "" ? null : matchNormalized(needle, name);
}

export interface Match {
  /** Roster index. */
  index: number;
  /** Code-point offsets in the name that the query matched, ascending. */
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
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: Match[] = [];
  for (let i = 0; i < names.length; i++) {
    const positions = matchNormalized(needle, names[i]);
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

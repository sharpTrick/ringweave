/**
 * Fuzzy roster search: subsequence matching, case-insensitive and diacritic-naive, as the roster
 * parser's own comparisons already assume.
 */

/** Takes an ALREADY-normalized needle, so `rankMatches` normalizes the query once, not per name. */
function matchNormalized(needle: string, name: string): number[] | null {
  // CODE POINTS on both sides: `indexOf` on a raw string returns UTF-16 code units, and `spread`
  // would then subtract a code-point count from a code-unit span and report scatter for a name
  // that matched contiguously.
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

/** How scattered a match is: 0 when the matched characters are adjacent. */
function spread(positions: number[]): number {
  return positions[positions.length - 1] - positions[0] - (positions.length - 1);
}

/**
 * The best `limit` matches, ordered by match start, then tightness, then roster index. That last
 * tie-break makes the order TOTAL, so the list never reshuffles between renders.
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

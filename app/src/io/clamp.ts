/**
 * THE bounding helpers: one place for "this value came from somewhere untrusted, hold it to a
 * range". Text truncation was the first half and is described below; `clamp` is the numeric
 * half, and it is here for the same reason — the expression `Math.max(lo, Math.min(hi, x))`
 * had five copies under three names (`clamp` in SettingsControls, inside `sanitizeInt` and
 * again inline in `sanitizeSettings`, and twice inline in model.ts), so a correction to any one
 * of them (NaN, -0, argument order) would have to be found in the other four by memory.
 *
 * THE truncation helper. One function, because there are now four sinks that need it and
 * every one of them was found by review, individually, after the previous one was fixed.
 *
 * The sequence: the notice toast (round 2), import-error interpolation (round 2), the search
 * box's query echo (round 6), and the path status line (round 7). Each fix was correct and
 * each was written as its own ad-hoc clamp, so the fourth sink was as unprotected as the first
 * — "remember to clamp untrusted text before it reaches the DOM" is an instruction, and this
 * codebase has now demonstrated four times that instructions do not hold.
 *
 * The rule this encodes: any string whose LENGTH is influenced by user or file input and which
 * ends up in a DOM text node goes through here. Bounding at the producer keeps the message
 * readable; bounding at the sink (useNotice) as well is belt and braces, and both are cheap.
 */

/** Hold `x` to [lo, hi]. NaN in, NaN out — callers that must not pass NaN check for it first. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * `text`'s code points when there are more than `max` of them, otherwise null.
 *
 * A CHARACTER is a code point, not a UTF-16 code unit, and the difference is not cosmetic:
 * `slice`/`length` count units, so cutting or measuring an emoji-bearing name splits a surrogate
 * pair and emits a lone surrogate — an ill-formed string that is not in Cc/Cf/Zl/Zp, so every
 * downstream gate accepts it and it reaches the DOM, the CSV and the clipboard.
 *
 * `parseRoster` learned that and encoded it inline; the two other places that measure user text
 * against a character limit did not, so the app disagreed with itself in two directions at once:
 * `clampText` cut mid-pair, and `importGraph` refused, on UTF-16 length, files this app had just
 * exported. This is that predicate, once, so the three cannot drift again.
 *
 * The `text.length > max` guard is the fast path and it is exact, not an approximation: UTF-16
 * length is always >= code-point count, so anything that fits in units fits in points.
 */
export function codePointsIfOver(text: string, max: number): string[] | null {
  if (text.length <= max) return null;
  // BOUNDED at max+1, not `Array.from(text)`. Callers only ever need to know "is it over" and,
  // if so, the first `max` points — and the inputs here are a whole file's worth: materializing
  // every code point of a 9 MB value cost 161 ms and 170 MB to then keep 300 characters of it.
  // One extra point is exactly enough to answer "over" without reading the rest.
  const points: string[] = [];
  for (const ch of text) {
    points.push(ch);
    if (points.length > max) return points;
  }
  return null;
}

/**
 * `text` cut to at most `max` CODE POINTS, unchanged when it already fits.
 *
 * The bulk cap, as opposed to `clampText`'s display cap: no ellipsis, because this trims input
 * before it is parsed rather than text on its way to a DOM node. The two bulk `MAX_PARSE_CHARS`
 * cuts (the parser's and the roster editor's) were still slicing by code UNIT, so a file whose
 * 500,000th unit is the high half of a surrogate pair produced an ill-formed name — and an
 * unpaired surrogate is not in Cc/Cf/Zl/Zp, so every gate downstream accepted it. That is the
 * same defect the per-NAME limit was fixed for one round earlier, still live two levels up.
 */
export function clampToPoints(text: string, max: number): string {
  const points = codePointsIfOver(text, max);
  return points ? points.slice(0, max).join("") : text;
}

/** Ellipsis-truncate to `max` characters. Returns the input untouched when it already fits. */
export function clampText(text: string, max: number): string {
  const points = codePointsIfOver(text, max);
  return points ? `${points.slice(0, max).join("")}…` : text;
}

/**
 * Join a list for display, naming at most `limit` items and counting the rest.
 *
 * The other half of the same problem: three separate sinks have enumerated an unbounded LIST
 * (de-duplicated names, route members, buddy labels), and a list of bounded strings is still
 * unbounded. `PersonPanel`'s chip cap and `parseRoster`'s warning arrived at this shape
 * independently; this is that shape, once.
 */
export function clampList(items: readonly string[], limit: number, separator = ", "): string {
  if (items.length <= limit) return items.join(separator);
  const rest = items.length - limit;
  return `${items.slice(0, limit).join(separator)}, and ${rest} more`;
}

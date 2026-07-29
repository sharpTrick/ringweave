/**
 * THE bounding helpers for untrusted values — one copy each, so a correction to any of them
 * cannot be left behind in a hand-rolled duplicate.
 *
 * The rule they encode: any string whose LENGTH is influenced by user or file input and which
 * ends up in a DOM text node goes through here.
 */

/** Hold `x` to [lo, hi]. NaN in, NaN out — callers that must not pass NaN check for it first. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * `text`'s code points when there are more than `max` of them, otherwise null.
 *
 * THE character-limit predicate for the whole app, because a CHARACTER is a code point, not a
 * UTF-16 code unit: `slice`/`length` count units, so cutting or measuring an emoji-bearing name
 * splits a surrogate pair and emits a lone surrogate, which is not in Cc/Cf/Zl/Zp and so passes
 * every downstream gate into the DOM, the CSV and the clipboard.
 *
 * The `text.length > max` fast path is exact, not an approximation: UTF-16 length is always
 * >= code-point count, so anything that fits in units fits in points.
 */
export function codePointsIfOver(text: string, max: number): string[] | null {
  if (text.length <= max) return null;
  // BOUNDED at max+1, not `Array.from(text)`: the inputs here are a whole file's worth, and one
  // extra point is enough to answer "over" without materializing the rest.
  const points: string[] = [];
  for (const ch of text) {
    points.push(ch);
    if (points.length > max) return points;
  }
  return null;
}

/** `text` cut to at most `max` CODE POINTS, unchanged when it already fits. The bulk cap, as
    opposed to `clampText`'s display cap: no ellipsis, because this trims input before it is
    parsed rather than text on its way to a DOM node. */
export function clampToPoints(text: string, max: number): string {
  const points = codePointsIfOver(text, max);
  return points ? points.slice(0, max).join("") : text;
}

/** Ellipsis-truncate to `max` characters. Returns the input untouched when it already fits. */
export function clampText(text: string, max: number): string {
  const points = codePointsIfOver(text, max);
  return points ? `${points.slice(0, max).join("")}…` : text;
}

/** Join a list for display, naming at most `limit` items and counting the rest — a list of
    bounded strings is still unbounded, so display sinks need this as well as `clampText`. */
export function clampList(items: readonly string[], limit: number, separator = ", "): string {
  if (items.length <= limit) return items.join(separator);
  const rest = items.length - limit;
  return `${items.slice(0, limit).join(separator)}, and ${rest} more`;
}

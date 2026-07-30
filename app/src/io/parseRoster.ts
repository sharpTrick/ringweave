import { MAX_ROSTER_N } from "../model";
import { clampList, clampToPoints, codePointsIfOver } from "./clamp";

export interface ParsedRoster {
  names: string[];
  warnings: string[];
}

// A multi-MB paste bypasses the file-size gate, and this parse re-runs on every keystroke, so
// both totals are bounded here. The char cap covers the degenerate all-duplicates input, where
// the name cap is never reached.
export const MAX_PARSE_CHARS = 500_000;
export const MAX_NAMES = MAX_ROSTER_N;
/** Longest a single name may be. The other two caps bound only totals, so without this one name
    can be half a megabyte and is then the buddy label of every other person — rendered once each
    by the on-screen list, the printed slips and the CSV export. */
export const MAX_NAME_CHARS = 120;

/** How many de-duplicated names a warning names before it says "and N more". */
const WARNING_NAME_LIMIT = 10;

const TOKEN = /[^\n,]+/g;
/**
 * THE character class both name authorities use — one copy, imported by `importGraph`, so the
 * two cannot drift. `parseRoster` normalizes these to spaces; `importGraph` refuses them.
 *
 * Not just C0+DEL: Zl/Zp (U+2028, U+2029) are ECMAScript LineTerminators and forced CSS line
 * breaks, so they break a name across lines in the buddy list and the printed slips, and none of
 * these are delimiters here, so they survive into a pasted spreadsheet cell as an injection
 * vector. `\p{Cs}` matches UNPAIRED surrogates only under `u` (emoji pass untouched); a lone
 * surrogate survives JSON but becomes U+FFFD when a Blob encodes UTF-8, so the exported CSV and
 * JSON would disagree about the same name.
 */
export const NAME_HOSTILE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;
const CONTROL_CHARS = NAME_HOSTILE_CHARS;

/** THE character-truncation notice — shared so the parser's warning and RosterModal's can't
    drift in wording. */
export function charCapNotice(): string {
  return `That's a lot of text — only the first ${MAX_PARSE_CHARS.toLocaleString()} characters were kept.`;
}

/**
 * Tolerant roster parse: split on newlines and commas, trim, drop blank tokens. Anything the
 * parser changes (truncation, de-duplication) is reported in `warnings`, never applied silently.
 */
export function parseRoster(raw: string): ParsedRoster {
  const warnings: string[] = [];

  // By CODE POINT, like every other cut in this file: `slice` would split a surrogate pair
  // straddling the cap and emit an ill-formed name that nothing downstream rejects.
  const text = clampToPoints(raw, MAX_PARSE_CHARS);
  if (text !== raw) warnings.push(charCapNotice());

  const keptByKey = new Map<string, string>(); // case-insensitive key -> first-kept display name
  const names: string[] = [];
  const extras = new Map<string, number>(); // key -> how many extra copies dropped
  let capped = false;
  let longNames = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    // Neutralize control chars to spaces BEFORE trimming, so a name that is nothing but them
    // becomes blank and is dropped rather than kept as whitespace.
    const raw = match[0].replace(CONTROL_CHARS, " ").trim();
    if (!raw) continue; // blank tokens are never "lost", so they never trip the cap warning
    // By CODE POINT, not code unit. Trim AGAIN after truncating: slicing can leave a trailing
    // space, and a name ending in whitespace is one this parser won't reproduce on a second pass
    // and `importGraph` refuses outright.
    const points = codePointsIfOver(raw, MAX_NAME_CHARS);
    const token = points ? points.slice(0, MAX_NAME_CHARS).join("").trim() : raw;
    // Keyed on the EMITTED name, not the pre-truncation one: `importGraph` requires every emitted
    // name to be unique case-insensitively, so keying on `raw` emits two rows its own consumer
    // then rejects.
    const key = token.toLowerCase();
    if (keptByKey.has(key)) {
      // Counted only while names are still being kept: a duplicate seen after the cap dropped
      // nothing. Keyed on the case-insensitive KEY so Alice/alice count as one person's copies.
      if (names.length < MAX_NAMES) extras.set(key, (extras.get(key) ?? 0) + 1);
      continue;
    }
    // Flagged here, at the first distinct name the cap actually loses, so the warning doesn't
    // fire for an overflow of blanks or duplicates.
    if (names.length >= MAX_NAMES) {
      capped = true;
      break;
    }
    keptByKey.set(key, token);
    names.push(token);
    // Counted only for a name actually KEPT: counting earlier charges duplicate copies and names
    // the cap then drops, so the warning claims more shortened names than the roster contains.
    if (token !== raw) longNames++;
  }

  if (capped) {
    warnings.push(`Kept the first ${MAX_NAMES.toLocaleString()} names — that's the maximum.`);
  }
  if (longNames > 0) {
    warnings.push(
      `Shortened ${longNames} very long ${longNames === 1 ? "name" : "names"} to ` +
        `${MAX_NAME_CHARS} characters.`,
    );
  }
  if (extras.size > 0) {
    const dropped = [...extras.values()].reduce((a, b) => a + b, 0);
    // Capped: `extras` is bounded only by MAX_NAMES-1 and each name by MAX_NAME_CHARS, so naming
    // them all makes a six-figure warning string that RosterModal renders as one DOM text node.
    const list = clampList([...extras.keys()].map((k) => keptByKey.get(k)!), WARNING_NAME_LIMIT);
    warnings.push(
      `Removed ${dropped} duplicate ${dropped === 1 ? "entry" : "entries"} (${list}). Each person appears once.`,
    );
  }
  return { names, warnings };
}

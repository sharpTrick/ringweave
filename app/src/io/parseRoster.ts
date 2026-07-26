import { MAX_ROSTER_N } from "../model";

export interface ParsedRoster {
  names: string[];
  warnings: string[];
}

// Bounds so a multi-MB paste (which bypasses the file-size gate) can't freeze the
// synchronous parse that re-runs on every keystroke. MAX_NAMES matches the app's
// generation ceiling; the scan STOPS once that many distinct names are found, so the
// common case is O(kept names). The char cap bounds the degenerate all-duplicates case
// (where the name cap is never reached).
export const MAX_PARSE_CHARS = 500_000;
export const MAX_NAMES = MAX_ROSTER_N;
/**
 * Longest a single name may be.
 *
 * The two existing caps bound only TOTALS — all the text, and how many names — so the
 * product (one name's length) x (how many places it is rendered) was unbounded. One
 * 480,000-character name inside a half-megabyte file is the buddy label of every other
 * person, and `buddyLabel` is called once per person by the on-screen list, the printed
 * slips and the CSV export: 480 MB of DOM text from a file that passes every gate.
 *
 * 120 is far past any real name (the longest verified human name on record is ~747
 * characters, and that is a curiosity rather than a roster entry) and still bounds the
 * worst case to MAX_NAMES x (BUDDY_MAX + 1) x MAX_NAME_CHARS, which is a few megabytes.
 */
export const MAX_NAME_CHARS = 120;

const TOKEN = /[^\n,]+/g;
// Unicode control (Cc) and format (Cf) characters. They are not line/comma delimiters here,
// so they'd otherwise survive inside a name and later act as a cell/row delimiter when the
// roster is pasted into a spreadsheet (a formula-injection vector) — normalized to spaces
// below. Categories rather than a hand-written C0+DEL range: that range missed the whole C1
// block and every format character, including the bidi overrides that can visually reverse a
// name. `importGraph` refuses the same set; this side, being the tolerant one, normalizes.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

/** THE character-truncation notice — shared so the parser's own warning and the RosterModal UI
    can't drift in wording. (In the app, RosterModal pre-caps to MAX_PARSE_CHARS and shows this
    itself; parseRoster's warning below is the same notice for DIRECT API callers.) */
export function charCapNotice(): string {
  return `That's a lot of text — only the first ${MAX_PARSE_CHARS.toLocaleString()} characters were kept.`;
}

/**
 * Tolerant roster parse: split on newlines and commas, trim, drop blank tokens.
 * Duplicates (case-insensitive) are kept once (first occurrence wins) and FLAGGED in
 * `warnings` — never silently dropped (F1 acceptance: "duplicates flagged not dropped").
 * Pathologically large input is truncated (with `charCapNotice()`) rather than parsed unbounded.
 * NOTE: the app UI pre-caps upstream (RosterModal), so this char-cap branch is reached only by
 * DIRECT callers; the roster editor shows its own (identical) notice.
 */
export function parseRoster(raw: string): ParsedRoster {
  const warnings: string[] = [];

  let text = raw;
  if (text.length > MAX_PARSE_CHARS) {
    text = text.slice(0, MAX_PARSE_CHARS);
    warnings.push(charCapNotice());
  }

  const keptByKey = new Map<string, string>(); // case-insensitive key -> first-kept display name
  const names: string[] = [];
  const extras = new Map<string, number>(); // key -> how many extra copies dropped
  let capped = false;
  let longNames = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    // Neutralize embedded control chars to spaces (the roster editor is tolerant, so we
    // normalize rather than reject; import refuses them outright) before trimming.
    const raw = match[0].replace(CONTROL_CHARS, " ").trim();
    if (!raw) continue; // blank tokens are never "lost", so they never trip the cap warning
    // Truncate rather than drop, matching this parser's tolerant contract — and warn, so
    // the change is never silent. Import REFUSES an over-long name instead; the two
    // authorities differ deliberately, and the round-trip check in importGraph is what
    // keeps them from disagreeing about any name that gets through.
    const token = raw.length > MAX_NAME_CHARS ? raw.slice(0, MAX_NAME_CHARS) : raw;
    if (token !== raw) longNames++;
    const key = token.toLowerCase();
    if (keptByKey.has(key)) {
      // A duplicate isn't lost either. Count it toward the de-dupe warning only while we're
      // still keeping names; a duplicate seen AFTER the cap is simply ignored (nothing dropped).
      // Keyed on the case-insensitive KEY so mixed-casing copies of one person (Alice/alice/ALICE)
      // count as extra copies of that ONE person, not as distinct duplicated names.
      if (names.length < MAX_NAMES) extras.set(key, (extras.get(key) ?? 0) + 1);
      continue;
    }
    // A genuinely-new name. If we're already full, THIS is the first real name the cap drops —
    // flag truncation and stop (so the warning only fires when a distinct name is actually lost,
    // not when the overflow was blanks/duplicates), keeping work proportional to kept names.
    if (names.length >= MAX_NAMES) {
      capped = true;
      break;
    }
    keptByKey.set(key, token);
    names.push(token);
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
    // List each de-duplicated person once, by the casing we KEPT (first occurrence).
    const list = [...extras.keys()].map((k) => keptByKey.get(k)!).join(", ");
    warnings.push(
      `Removed ${dropped} duplicate ${dropped === 1 ? "entry" : "entries"} (${list}). Each person appears once.`,
    );
  }
  return { names, warnings };
}

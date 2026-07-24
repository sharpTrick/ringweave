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

const TOKEN = /[^\n,]+/g;
// C0 control chars (incl. tab and CR) and DEL. They are not line/comma delimiters here, so
// they'd otherwise survive inside a name and later act as a cell/row delimiter when the roster
// is pasted into a spreadsheet (a formula-injection vector) — normalized to spaces below.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Tolerant roster parse: split on newlines and commas, trim, drop blank tokens.
 * Duplicates (case-insensitive) are kept once (first occurrence wins) and FLAGGED in
 * `warnings` — never silently dropped (F1 acceptance: "duplicates flagged not dropped").
 * Pathologically large input is truncated (with a warning) rather than parsed unbounded.
 */
export function parseRoster(raw: string): ParsedRoster {
  const warnings: string[] = [];

  let text = raw;
  if (text.length > MAX_PARSE_CHARS) {
    text = text.slice(0, MAX_PARSE_CHARS);
    warnings.push(`That's a lot of text — only the first ${MAX_PARSE_CHARS.toLocaleString()} characters were read.`);
  }

  const keptByKey = new Map<string, string>(); // case-insensitive key -> first-kept display name
  const names: string[] = [];
  const extras = new Map<string, number>(); // key -> how many extra copies dropped
  let capped = false;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    // Neutralize embedded control chars to spaces (the roster editor is tolerant, so we
    // normalize rather than reject; import refuses them outright) before trimming.
    const token = match[0].replace(CONTROL_CHARS, " ").trim();
    if (!token) continue; // blank tokens are never "lost", so they never trip the cap warning
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

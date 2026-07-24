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

  const seen = new Set<string>();
  const names: string[] = [];
  const extras = new Map<string, number>(); // display name -> how many extra copies dropped
  let capped = false;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    if (names.length >= MAX_NAMES) {
      capped = true;
      break; // stop scanning — work stays proportional to kept names, not pasted chars
    }
    const token = match[0].trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) {
      extras.set(token, (extras.get(token) ?? 0) + 1);
      continue;
    }
    seen.add(key);
    names.push(token);
  }

  if (capped) {
    warnings.push(`Kept the first ${MAX_NAMES.toLocaleString()} names — that's the maximum.`);
  }
  if (extras.size > 0) {
    const dropped = [...extras.values()].reduce((a, b) => a + b, 0);
    const list = [...extras.keys()].join(", ");
    warnings.push(
      `Removed ${dropped} duplicate ${dropped === 1 ? "entry" : "entries"} (${list}). Each person appears once.`,
    );
  }
  return { names, warnings };
}

export interface ParsedRoster {
  names: string[];
  warnings: string[];
}

/**
 * Tolerant roster parse: split on newlines and commas, trim, drop blank tokens.
 * Duplicates (case-insensitive) are kept once (first occurrence wins) and FLAGGED in
 * `warnings` — never silently dropped (F1 acceptance: "duplicates flagged not dropped").
 */
export function parseRoster(raw: string): ParsedRoster {
  const tokens = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const names: string[] = [];
  const extras = new Map<string, number>(); // display name -> how many extra copies dropped

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) {
      extras.set(token, (extras.get(token) ?? 0) + 1);
      continue;
    }
    seen.add(key);
    names.push(token);
  }

  const warnings: string[] = [];
  if (extras.size > 0) {
    const dropped = [...extras.values()].reduce((a, b) => a + b, 0);
    const list = [...extras.keys()].join(", ");
    warnings.push(
      `Removed ${dropped} duplicate ${dropped === 1 ? "entry" : "entries"} (${list}). Each person appears once.`,
    );
  }
  return { names, warnings };
}

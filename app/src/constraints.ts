/**
 * The app's editable constraint model (F7).
 *
 * The core's `Constraints` class is deliberately not used as the UI's model: it
 * has no removal API, no per-person enumeration, and private `#` Set fields — so
 * it is not structured-clone-safe and cannot be posted to the worker. The app
 * keeps a flat, plain-data list instead and the worker rebuilds a `Constraints`
 * on the other side. Nothing here reimplements constraint *semantics*; that all
 * still lives in the core.
 */

import { Constraints } from "ringweave";

export type ConstraintKind = "required" | "prohibited";

function assertNever(x: never): never {
  throw new Error(`Unhandled constraint kind: ${String(x)}`);
}

/** One editable rule. `a`/`b` are roster indices; order within a pair is not significant. */
export interface ConstraintPair {
  a: number;
  b: number;
  kind: ConstraintKind;
}

/**
 * Cap on stored pairs. Constraint checking is O(pairs) per generation and the
 * editor renders one row each, but the real reason is the import surface: pairs
 * arrive from an untrusted file and feed `validate`, whose prohibited-pair
 * connectivity walk is O(n²). Bounding the count before any of that runs keeps a
 * hostile file cheap to refuse.
 */
export const MAX_CONSTRAINT_PAIRS = 200;

/** Canonical key for a pair, so (a,b) and (b,a) of the same kind are one rule. */
export function pairKey(p: ConstraintPair): string {
  const [lo, hi] = p.a <= p.b ? [p.a, p.b] : [p.b, p.a];
  return `${p.kind}:${lo},${hi}`;
}

/** Drop duplicate rules, keeping first occurrence. */
function dedupePairs(pairs: ConstraintPair[]): ConstraintPair[] {
  const seen = new Set<string>();
  const out: ConstraintPair[] = [];
  for (const p of pairs) {
    const key = pairKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Split into the two index-pair lists the worker protocol and file format carry. */
export function splitPairs(pairs: ConstraintPair[]): {
  required: [number, number][];
  prohibited: [number, number][];
} {
  const required: [number, number][] = [];
  const prohibited: [number, number][] = [];
  for (const p of pairs) {
    switch (p.kind) {
      case "required":
        required.push([p.a, p.b]);
        break;
      case "prohibited":
        prohibited.push([p.a, p.b]);
        break;
      default:
        // Exhaustive over ConstraintKind: a new kind fails to COMPILE here rather
        // than silently landing in the `prohibited` list, which a ternary would do.
        return assertNever(p.kind);
    }
  }
  return { required, prohibited };
}

/**
 * The ONE way the app turns its editable rules into a core `Constraints`.
 *
 * It was built in two places — the editor's pre-flight feasibility check and the
 * worker's authoritative one — in two different orders: the editor followed the user's
 * edit order, the worker did all requireds then all prohibiteds. Order happens not to
 * matter today (both sets are `Set`-backed), which is exactly what made the duplication
 * comfortable: the two could disagree the moment it did, and the failure would be the
 * editor calling a rule set feasible that the worker then refuses — a silent
 * disagreement between the message a user reads and the answer they get.
 *
 * Normalizes to required-then-prohibited so the order is stated once rather than
 * inherited from whoever calls it.
 */
export function toConstraints(n: number, pairs: ConstraintPair[]): Constraints {
  const { required, prohibited } = splitPairs(pairs);
  const cons = new Constraints(n);
  for (const [a, b] of required) cons.require(a, b);
  for (const [a, b] of prohibited) cons.prohibit(a, b);
  return cons;
}

/** Rejoin the two lists into the editable model. */
export function joinPairs(
  required: [number, number][],
  prohibited: [number, number][],
): ConstraintPair[] {
  return [
    ...required.map(([a, b]): ConstraintPair => ({ a, b, kind: "required" })),
    ...prohibited.map(([a, b]): ConstraintPair => ({ a, b, kind: "prohibited" })),
  ];
}

/**
 * Roster lookup keyed the way `parseRoster` de-duplicates: case-insensitively.
 *
 * EXPORTED because building it is O(roster) and the editor needs it once per
 * render, not twice per rule row. At the 1000-person ceiling with the 200-rule cap
 * the per-row form built 400 thousand-entry Maps per render.
 */
export function indexByName(names: string[]): Map<string, number> {
  const map = new Map<string, number>();
  names.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, i);
  });
  return map;
}

/**
 * A rule as the editor holds it: by NAME, not by roster position.
 *
 * This is the whole defence against the highest-severity hazard in the feature.
 * Pairs are stored as positional indices everywhere else — in the view, the file
 * format and the worker protocol — and the roster is editable: "Edit people"
 * reopens the roster modal seeded with the current names. Delete one person and
 * every stored `{a, b}` silently re-points at *different humans*, which is exactly
 * the silent partial F7's acceptance criteria forbid.
 *
 * Rather than detect that afterwards, the editor never holds an index at all. It
 * converts in on open and out on generate, against the roster in force at each
 * moment, so there is no window in which an index and a name disagree.
 */
export interface NamedPair {
  a: string;
  b: string;
  kind: ConstraintKind;
}

/**
 * Index pairs → name pairs, for editing. A pair referencing a position the roster
 * no longer has is dropped; it names nobody, so there is nothing to show.
 *
 * ONE CALLER, and the constraint is load-bearing rather than incidental: `applyImported`, where
 * the file carries only index pairs and there are no typed rows to lose. Anywhere else it is
 * LOSSY in the direction the editor promises never to be — index pairs are what SURVIVED
 * resolution, so rebuilding rows from them deletes exactly the rows RosterModal contracts to
 * keep and flag: a row naming somebody not in the roster, a half-typed row, a duplicate. The
 * reroll path did that for three rounds and the deletion was silent. If a second caller ever
 * appears, check first whether it has typed rows already — if it does, it does not need this.
 */
export function toNamedPairs(pairs: ConstraintPair[], names: string[]): NamedPair[] {
  const out: NamedPair[] = [];
  for (const p of pairs) {
    const a = names[p.a];
    const b = names[p.b];
    if (typeof a !== "string" || typeof b !== "string") continue;
    out.push({ a, b, kind: p.kind });
  }
  return out;
}

/**
 * Name pairs → index pairs, against the roster they will be generated with.
 *
 * Returns the resolved pairs plus counts of every resolution failure BY CAUSE
 * (`unmatched`, `selfPair`, `duplicate`, `incomplete`) and the `dropped` total, so the caller can
 * name each one separately rather than reporting a single number. A rule silently
 * disappearing because its person was removed is the failure this is here to
 * prevent, and losing it quietly would be barely better than mis-pointing it.
 * Matching is case-insensitive, which is safe on both entry paths and both were
 * checked — `parseRoster` de-duplicates case-insensitively (keeping
 * first-occurrence casing), and `importGraph` hard-refuses any file whose names
 * are not non-empty, unique case-insensitively, and free of commas or line breaks.
 */
export function resolveNamedPairs(
  named: NamedPair[],
  names: string[],
): {
  pairs: ConstraintPair[];
  unmatched: number;
  duplicate: number;
  selfPair: number;
  incomplete: number;
  dropped: number;
} {
  const lookup = indexByName(names);
  const resolved: ConstraintPair[] = [];
  let unmatched = 0;
  let selfPair = 0;
  let incomplete = 0;
  for (const p of named) {
    // A half-filled row is NOT a resolution failure. Looking `""` up like any other name
    // counted a row the user has not finished typing under `unmatched`, so the modal announced
    // that a rule "names someone who isn't in this roster" the moment a row was added — while
    // ConstraintsEditor's own `unknownName` deliberately exempts empty text and leaves the row
    // unflagged. Two views of one row, disagreeing, and the wrong one was the one that spoke.
    if (p.a.trim() === "" || p.b.trim() === "") {
      incomplete++;
      continue;
    }
    const a = lookup.get(p.a.trim().toLowerCase());
    const b = lookup.get(p.b.trim().toLowerCase());
    if (a === undefined || b === undefined) {
      unmatched++;
      continue;
    }
    if (a === b) {
      selfPair++;
      continue;
    }
    resolved.push({ a, b, kind: p.kind });
  }
  const pairs = dedupePairs(resolved);
  // Counted by CAUSE, not as one total. A single "doesn't match anyone" message
  // covering a duplicate restatement or a self-pairing tells the user to look for a
  // missing person who is not missing, which is worse than saying nothing.
  return {
    pairs,
    unmatched,
    duplicate: resolved.length - pairs.length,
    selfPair,
    incomplete,
    // Rows that produced no pair for ANY reason, including ones still being filled in — so a
    // caller reporting a single number does not have to know the taxonomy.
    dropped: named.length - pairs.length,
  };
}

/**
 * Resolve typed text to a roster index, or -1 when it names nobody.
 *
 * Exact (case- and whitespace-insensitive) match only. The editor pairs this with
 * a shared `<datalist>` rather than per-row `<select>` elements: at the roster
 * ceiling two selects per row across the pair cap would mount hundreds of
 * thousands of option nodes, while one datalist is mounted once.
 */
export function resolvePerson(text: string, names: string[]): number {
  const needle = text.trim().toLowerCase();
  if (needle === "") return -1;
  const found = indexByName(names).get(needle);
  return found === undefined ? -1 : found;
}

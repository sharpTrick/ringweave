/**
 * The app's editable constraint model (F7).
 *
 * The core's `Constraints` class is deliberately not the UI's model: private `#` Set fields make
 * it non-structured-clone-safe, so it cannot be posted to the worker. The app keeps a flat,
 * plain-data list and the worker rebuilds a `Constraints` on the other side. Nothing here
 * reimplements constraint *semantics*.
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

/** Cap on stored pairs, enforced before `validate` runs: pairs arrive from an untrusted file and
    feed a prohibited-pair connectivity walk that is O(n²). */
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
 * The ONE way the app turns its editable rules into a core `Constraints`, shared by the editor's
 * pre-flight feasibility check and the worker's authoritative one. A second copy can diverge the
 * moment insertion order starts to matter, and the failure is silent: the editor calls a rule set
 * feasible that the worker then refuses.
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

/** Roster lookup keyed the way `parseRoster` de-duplicates: case-insensitively. EXPORTED because
    building it is O(roster) and the editor must build it once per render, not once per rule row. */
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
 * Pairs are positional indices everywhere else — view, file format, worker protocol — and the
 * roster is editable, so deleting one person re-points every stored `{a, b}` at *different
 * humans*. The editor therefore never holds an index: it converts in on open and out on
 * generate, against the roster in force at each moment.
 */
export interface NamedPair {
  a: string;
  b: string;
  kind: ConstraintKind;
}

/**
 * Index pairs → name pairs, for editing. A pair referencing a position the roster no longer has
 * is dropped; it names nobody.
 *
 * ONE CALLER, `applyImported`, where the file carries only index pairs and there are no typed
 * rows to lose. Anywhere else this is LOSSY in the direction the editor promises never to be:
 * index pairs are what SURVIVED resolution, so rebuilding rows from them deletes exactly the
 * rows RosterModal contracts to keep and flag. A second caller that already has typed rows does
 * not need this.
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
 * Failures are counted BY CAUSE, not as one total: a single "doesn't match anyone" message
 * covering a duplicate or a self-pairing sends the user looking for a missing person who is not
 * missing. Matching is case-insensitive, which is safe on both entry paths — `parseRoster`
 * de-duplicates case-insensitively and `importGraph` refuses any file whose names are not unique
 * case-insensitively.
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
    // A half-filled row is NOT a resolution failure. Looking `""` up like any other name counts
    // a row still being typed as `unmatched`, and the modal then says a rule "names someone who
    // isn't in this roster" the moment a row is added — while ConstraintsEditor's own
    // `unknownName` exempts empty text and leaves the row unflagged.
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
 * Exact (case- and whitespace-insensitive) match only. The editor pairs this with one shared
 * `<datalist>` rather than per-row `<select>` elements, which at the roster and pair ceilings
 * would mount hundreds of thousands of option nodes.
 */
export function resolvePerson(text: string, names: string[]): number {
  const needle = text.trim().toLowerCase();
  if (needle === "") return -1;
  const found = indexByName(names).get(needle);
  return found === undefined ? -1 : found;
}

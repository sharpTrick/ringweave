import { Graph, allPairsSummary, girth, largestComponentFraction } from "ringweave";
import {
  assembleMetrics, degreeExtent,
  BUDDY_MAX, BUDDY_MIN, DEFAULT_SEED, MAX_ROSTER_N, SEED_MAX, SEPARATION_DEFAULT, SEPARATION_MAX, SEPARATION_MIN,
  type GraphView, type Settings,
} from "../model";
import { MAX_NAME_CHARS, MAX_PARSE_CHARS, NAME_HOSTILE_CHARS, parseRoster } from "./parseRoster";
import {
  MAX_CONSTRAINT_PAIRS, joinPairs, pairKey, toNamedPairs,
  type ConstraintPair,
} from "../constraints";
import { clamp, clampText, codePointsIfOver } from "./clamp";
import type { BuddyGraphFile } from "./schema";

/** Thrown with a plain-language reason when a file can't be imported. */
export class ImportError extends Error {}

// A fresh RegExp: the shared class carries `g`, and `test` on a global regex advances lastIndex
// between calls, so every other name in a roster would be skipped.
const CONTROL_CHARS_TEST = new RegExp(NAME_HOSTILE_CHARS.source, "u");

/** Node cap for import. The core's metrics are uncapped and re-measured synchronously on the
    main thread, so this must not exceed the generation ceiling; density is capped separately
    in `importGraph` because layout and render scale with edges, not nodes. */
export const MAX_IMPORT_N = MAX_ROSTER_N;

function sanitizeInt(value: unknown, lo: number, hi: number, fallback: number): number {
  return Number.isInteger(value) ? clamp(value as number, lo, hi) : fallback;
}

/** Clamp the settings block to the UI range. `buddies`/`minSeparation` are unused by import
    (it rehydrates edges and never generates) but are STORED and handed to the core by any later
    reroll, so an unbounded file value would drive generation out of range then. */
function sanitizeSettings(s: BuddyGraphFile["settings"] | undefined, fallbackBuddies: number): Settings {
  const declared = s && Number.isInteger(s.buddies) && s.buddies >= BUDDY_MIN ? s.buddies : fallbackBuddies;
  return {
    buddies: clamp(declared, BUDDY_MIN, BUDDY_MAX),
    minSeparation: s && s.minSeparation !== undefined ? sanitizeInt(s.minSeparation, SEPARATION_MIN, SEPARATION_MAX, SEPARATION_DEFAULT) : undefined,
    seed: sanitizeInt(s?.seed, 0, SEED_MAX, DEFAULT_SEED),
    polish: s && (s.polish === true || s.polish === false || s.polish === "auto") ? s.polish : "auto",
  };
}

/**
 * Validate and rehydrate the constraint block.
 *
 * Refuses rather than skipping bad pairs, so a user is never handed back a different rule set
 * than they saved. A pair that is both required and prohibited is refused here rather than at the
 * next generation, so a graph that renders but can never be regenerated is caught on the way in.
 */
function readConstraints(
  block: BuddyGraphFile["constraints"] | undefined,
  n: number,
): ConstraintPair[] {
  if (block === undefined) return [];
  // `Array.isArray` as well: an array passes the object guard, so `"constraints": [...]` would
  // read as no rules at all and import with them SILENTLY DROPPED instead of refused.
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new ImportError("That file's buddy rules aren't in the expected shape.");
  }
  const read = (value: unknown, label: string): [number, number][] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new ImportError(`That file's ${label} buddy rules aren't a list.`);
    }
    return value.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new ImportError(`A ${label} buddy rule isn't a [a, b] pair.`);
      }
      const [a, b] = pair as [unknown, unknown];
      if (!Number.isInteger(a) || !Number.isInteger(b) ||
          (a as number) < 0 || (b as number) < 0 ||
          (a as number) >= n || (b as number) >= n) {
        throw new ImportError(`A ${label} buddy rule refers to someone outside 0..${n - 1}.`);
      }
      if (a === b) {
        throw new ImportError("A buddy rule pairs someone with themselves.");
      }
      return [a as number, b as number];
    });
  };

  const pairs = joinPairs(read(block.required, "must-be"), read(block.prohibited, "never-be"));

  const seen = new Set<string>();
  for (const p of pairs) {
    if (seen.has(pairKey(p))) throw new ImportError("That file lists the same buddy rule twice.");
    seen.add(pairKey(p));
  }
  // Kind is part of `pairKey`, so the same two people under both kinds needs its own pass.
  const unkinded = new Set<string>();
  for (const p of pairs) {
    const key = p.a <= p.b ? `${p.a},${p.b}` : `${p.b},${p.a}`;
    if (unkinded.has(key)) {
      throw new ImportError("That file sets the same pair to both be and never be buddies.");
    }
    unkinded.add(key);
  }
  return pairs;
}

/** Every interpolation of untrusted file content goes through this: `ImportError.message` is
    rendered straight into the DOM, so an unbounded interpolation becomes an unbounded text node. */
function quote(value: unknown, max = 80): string {
  // Bounds the INPUT, not the output: stringify-then-slice still pays a full `JSON.stringify` of
  // the untrusted value, and on a deeply nested one throws a RangeError that escapes as something
  // other than an ImportError, so the caller's "Couldn't import that file" path never runs.
  if (typeof value === "string") return JSON.stringify(clampText(value, max));
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `a list of ${value.length} items`;
  return typeof value === "object" ? "an object" : typeof value;
}

/** Rehydrate a GraphView from a file WITHOUT regenerating: metrics are re-measured from the
    file's own edges, so quality reflects the actual graph rather than the declared `settings`.
    Size and density are bounded before any per-element work. */
export function importGraph(data: unknown): GraphView {
  if (typeof data !== "object" || data === null) {
    throw new ImportError("That file isn't a BuddyGraph JSON object.");
  }
  const f = data as Partial<BuddyGraphFile>;
  if (f.version !== 1) {
    throw new ImportError(`Unsupported file version: ${quote(f.version)} (expected 1).`);
  }
  if (!Array.isArray(f.people) || f.people.length === 0) {
    throw new ImportError("That file has no people.");
  }
  if (f.people.length > MAX_IMPORT_N) {
    throw new ImportError(`That file has ${f.people.length} people — the limit is ${MAX_IMPORT_N}.`);
  }
  if (!Array.isArray(f.edges)) {
    throw new ImportError("That file has no edges list.");
  }
  // Density gate: layout is O(m)/tick and the SVG renders one <line> per edge, so a graph denser
  // than a buddy graph (2·m <= BUDDY_MAX·n) would freeze the tab rather than merely render badly.
  if (2 * f.edges.length > BUDDY_MAX * f.people.length) {
    throw new ImportError(`That file has too many edges for ${f.people.length} people — it's denser than a buddy graph.`);
  }
  // Before any per-pair work, and before a later generate could reach `validate`'s O(n²)
  // prohibited-pair walk.
  const declaredPairs =
    (f.constraints?.required?.length ?? 0) + (f.constraints?.prohibited?.length ?? 0);
  if (declaredPairs > MAX_CONSTRAINT_PAIRS) {
    throw new ImportError(`That file has ${declaredPairs} buddy rules — the limit is ${MAX_CONSTRAINT_PAIRS}.`);
  }

  const n = f.people.length;
  const names: string[] = f.people.map((p, i) => {
    if (!p || typeof p.name !== "string") {
      throw new ImportError(`Person at position ${i} is missing a name.`);
    }
    // Per-NAME length: the other gates bound only totals, so one name can be half a megabyte and
    // is then the buddy label of everyone adjacent to it. Checked before any message can
    // interpolate the name and before the collective-length check below. In CODE POINTS, the unit
    // `parseRoster` truncates in — measuring UTF-16 units makes this stricter than the parser that
    // feeds it and refuses files this app itself just exported. The count is not reported so that
    // `codePointsIfOver` can stop at the limit instead of scanning a whole 8 MB name.
    if (codePointsIfOver(p.name, MAX_NAME_CHARS)) {
      throw new ImportError(`A name is too long (over ${MAX_NAME_CHARS} characters).`);
    }
    // Edges reference people by position; a present-but-mismatched id would mislabel them.
    if (p.id !== undefined && p.id !== i) {
      throw new ImportError(`Person ${quote(p.name)} has id ${quote(p.id)} but is at position ${i}.`);
    }
    return p.name;
  });

  // A control character is not a delimiter here, so it survives into the buddy list/CSV/clipboard
  // and then splits a pasted line into a cell whose next field can be a live formula. Checked
  // before the round-trip check below so the error names the real cause.
  if (names.some((x) => CONTROL_CHARS_TEST.test(x))) {
    throw new ImportError("A name contains a tab, line break, or other control character — remove it and try again.");
  }

  // `parseRoster` trims, drops blanks and de-dupes case-insensitively, so a name it would not
  // reproduce vanishes or splits on an Edit→regenerate and shifts every downstream buddy label.
  // Total length FIRST, so an over-long roster gets a size reason and not a misleading one.
  const joined = names.join("\n");
  if (joined.length > MAX_PARSE_CHARS) {
    throw new ImportError("Those names are collectively too long to import.");
  }
  const roundTrip = parseRoster(joined).names;
  if (roundTrip.length !== n || roundTrip.some((x, i) => x !== names[i])) {
    throw new ImportError("Every name must be non-empty, unique (case-insensitively), and free of commas or line breaks.");
  }

  const g = new Graph(n);
  for (const e of f.edges) {
    if (!Array.isArray(e) || e.length !== 2) {
      throw new ImportError("An edge isn't a [a, b] pair.");
    }
    const [a, b] = e;
    if (
      !Number.isInteger(a) || !Number.isInteger(b) ||
      a < 0 || b < 0 || a >= n || b >= n
    ) {
      // Through `quote()`: an endpoint is an arbitrary JSON value, so a raw interpolation puts a
      // multi-megabyte string or array into the error message.
      throw new ImportError(`Edge [${quote(a)}, ${quote(b)}] refers to someone outside 0..${n - 1}.`);
    }
    g.addEdge(a, b); // ignores self-loops and de-dupes symmetric entries
  }

  // Per-VERTEX degree, not just the average the density gate checks: a star graph with one hub of
  // degree n-1 passes that trivially, and `neighborhood.ts` relies on degree <= BUDDY_MAX.
  // Checked before the O(n^2) allPairsSummary below.
  const [degreeMin, degreeMax] = degreeExtent(g.degrees());
  if (degreeMax > BUDDY_MAX) {
    throw new ImportError(
      `Someone in that file has ${degreeMax} buddies — more than the ${BUDDY_MAX} a buddy graph allows.`,
    );
  }

  const constraints = readConstraints(f.constraints, n);

  const summary = allPairsSummary(g);
  const buddies = g.adj.map((s) => Array.from(s).sort((x, y) => x - y));
  const settings = sanitizeSettings(f.settings, degreeMax);

  return {
    names,
    edges: g.edgeList(),
    buddies,
    settings,
    constraints,
    // Rebuilt here and ONLY here: a file carries index pairs and no typed rows. Everywhere else
    // the rows are what survived, and rebuilding them from indices deletes the ones the editor
    // promises to keep.
    rows: toNamedPairs(constraints, names),
    // No builder ran, so there is nothing to report. Null means "not measured" and must never be
    // read as "all rules satisfied".
    report: null,
    metrics: assembleMetrics(n, {
      aspl: summary.aspl,
      diameter: summary.diameter,
      girth: girth(g),
      degreeMin,
      degreeMax,
      connected: summary.connected,
      largestComponentFraction: largestComponentFraction(g),
    }),
  };
}

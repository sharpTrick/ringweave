import { Graph, allPairsSummary, girth, largestComponentFraction } from "ringweave";
import {
  assembleMetrics, degreeExtent,
  BUDDY_MAX, BUDDY_MIN, DEFAULT_SEED, MAX_ROSTER_N, SEED_MAX, SEPARATION_MAX, SEPARATION_MIN,
  type GraphView, type Settings,
} from "../model";
import { MAX_PARSE_CHARS, parseRoster } from "./parseRoster";
import type { BuddyGraphFile } from "./schema";

/** Thrown with a plain-language reason when a file can't be imported. */
export class ImportError extends Error {}

/**
 * Import bounds. The core's pure metric functions (`allPairsSummary`/`girth`) are UNCAPPED
 * and re-measure the file on the main thread, and the graph view also LAYS OUT and RENDERS
 * every edge synchronously. So both node count AND density must be bounded:
 * - `MAX_IMPORT_N` caps the O(n^2) metric baseline.
 * - the density cap (avg degree <= BUDDY_MAX) keeps edge-scaling work in check — the force
 *   layout is O(m)/tick and the SVG renders one <line> per edge, so a near-complete graph
 *   (K430 ≈ 92k edges) would freeze layout+render even though its BFS cost is modest.
 * A buddy graph has at most BUDDY_MAX buddies each, so `2·m <= BUDDY_MAX·n` is the natural
 * ceiling; anything denser isn't a buddy graph and is refused with a plain-language error.
 * A rejected file costs an arithmetic check (the oversized *file* is stopped earlier by the
 * byte-size gate in readFileText, before it is parsed).
 *
 * The node cap equals the generation ceiling (a re-rollable import shouldn't display more
 * than the app can generate), which also holds the worst-case synchronous re-measure
 * (`allPairsSummary`+`girth`) to a few hundred ms rather than over a second.
 */
export const MAX_IMPORT_N = MAX_ROSTER_N;

function sanitizeInt(value: unknown, lo: number, hi: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(lo, Math.min(hi, value as number)) : fallback;
}

/** Sanitize the settings block: values come from arbitrary JSON. `buddies` and
    `minSeparation` become generation targets a later reroll passes to the core, so both are
    CLAMPED to the UI range [BUDDY_MIN, BUDDY_MAX] — an untrusted file must not inject a value
    the stepper can't express (a star graph's degree-1999 fallback, a declared minSeparation of
    1e9) and drive generation out of range. */
function sanitizeSettings(s: BuddyGraphFile["settings"] | undefined, fallbackBuddies: number): Settings {
  const declared = s && Number.isInteger(s.buddies) && s.buddies >= BUDDY_MIN ? s.buddies : fallbackBuddies;
  return {
    buddies: Math.max(BUDDY_MIN, Math.min(BUDDY_MAX, declared)),
    minSeparation: s && s.minSeparation !== undefined ? sanitizeInt(s.minSeparation, SEPARATION_MIN, SEPARATION_MAX, SEPARATION_MIN) : undefined,
    seed: sanitizeInt(s?.seed, 0, SEED_MAX, DEFAULT_SEED),
    polish: s && (s.polish === true || s.polish === false || s.polish === "auto") ? s.polish : "auto",
  };
}

/**
 * Rehydrate a GraphView from a file WITHOUT regenerating — the edges are in the file.
 * A `Graph` is rebuilt and metrics are recomputed with the core's own functions
 * (`allPairsSummary`/`girth`/`largestComponentFraction`), so imported (incl. hand-edited)
 * files are honestly re-measured — quality reflects the ACTUAL degree and connectivity, not
 * the declared `settings`. Round-trips identically with `exportGraph`. Dimensions and density
 * are bounded up front so an oversized/dense file fails fast instead of freezing the tab.
 */
export function importGraph(data: unknown): GraphView {
  if (typeof data !== "object" || data === null) {
    throw new ImportError("That file isn't a BuddyGraph JSON object.");
  }
  const f = data as Partial<BuddyGraphFile>;
  if (f.version !== 1) {
    throw new ImportError(`Unsupported file version: ${JSON.stringify(f.version)} (expected 1).`);
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
  // Density: a buddy graph has avg degree <= BUDDY_MAX, i.e. 2·m <= BUDDY_MAX·n. Anything
  // denser would freeze layout/render, so it's refused (not a buddy graph).
  if (2 * f.edges.length > BUDDY_MAX * f.people.length) {
    throw new ImportError(`That file has too many edges for ${f.people.length} people — it's denser than a buddy graph.`);
  }
  // M2 has no constraints UI; refuse a constraint-bearing file explicitly rather than
  // silently dropping the constraints on import (and re-exporting them as empty).
  if (f.constraints && ((f.constraints.required?.length ?? 0) > 0 || (f.constraints.prohibited?.length ?? 0) > 0)) {
    throw new ImportError("That file has constraints, which aren't supported yet.");
  }

  const n = f.people.length;
  const names: string[] = f.people.map((p, i) => {
    if (!p || typeof p.name !== "string") {
      throw new ImportError(`Person at position ${i} is missing a name.`);
    }
    // Edges reference people by position; a present-but-mismatched id would mislabel them.
    if (p.id !== undefined && p.id !== i) {
      throw new ImportError(`Person "${p.name}" has id ${p.id} but is at position ${i}.`);
    }
    return p.name;
  });

  // Names must survive the roster editor unchanged: `parseRoster` (comma/newline delimited)
  // trims, drops blanks, and de-dupes case-insensitively, so an empty/whitespace-only/
  // comma/newline/duplicate name would silently vanish or split on an Edit→regenerate,
  // shifting every downstream buddy label. Make the parser the authority — refuse anything
  // it wouldn't round-trip. Check total length FIRST so an over-long (but otherwise valid)
  // roster gets a size reason, not a misleading commas/uniqueness one.
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
      throw new ImportError(`Edge [${a}, ${b}] refers to someone outside 0..${n - 1}.`);
    }
    g.addEdge(a, b); // ignores self-loops and de-dupes symmetric entries
  }

  const summary = allPairsSummary(g);
  const [degreeMin, degreeMax] = degreeExtent(g.degrees());
  const buddies = g.adj.map((s) => Array.from(s).sort((x, y) => x - y));
  const settings = sanitizeSettings(f.settings, degreeMax);

  return {
    names,
    edges: g.edgeList(),
    buddies,
    settings,
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

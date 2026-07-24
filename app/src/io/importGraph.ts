import { Graph, allPairsSummary, girth } from "ringweave";
import { finiteOrNull, quality, type GraphView, type Settings } from "../model";
import type { BuddyGraphFile } from "./schema";

/** Thrown with a plain-language reason when a file can't be imported. */
export class ImportError extends Error {}

/**
 * Import bounds. The core's generation entry points are capped, but the pure metric
 * functions (`allPairsSummary`/`girth`) are deliberately UNCAPPED — and import feeds an
 * untrusted, possibly hand-authored/LLM-generated file straight into them on the main
 * thread. Without a cap, a ~1.5 MB file with 100k names (and zero edges) freezes the tab
 * for ~20 s. These bounds keep a rejected file's cost to milliseconds. `MAX_IMPORT_N`
 * mirrors the core's `MAX_CONSTRAINED_N`; the force layout is capped tighter (see layout.ts).
 */
export const MAX_IMPORT_N = 5000;
export const MAX_IMPORT_EDGES = 200_000;

function degreeExtent(degrees: number[]): [number, number] {
  if (degrees.length === 0) return [0, 0];
  let lo = degrees[0];
  let hi = degrees[0];
  for (const d of degrees) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/** Sanitize the settings block: values come from arbitrary JSON, and a bad `buddies`
    (non-integer, <2) would both corrupt the quality score and make a later Generate throw
    inside the core. Coerce to safe defaults rather than trust the file. */
function sanitizeSettings(s: BuddyGraphFile["settings"] | undefined): Settings {
  const buddies = s && Number.isInteger(s.buddies) && s.buddies >= 2 ? s.buddies : 4;
  const seed = s && Number.isInteger(s.seed) ? s.seed : 12345;
  const minSeparation =
    s && Number.isInteger(s.minSeparation) && (s.minSeparation as number) >= 2
      ? s.minSeparation
      : undefined;
  const polish: boolean | "auto" =
    s && (s.polish === true || s.polish === false || s.polish === "auto") ? s.polish : "auto";
  return { buddies, seed, minSeparation, polish };
}

/**
 * Rehydrate a GraphView from a file WITHOUT regenerating — the edges are in the file.
 * A `Graph` is rebuilt and metrics are recomputed with the core's own functions
 * (`allPairsSummary`/`girth`), so imported (incl. hand-edited) files are honestly
 * re-measured and the UI never reimplements the math. Round-trips identically with
 * `exportGraph` by construction. Dimensions are bounded up front so an oversized file
 * fails fast with a plain-language error instead of hanging the tab.
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
  if (f.edges.length > MAX_IMPORT_EDGES) {
    throw new ImportError(`That file has too many edges (limit ${MAX_IMPORT_EDGES}).`);
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

  const settings = sanitizeSettings(f.settings);
  const summary = allPairsSummary(g);
  const [degreeMin, degreeMax] = degreeExtent(g.degrees());
  const buddies = g.adj.map((s) => Array.from(s).sort((x, y) => x - y));

  return {
    names,
    edges: g.edgeList(),
    buddies,
    settings,
    metrics: {
      aspl: finiteOrNull(summary.aspl),
      diameter: finiteOrNull(summary.diameter),
      girth: finiteOrNull(girth(g)),
      quality: quality(summary.aspl, n, settings.buddies),
      regular: degreeMin === degreeMax,
      degreeMin,
      degreeMax,
    },
  };
}

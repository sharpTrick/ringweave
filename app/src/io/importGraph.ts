import { Graph, allPairsSummary, girth } from "ringweave";
import { finiteOrNull, quality, type GraphView, type Settings } from "../model";
import type { BuddyGraphFile } from "./schema";

/** Thrown with a plain-language reason when a file can't be imported. */
export class ImportError extends Error {}

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

/**
 * Rehydrate a GraphView from a file WITHOUT regenerating — the edges are in the file.
 * A `Graph` is rebuilt and metrics are recomputed with the core's own functions
 * (`allPairsSummary`/`girth`), so imported (incl. hand-edited) files are honestly
 * re-measured and the UI never reimplements the math. Round-trips identically with
 * `exportGraph` by construction.
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

  const names: string[] = f.people.map((p, i) => {
    if (!p || typeof p.name !== "string") {
      throw new ImportError(`Person at position ${i} is missing a name.`);
    }
    return p.name;
  });
  const n = names.length;

  if (!Array.isArray(f.edges)) {
    throw new ImportError("That file has no edges list.");
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

  const settings: Settings = {
    buddies: f.settings?.buddies ?? 4,
    minSeparation: f.settings?.minSeparation,
    polish: f.settings?.polish ?? "auto",
    seed: f.settings?.seed ?? 12345,
  };

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

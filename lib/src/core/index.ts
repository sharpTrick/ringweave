/**
 * BuddyGraph public API.
 *
 * The selected pipeline (per FINDINGS.md): ring-greedy + incremental distance
 * cache + degree repair, with an optional short fixed-seed polish pass at small
 * n where it reaches provable-optimal ASPL cheaply. Greedy is the spine —
 * deterministic, explainable, incremental — with polish as an optional layer.
 */
export { Graph, ring } from "./graph.js";
export {
  bfsDistances,
  isConnected,
  allPairsSummary,
  largestComponentFraction,
  girth,
  type Summary,
} from "./metrics.js";
export {
  mooreLowerBounds,
  asplGap,
  cycleAspl,
  type MooreBounds,
} from "./bounds.js";
export { ringGreedy, repairDegrees, type GreedyResult } from "./greedy.js";
export { polish, type PolishResult, type PolishMode } from "./polish.js";
export { RNG } from "./rng.js";

import { Graph } from "./graph.js";
import { ringGreedy } from "./greedy.js";
import { polish } from "./polish.js";
import { allPairsSummary, girth } from "./metrics.js";
import { asplGap } from "./bounds.js";

export interface BuddyOptions {
  /** Minimum degrees of separation to aim for (girth-flavored soft floor). */
  minSeparation?: number;
  /** Run a fixed-seed polish pass to tighten ASPL. Default: auto (n <= 120). */
  polish?: boolean | "auto";
  /** Seed for the polish pass (keeps output reproducible). */
  seed?: number;
  /** Iteration budget for polish. */
  polishIters?: number;
}

export interface BuddyResult {
  /** Adjacency: buddies[i] is the sorted list of person i's buddy indices. */
  buddies: number[][];
  edges: [number, number][];
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
  aspl: number;
  diameter: number;
  girth: number;
  asplGap: number;
  polished: boolean;
  finalMinSeparation: number;
}

/**
 * Build a buddy graph on `n` people where each person has ~`buddies` buddies.
 *
 * Returns adjacency plus quality metrics. Deterministic: the same (n, buddies,
 * options) always yields the same assignment (greedy is RNG-free; polish uses a
 * fixed seed).
 */
export function buildBuddyGraph(
  n: number,
  buddiesPerPerson: number,
  options: BuddyOptions = {},
): BuddyResult {
  const k = buddiesPerPerson;
  const mind = options.minSeparation ?? 5;
  const seed = options.seed ?? 12345;
  const wantPolish =
    options.polish === undefined || options.polish === "auto"
      ? n <= 120
      : options.polish === true;

  const { graph, finalMind } = ringGreedy(n, k, { mind, repair: true });

  let g: Graph = graph;
  let polished = false;
  if (wantPolish) {
    const res = polish(g, {
      mode: "anneal",
      seed,
      maxIters: options.polishIters ?? 20000,
    });
    // polish preserves degrees; only adopt it if it did not hurt connectivity
    const before = allPairsSummary(g);
    const after = allPairsSummary(res.graph);
    if (after.connected && after.aspl <= before.aspl + 1e-9) {
      g = res.graph;
      polished = true;
    }
  }

  const degrees = g.degrees();
  const degreeMin = Math.min(...degrees);
  const degreeMax = Math.max(...degrees);
  const summary = allPairsSummary(g);
  const buddies = g.adj.map((s) => Array.from(s).sort((a, b) => a - b));

  return {
    buddies,
    edges: g.edgeList(),
    regular: degreeMin === degreeMax,
    degreeMin,
    degreeMax,
    aspl: summary.aspl,
    diameter: summary.diameter,
    girth: girth(g),
    asplGap: asplGap(summary.aspl, n, k),
    polished,
    finalMinSeparation: finalMind,
  };
}

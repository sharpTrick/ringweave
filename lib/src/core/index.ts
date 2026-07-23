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
export {
  Constraints,
  validate,
  pair,
  pairKey,
  type TagPolicy,
  type Tag,
} from "./constraints.js";
export {
  constrainedGreedy,
  polishConstrained,
  type ConstrainedGreedyOptions,
  type PolishConstrainedOptions,
  type EdgePredicate,
  type Objective,
} from "./constrainedGreedy.js";

import { Graph } from "./graph.js";
import { ringGreedy } from "./greedy.js";
import { polish } from "./polish.js";
import { allPairsSummary, girth } from "./metrics.js";
import { asplGap } from "./bounds.js";
import { Constraints, validate } from "./constraints.js";
import { constrainedGreedy, polishConstrained } from "./constrainedGreedy.js";

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

export interface ConstrainedBuddyOptions {
  /** Minimum degrees of separation to aim for during completion. */
  minSeparation?: number;
  /** Run constraint-preserving polish. Default: auto (n <= 120). */
  polish?: boolean | "auto";
  /** Seed for the polish pass (keeps output reproducible). */
  seed?: number;
  /** Iteration budget for polish. */
  polishIters?: number;
  /**
   * Soft penalty weight for keeping prior buddies (churn). Ignored when priors
   * are promoted to hard (`Constraints.priorHard`). Defaults to a mild penalty
   * when priors exist, else none.
   */
  priorWeight?: number;
}

export interface ConstraintReport {
  /** All required present, no prohibited present, and the graph is connected. */
  satisfied: boolean;
  reqViolations: number;
  prohViolations: number;
  connected: boolean;
  /** Fraction of prior buddies preserved, or null when there are no priors. */
  priorsKept: number | null;
  /** Plain-language reasons the input was refused (empty when generated). */
  refusals: string[];
}

export interface ConstrainedBuddyResult {
  buddies: number[][];
  edges: [number, number][];
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
  aspl: number;
  diameter: number;
  polished: boolean;
  report: ConstraintReport;
}

/**
 * Build a buddy graph honoring hard required/prohibited constraints (and soft
 * or hard priors), returning the graph plus a report. Genuinely-impossible
 * inputs are refused up front with plain-language reasons rather than throwing.
 */
export function buildConstrainedBuddyGraph(
  n: number,
  buddiesPerPerson: number,
  cons: Constraints,
  options: ConstrainedBuddyOptions = {},
): ConstrainedBuddyResult {
  const k = buddiesPerPerson;

  const refusals = validate(cons, k);
  if (refusals.length > 0) return refusedResult(n, refusals);

  const active = withHardPriors(cons);
  const graph = constrainedGreedy(n, k, active, {
    minSeparation: options.minSeparation,
  });

  const wantPolish =
    options.polish === undefined || options.polish === "auto"
      ? n <= 120
      : options.polish === true;

  let g = graph;
  let polished = false;
  if (wantPolish) {
    // priorHard already promoted priors to required, so no soft penalty then.
    const priorWeight = active.priorHard
      ? 0
      : (options.priorWeight ?? (cons.priors.size > 0 ? 2 : 0));
    // polishConstrained returns the lowest-energy graph it saw, never worse
    // than its input on the objective, so adopting it is always safe.
    g = polishConstrained(g, active, {
      seed: options.seed ?? 0,
      iters: options.polishIters ?? 8000,
      priorWeight,
    });
    polished = true;
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
    polished,
    report: buildReport(g, cons, summary.connected),
  };
}

/** Priors promoted to hard become required edges on a copy (input untouched). */
function withHardPriors(cons: Constraints): Constraints {
  if (!cons.priorHard) return cons;
  const promoted = new Constraints(cons.n).merge(cons);
  for (const [a, b] of cons.priorPairs()) promoted.require(a, b);
  return promoted;
}

function buildReport(
  g: Graph,
  cons: Constraints,
  connected: boolean,
): ConstraintReport {
  let prohViolations = 0;
  for (const [a, b] of cons.prohibitedPairs()) if (g.hasEdge(a, b)) prohViolations++;
  let reqViolations = 0;
  for (const [a, b] of cons.requiredPairs()) if (!g.hasEdge(a, b)) reqViolations++;

  const priors = cons.priorPairs();
  let priorsKept: number | null = null;
  if (priors.length > 0) {
    let kept = 0;
    for (const [a, b] of priors) if (g.hasEdge(a, b)) kept++;
    priorsKept = kept / priors.length;
  }

  return {
    satisfied: reqViolations === 0 && prohViolations === 0 && connected,
    reqViolations,
    prohViolations,
    connected,
    priorsKept,
    refusals: [],
  };
}

function refusedResult(n: number, refusals: string[]): ConstrainedBuddyResult {
  return {
    buddies: Array.from({ length: n }, () => []),
    edges: [],
    regular: false,
    degreeMin: 0,
    degreeMax: 0,
    aspl: 0,
    diameter: 0,
    polished: false,
    report: {
      satisfied: false,
      reqViolations: 0,
      prohViolations: 0,
      connected: false,
      priorsKept: null,
      refusals,
    },
  };
}

/**
 * BuddyGraph public API.
 *
 * The selected pipeline (per docs/findings/FINDINGS.md): ring-greedy + incremental distance
 * cache + degree repair, with an optional short fixed-seed polish pass at small
 * n where it reaches provable-optimal ASPL cheaply. Greedy is the spine —
 * deterministic, explainable, incremental — with polish as an optional layer.
 */
// `validate()` is the authoritative feasibility gate — it refuses on BOTH the
// roster cap and the (intentionally internal) work budget. `MAX_CONSTRAINED_N` is
// re-exported as a user-facing dial for UI preflight; `MAX_CONSTRAINED_WORK` /
// `constrainedWork` stay unexported on purpose (a replaceable heuristic), so N is
// deliberately not the only ceiling. Call `validate()` rather than the constant.
export { Graph, ring, MAX_ROSTER, MAX_CONSTRAINED_N } from "./graph.js";
export {
  bfsDistances,
  isConnected,
  allPairsSummary,
  girth,
  type Summary,
} from "./metrics.js";
export { mooreLowerBounds, asplGap, type MooreBounds } from "./bounds.js";
export {
  ringGreedy,
  repairDegrees,
  MAX_CACHED_N,
  type GreedyResult,
  type GreedyOptions,
} from "./greedy.js";
export {
  polish,
  type PolishResult,
  type PolishMode,
  type PolishOptions,
} from "./polish.js";
export {
  Constraints,
  validate,
  type TagPolicy,
  type Tag,
} from "./constraints.js";
export {
  constrainedGreedy,
  polishConstrained,
  type ConstrainedGreedyOptions,
  type PolishConstrainedOptions,
} from "./constrainedGreedy.js";

import { Graph, MAX_ROSTER, DEFAULT_MIN_SEPARATION } from "./graph.js";
import { ringGreedy } from "./greedy.js";
import { polish } from "./polish.js";
import {
  allPairsSummary,
  girth,
  countPresentEdges,
  type Summary,
} from "./metrics.js";
import { asplGap } from "./bounds.js";
import { Constraints, validate } from "./constraints.js";
import { constrainedGreedy, polishConstrained } from "./constrainedGreedy.js";

export interface BuddyOptions {
  /** Minimum degrees of separation to aim for (girth-flavored soft floor). Default 5. */
  minSeparation?: number;
  /** Run a fixed-seed polish pass to tighten ASPL. Default: auto (n <= 120). */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 12345 (matches the `polish` backend). */
  seed?: number;
  /** Iteration budget for polish. Default 20000 (the `polish` backend's budget). */
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
 *
 * Requires `buddies >= 2`: the ring seed floors every degree at 2, so smaller
 * values throw (use `buildConstrainedBuddyGraph` for the empty graph / matching).
 *
 * Contract note: this unconstrained builder has no report channel, so malformed
 * `n`/`k` **throw** a clear error. The constraint-aware
 * `buildConstrainedBuddyGraph` instead **refuses** (populating `report.refusals`)
 * because it already carries a report — a deliberate, if asymmetric, split.
 */
export function buildBuddyGraph(
  n: number,
  buddiesPerPerson: number,
  options: BuddyOptions = {},
): BuddyResult {
  const k = buddiesPerPerson;
  const mind = options.minSeparation ?? DEFAULT_MIN_SEPARATION;
  const seed = options.seed ?? 12345;
  const wantPolish = resolveWantPolish(options.polish, n);

  const { graph, finalMind } = ringGreedy(n, k, { mind, repair: true });

  let g: Graph = graph;
  let polished = false;
  if (wantPolish) {
    // polish returns the lowest penalized-ASPL graph it saw, never worse than its
    // input (disconnection is penalized, so a connected input stays connected) —
    // adopting it is always safe, exactly as buildConstrainedBuddyGraph trusts
    // polishConstrained.
    g = polish(g, { mode: "anneal", seed, maxIters: options.polishIters ?? 20000 }).graph;
    polished = true;
  }

  const { degreeMin, degreeMax, summary, buddies } = summarize(g);

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
  /** Minimum degrees of separation to aim for during completion. Default 5. */
  minSeparation?: number;
  /** Run constraint-preserving polish. Default: auto (n <= 120). */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 0 (matches the `polishConstrained` backend). */
  seed?: number;
  /** Iteration budget for polish. Default 8000 (the `polishConstrained` backend's budget). */
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
  /** Fraction (0..1) of prior buddies preserved, or null when there are no priors. */
  priorsKeptFraction: number | null;
  /** Plain-language reasons the input was refused (empty when generated). */
  refusals: string[];
}

/**
 * Result of {@link buildConstrainedBuddyGraph}. When `report.refusals` is
 * non-empty the input was refused: `buddies`/`edges` are empty and the metric
 * fields are placeholders — read `report` first.
 *
 * `girth`/`asplGap` are intentionally omitted (unlike {@link BuddyResult}):
 * Moore's bound assumes a k-regular target, which constrained graphs only
 * approximate. Build a Graph from `edges` and call `girth(g)` if a UI needs it.
 */
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

  // Refuse a malformed roster size FIRST, before the n !== cons.n check (which
  // would fire on NaN via NaN !== NaN and mask the clearer reason) and before any
  // n-sized allocation. This entry point refuses (never throws) — see the
  // throw-vs-refuse note on buildBuddyGraph.
  if (!Number.isInteger(n) || n < 0 || n > MAX_ROSTER) {
    const why =
      Number.isInteger(n) && n > MAX_ROSTER
        ? `roster size ${n} exceeds the maximum of ${MAX_ROSTER}`
        : `roster size ${n} is not a valid count`;
    return refusedResult(n, [why]);
  }

  // n and cons.n are two sources of roster size; a mismatch would otherwise
  // dereference a missing vertex during generation. Refuse cleanly instead.
  if (n !== cons.n) {
    return refusedResult(n, [
      `roster size ${n} does not match the constraints (built for ${cons.n})`,
    ]);
  }

  // Promote hard priors to required BEFORE validating, so an infeasibility that
  // only exists after promotion (e.g. a prior that is also prohibited, or one
  // that pushes required-degree over k) is refused rather than silently emitted.
  const active = withHardPriors(cons);
  const refusals = validate(active, k);
  if (refusals.length > 0) return refusedResult(n, refusals);

  const graph = constrainedGreedy(n, k, active, {
    minSeparation: options.minSeparation,
  });

  let g = graph;
  let polished = false;
  if (resolveWantPolish(options.polish, n)) {
    // priorHard already promoted priors to required, so no soft penalty then.
    const priorWeight = active.priorHard
      ? 0
      : (options.priorWeight ?? (cons.priorCount > 0 ? DEFAULT_PRIOR_WEIGHT : 0));
    // polishConstrained returns the lowest-energy graph it saw, never worse
    // than its input on the objective, so adopting it is always safe.
    g = polishConstrained(g, active, {
      seed: options.seed ?? 0,
      iters: options.polishIters ?? 8000,
      priorWeight,
    });
    polished = true;
  }

  const { degreeMin, degreeMax, summary, buddies } = summarize(g);

  return {
    buddies,
    edges: g.edgeList(),
    regular: degreeMin === degreeMax,
    degreeMin,
    degreeMax,
    aspl: summary.aspl,
    diameter: summary.diameter,
    polished,
    // report from the ORIGINAL cons (not active): reqViolations reflects the
    // caller's declared requireds, not priors promoted to required — safe because
    // the postconditions guarantee every active-required edge is present.
    report: buildReport(g, cons, summary.connected),
  };
}

/** Priors promoted to hard become required edges on a copy (input untouched). */
function withHardPriors(cons: Constraints): Constraints {
  if (!cons.priorHard) return cons;
  // merge() carries priorHard across; then priors also become required edges.
  const promoted = new Constraints(cons.n).merge(cons);
  for (const [a, b] of cons.priorPairs()) promoted.require(a, b);
  return promoted;
}

/** Shared post-generation summary for both builders (degrees, metrics, buddies). */
function summarize(g: Graph): {
  degreeMin: number;
  degreeMax: number;
  summary: Summary;
  buddies: number[][];
} {
  const [degreeMin, degreeMax] = degreeExtent(g.degrees());
  const summary = allPairsSummary(g);
  const buddies = g.adj.map((s) => Array.from(s).sort((a, b) => a - b));
  return { degreeMin, degreeMax, summary, buddies };
}

// The churn-bench default (docs/findings/CONSTRAINT_FINDINGS.md: ~47–81% of prior buddies
// preserved without hurting ASPL). Tests check monotonicity in the weight, not
// this specific value. A product-tunable dial.
const DEFAULT_PRIOR_WEIGHT = 2;

/** Resolve the polish option: "auto" (default) enables polish for n <= 120. */
function resolveWantPolish(option: boolean | "auto" | undefined, n: number): boolean {
  return option === undefined || option === "auto" ? n <= 120 : option === true;
}

/** Min and max of a degree sequence, loop-based to avoid arg-spread limits. */
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
  const priorsKeptFraction =
    priors.length > 0 ? countPresentEdges(g, priors) / priors.length : null;

  return {
    satisfied: reqViolations === 0 && prohViolations === 0 && connected,
    reqViolations,
    prohViolations,
    connected,
    priorsKeptFraction,
    refusals: [],
  };
}

function refusedResult(n: number, refusals: string[]): ConstrainedBuddyResult {
  // A malformed/oversized n reaches here (that IS what's being refused), so never
  // allocate an n-sized array from it — the caller reads `report.refusals` anyway.
  const size = Number.isInteger(n) && n >= 0 && n <= MAX_ROSTER ? n : 0;
  return {
    buddies: Array.from({ length: size }, () => []),
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
      priorsKeptFraction: null,
      refusals,
    },
  };
}

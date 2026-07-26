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
export { Graph, ring, MAX_ROSTER, MAX_CONSTRAINED_N, DEFAULT_MIN_SEPARATION } from "./graph.js";
export {
  bfsDistances,
  UNREACHABLE,
  isConnected,
  allPairsSummary,
  girth,
  shortestPath,
  eccentricity,
  largestComponentFraction,
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
  validateDetailed,
  formatReason,
  type Reason,
  type TagPolicy,
  type Tag,
} from "./constraints.js";
export {
  constrainedGreedy,
  polishConstrained,
  type ConstrainedGreedyOptions,
  type PolishConstrainedOptions,
} from "./constrainedGreedy.js";

import {
  Graph,
  MAX_ROSTER,
  DEFAULT_MIN_SEPARATION,
  MAX_POLISH_WORK,
  polishWork,
} from "./graph.js";
import { ringGreedy } from "./greedy.js";
import { polish } from "./polish.js";
import {
  allPairsSummary,
  girth,
  countPresentEdges,
  largestComponentFraction,
  type Summary,
} from "./metrics.js";
import { asplGap } from "./bounds.js";
import { Constraints, validate } from "./constraints.js";
import { constrainedGreedy, polishConstrained } from "./constrainedGreedy.js";

export interface BuddyOptions {
  /** Minimum degrees of separation to aim for (girth-flavored soft floor). Default 5. */
  minSeparation?: number;
  /**
   * Run a fixed-seed polish pass to tighten ASPL. Default "auto": on when the
   * pass's modelled work fits `MAX_POLISH_WORK`, which is k-aware — not when n
   * alone is small. An explicit `true` is honoured regardless.
   */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 12345 (matches the `polish` backend). */
  seed?: number;
  /**
   * Iteration budget for polish. Default 20000. A non-integer or negative value
   * falls back to that default, and ANY value is clamped to what
   * `MAX_POLISH_WORK` affords at this (n, k) — the budget is authoritative.
   */
  polishIters?: number;
}

export interface BuddyResult {
  /** Adjacency: buddies[i] is the sorted list of person i's buddy indices. */
  buddies: number[][];
  edges: [number, number][];
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
  /**
   * Mean separation over pairs that CAN reach each other, and the longest such
   * separation. WITHIN-GROUP values: when `connected` is false they describe only
   * the reachable pairs, so a split roster reports a small, healthy-looking
   * number. Always read them with `connected` — which is why it is now here.
   *
   * They are deliberately NOT Infinity when disconnected, unlike `eccentricity`.
   * That asymmetry is not an oversight: these two are pinned byte-for-byte
   * against `reference-python`'s `all_pairs_summary` and its fixtures, whereas
   * `eccentricity` is new and had no such constraint, so it could take the safer
   * convention from the start. Changing these would mean changing the oracle and
   * regenerating every fixture to remove a hazard that `connected` already
   * closes for every consumer in this repo.
   */
  aspl: number;
  diameter: number;
  girth: number;
  asplGap: number;
  polished: boolean;
  finalMinSeparation: number;
  /**
   * Whether every person can reach every other. `allPairsSummary` has always
   * computed this; it simply was not surfaced, which left every consumer either
   * hardcoding `true` or inferring connectivity from a finite ASPL — and ASPL is
   * a mean over *reachable* pairs, so a split roster reads as finite and can
   * score as optimal.
   */
  connected: boolean;
  /**
   * Fraction (0..1) of people in the largest group. 1 when connected. The graded
   * companion to `connected`, matching {@link ConstraintReport}'s field of the
   * same name so both builders report connectivity the same way.
   */
  largestComponentFraction: number;
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
  const polishIters = boundedIterations(options.polishIters, DEFAULT_POLISH_ITERS, n, k);
  const wantPolish = resolveWantPolish(options.polish, n, k, DEFAULT_POLISH_ITERS);

  const { graph, finalMind } = ringGreedy(n, k, { mind, repair: true });

  let g: Graph = graph;
  let polished = false;
  if (wantPolish) {
    // polish returns the lowest penalized-ASPL graph it saw, never worse than its
    // input (disconnection is penalized, so a connected input stays connected) —
    // adopting it is always safe, exactly as buildConstrainedBuddyGraph trusts
    // polishConstrained.
    g = polish(g, { mode: "anneal", seed, maxIters: polishIters }).graph;
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
    connected: summary.connected,
    largestComponentFraction: largestComponentFraction(g),
  };
}

export interface ConstrainedBuddyOptions {
  /** Minimum degrees of separation to aim for during completion. Default 5. */
  minSeparation?: number;
  /**
   * Run constraint-preserving polish. Default "auto": on when the pass's modelled
   * work fits `MAX_POLISH_WORK` (k-aware), not when n alone is small.
   */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 0 (matches the `polishConstrained` backend). */
  seed?: number;
  /**
   * Iteration budget for polish. Default 8000. A non-integer or negative value
   * falls back to that default, and ANY value is clamped to what
   * `MAX_POLISH_WORK` affords at this (n, k).
   */
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
  /**
   * Fraction (0..1) of people in the largest connected group. 1 when connected;
   * a graded companion to `connected` for the honest residual-disconnection the
   * constrained generator can leave (e.g. "94% of people are in one group").
   */
  largestComponentFraction: number;
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
  /** Within-group values — see the note on {@link BuddyResult.aspl}. Read with `report.connected`. */
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
  const polishIters = boundedIterations(options.polishIters, DEFAULT_CONSTRAINED_POLISH_ITERS, n, k);
  if (resolveWantPolish(options.polish, n, k, DEFAULT_CONSTRAINED_POLISH_ITERS)) {
    // priorHard already promoted priors to required, so no soft penalty then.
    const priorWeight = active.priorHard
      ? 0
      : (options.priorWeight ?? (active.priorCount > 0 ? DEFAULT_PRIOR_WEIGHT : 0));
    // polishConstrained returns the lowest-energy graph it saw, never worse
    // than its input on the objective, so adopting it is always safe.
    g = polishConstrained(g, active, {
      seed: options.seed ?? 0,
      iters: polishIters,
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

/** Default polish iteration budget on the unconstrained path (matches the `polish` backend). */
const DEFAULT_POLISH_ITERS = 20000;
/** Default polish iteration budget on the constrained path (matches `polishConstrained`). */
const DEFAULT_CONSTRAINED_POLISH_ITERS = 8000;

/**
 * Resolve the iteration count polish will actually run, from a caller-supplied
 * value that becomes a LOOP BOUND.
 *
 * Two things go wrong if this is only type-checked, and both were found by
 * review after a first attempt that did exactly that.
 *
 * TYPE. `n` and `k` are validated everywhere; the options object was taken on
 * faith, and one of its fields is used directly as `for (let i = 0; i < iters;
 * i++)`. `Infinity` is reachable from JSON without an Infinity literal —
 * `JSON.parse('{"polishIters":1e999}').polishIters === Infinity` — and the only
 * other loop exit is "fewer than two edges", so with a real graph neither polish
 * pass ever returned. That broke `buildConstrainedBuddyGraph`'s documented
 * "refuses, never throws" contract in the worst way: it did neither.
 *
 * MAGNITUDE. Rejecting `Infinity` and accepting `1e15` is not a budget, it is a
 * boundary one step to the left of the same defect. So the value is CLAMPED to
 * what `MAX_POLISH_WORK` affords at this (n, k), which makes the constant
 * authoritative rather than advisory — including for an explicit `polish: true`,
 * the path that otherwise let one boolean re-open the 33 s case the budget was
 * introduced to close.
 *
 * The clamp is a NO-OP wherever auto-polish currently runs: `resolveWantPolish`
 * only admits configurations whose default-iteration work already fits, so the
 * minimum is the requested value by construction. Nothing pinned moves.
 *
 * A malformed value falls back to the documented default rather than throwing —
 * refusing outright would be a new failure mode for existing callers, and it is
 * the same treatment the app's import path already gives untrusted settings.
 */
function boundedIterations(
  value: number | undefined,
  fallback: number,
  n: number,
  k: number,
): number {
  const requested = Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fallback;
  const perIteration = polishWork(n, k, 1);
  // No edges to swap: the loop exits on its own, and dividing by zero here would
  // produce Infinity — the very value being guarded against.
  if (perIteration <= 0) return requested;
  return Math.min(requested, Math.floor(MAX_POLISH_WORK / perIteration));
}

// Measured on the churn sweep (docs/findings/churn-priors-weight.md): preservation is a
// step function — any weight >= ~0.5 saturates it (98% kept at n=30, 86% at n=60, 64% at
// n=120), at negligible ASPL cost. 2 sits on that plateau with margin above the activation
// threshold. Tests check monotonicity in the weight, not this value. A product-tunable dial.
const DEFAULT_PRIOR_WEIGHT = 2;

/**
 * Resolve the polish option. "auto" (the default) enables polish when its
 * MODELLED WORK fits the budget, rather than when n alone is small.
 *
 * The old rule was `n <= 120`, which bounds n and nothing else — so the most
 * expensive input on the entire default path sat just below the gate:
 * `buildBuddyGraph(120, 12)` ran for 33 s while `buildBuddyGraph(121, 12)` took
 * 0.1 s. Density never participated, and cost DECREASED as the roster grew.
 *
 * `MAX_POLISH_WORK` is calibrated to reproduce the old threshold exactly at k=4
 * — the configuration the fixtures and the reroll boundary test pin — so nothing
 * currently pinned moves; see the constant for the arithmetic.
 *
 * An EXPLICIT `polish: true` is still honoured — but it is no longer unbounded.
 * The caller decides WHETHER to polish; `boundedIterations` decides how much work
 * that may cost. Before, honouring the instruction meant one boolean could
 * re-open the exact 33 s case this budget was introduced to close.
 *
 * The decision is modelled on the DEFAULT iteration budget, not on whatever the
 * caller passed. "Is this a configuration we auto-polish?" is a property of the
 * roster (n, k), and it is mirrored by the app as `POLISH_MAX_N` to word its
 * reroll copy ("above the cap a seed bump is a no-op", because polish is the only
 * seed-dependent stage). Letting a small `polishIters` flip the gate on would
 * make that copy wrong in a corner and would tie a stable contract to a tuning
 * knob.
 */
function resolveWantPolish(
  option: boolean | "auto" | undefined,
  n: number,
  k: number,
  defaultIters: number,
): boolean {
  if (option === undefined || option === "auto") {
    return polishWork(n, k, defaultIters) <= MAX_POLISH_WORK;
  }
  return option === true;
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
    largestComponentFraction: largestComponentFraction(g),
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
      // No graph was produced (input refused); 0 signals "no group formed",
      // consistent with connected:false — not the empty-graph vacuous 1.
      largestComponentFraction: 0,
      priorsKeptFraction: null,
      refusals,
    },
  };
}

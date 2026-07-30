/**
 * BuddyGraph public API. Pipeline: ring-greedy + degree repair, with an optional
 * fixed-seed polish pass (see docs/findings/FINDINGS.md).
 */
// `validate()` is the authoritative feasibility gate: it also refuses on an unexported work
// budget, so `MAX_CONSTRAINED_N` is not the only ceiling — preflight with `validate()`, not
// with the constant.
export { Graph, ring, MAX_ROSTER } from "./graph.js";
export { MAX_CONSTRAINED_N, DEFAULT_MIN_SEPARATION } from "./budgets.js";
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
  type PolishConstrainedResult,
} from "./constrainedGreedy.js";

import { Graph, MAX_ROSTER } from "./graph.js";
import {
  DEFAULT_MIN_SEPARATION,
  MAX_CONSTRAINED_N,
  MAX_GREEDY_WORK,
  MAX_POLISH_WORK,
  greedyWork,
  polishWork,
} from "./budgets.js";
import { MAX_CACHED_N, ringGreedy } from "./greedy.js";
import { checkSeed, isSeed } from "./rng.js";
import { polish, DEFAULT_POLISH_ITERS } from "./polish.js";
import {
  allPairsSummary,
  girth,
  countPresentEdges,
  largestComponentFraction,
  type Summary,
} from "./metrics.js";
import { asplGap } from "./bounds.js";
import { Constraints, validate } from "./constraints.js";
import {
  constrainedGreedy,
  polishConstrained,
  DEFAULT_CONSTRAINED_POLISH_ITERS,
} from "./constrainedGreedy.js";

export interface BuddyOptions {
  /**
   * Minimum degrees of separation to aim for. Default 5. An alias for the `mind` the core and
   * `reference-python` spell, not a second knob. Honoured on the UNCONSTRAINED path only.
   */
  minSeparation?: number;
  /**
   * Run a fixed-seed polish pass to tighten ASPL. Default "auto": on when the modelled work fits
   * `MAX_POLISH_WORK`, which is k-aware — not when n alone is small. `true` is honoured regardless.
   */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 12345 (matches the `polish` backend). */
  seed?: number;
  /**
   * Iteration budget for polish. Default 20000. A non-integer or negative value falls back to
   * that default, and ANY value is clamped to what `MAX_POLISH_WORK` affords at this (n, k).
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
   * Mean and longest separation over pairs that CAN reach each other — a split roster reports a
   * small, healthy-looking number, so always read them with `connected`. Deliberately not
   * Infinity when disconnected (unlike `eccentricity`): pinned against `reference-python`'s
   * `all_pairs_summary`, so the convention cannot change without regenerating every fixture.
   */
  aspl: number;
  diameter: number;
  girth: number;
  asplGap: number;
  polished: boolean;
  finalMinSeparation: number;
  /** Whether every person can reach every other. A finite `aspl` does NOT imply it. */
  connected: boolean;
  /** Fraction (0..1) of people in the largest group. 1 when connected. */
  largestComponentFraction: number;
}

/**
 * Build a buddy graph on `n` people where each person has ~`buddies` buddies.
 *
 * Deterministic: the same (n, buddies, options) always yields the same assignment (greedy is
 * RNG-free; polish uses a fixed seed).
 *
 * Requires `buddies >= 2` — the ring seed floors every degree at 2, so smaller values throw
 * (use `buildConstrainedBuddyGraph` for the empty graph / matching). Malformed `n`/`k` THROW
 * here because this builder has no report channel; `buildConstrainedBuddyGraph` refuses instead.
 */
export function buildBuddyGraph(
  n: number,
  buddiesPerPerson: number,
  options: BuddyOptions = {},
): BuddyResult {
  const k = buddiesPerPerson;
  const mind = options.minSeparation ?? DEFAULT_MIN_SEPARATION;
  // Checked here, not left to the `RNG` constructor (which only runs when polish does), so that
  // whether a bad seed is rejected does not depend on roster size.
  const seed = checkSeed(options.seed ?? 12345);
  // 0 priors: this path runs `polish`, whose objective has no prior term.
  const wantPolish = resolveWantPolish(options.polish, n, k, 0, DEFAULT_POLISH_ITERS);

  const { graph, finalMind } = ringGreedy(n, k, { mind, repair: true });

  let g: Graph = graph;
  let polished = false;
  if (wantPolish) {
    // polish returns the lowest penalized-ASPL graph it saw, never worse than its input
    // (disconnection is penalized), so adopting it is always safe. `polished` must come from
    // `changed`: `iters` counts loop PASSES, so an untouched return still reports thousands.
    const res = polish(g, { mode: "anneal", seed, maxIters: options.polishIters });
    g = res.graph;
    polished = res.changed;
  }

  const { degreeMin, degreeMax, summary, buddies } = summarize(g);
  const gi = girth(g);

  return {
    buddies,
    edges: g.edgeList(),
    regular: degreeMin === degreeMax,
    degreeMin,
    degreeMax,
    aspl: summary.aspl,
    diameter: summary.diameter,
    girth: gi,
    // Scored against the degree DELIVERED, not the one requested: the demotion floor can return a
    // smaller degree, and scoring that against k reports a large gap for an optimal graph.
    asplGap: asplGap(summary.aspl, n, degreeMax),
    polished,
    // Derived from the RETURNED graph, not `ringGreedy`'s target: polish runs afterwards and is
    // not separation-aware, so the target over-advertises. Achieved separation is girth - 1.
    finalMinSeparation: Number.isFinite(gi) ? gi - 1 : finalMind,
    connected: summary.connected,
    largestComponentFraction: largestComponentFraction(g),
  };
}

export interface ConstrainedBuddyOptions {
  /**
   * ACCEPTED AND IGNORED on this path: `choosePartner` always takes the farthest legal partner
   * rather than aiming at a target, so no value here changes the output. Kept only for call-site
   * compatibility with {@link BuddyOptions}.
   */
  minSeparation?: number;
  /**
   * Run constraint-preserving polish. Default "auto": on when the pass's modelled
   * work fits `MAX_POLISH_WORK` (k-aware), not when n alone is small.
   */
  polish?: boolean | "auto";
  /** Seed for the polish pass. Default 0 (matches the `polishConstrained` backend). */
  seed?: number;
  /**
   * Iteration budget for polish. Default 8000. A non-integer or negative value falls back to that
   * default, and ANY value is clamped to what `MAX_POLISH_WORK` affords at this (n, k).
   */
  polishIters?: number;
  /**
   * Soft penalty weight for keeping prior buddies (churn). Ignored when priors are promoted to
   * hard (`Constraints.priorHard`). Defaults to a mild penalty when priors exist, else none.
   */
  priorWeight?: number;
}

export interface ConstraintReport {
  /** All required present, no prohibited present, and the graph is connected. */
  satisfied: boolean;
  reqViolations: number;
  prohViolations: number;
  connected: boolean;
  /** Fraction (0..1) of people in the largest connected group. 1 when connected. */
  largestComponentFraction: number;
  /**
   * Fraction (0..1) of prior buddies preserved, or null when priors were never WEIGHED (none
   * existed, or polish did not run at this (n, k)) — an unweighed fraction is coincidence, so it
   * is reported as null rather than as a number a caller would read as intent.
   */
  priorsKeptFraction: number | null;
  /** Plain-language reasons the input was refused (empty when generated). */
  refusals: string[];
}

/**
 * Result of {@link buildConstrainedBuddyGraph}. When `report.refusals` is non-empty the input was
 * refused: `edges` is empty, the metric fields are placeholders, and `buddies` holds one EMPTY
 * list per person — read `report` first, and note `buddies.length` is therefore not a "did this
 * succeed" test.
 *
 * `buddies.length === n` holds only for an `n` this builder could have accepted (an integer in
 * [0, MAX_CONSTRAINED_N]); for anything larger it is 0, so a refusal never allocates from the
 * oversized `n` it is refusing.
 *
 * `girth`/`asplGap` are intentionally omitted (unlike {@link BuddyResult}): Moore's bound assumes
 * a k-regular target, which constrained graphs only approximate. Build a Graph from `edges` and
 * call `girth(g)` if a UI needs it.
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

  // Malformed roster size FIRST: the `n !== cons.n` check below fires on NaN (NaN !== NaN) and
  // would mask the clearer reason, and nothing should allocate n-sized from an unvalidated n.
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

  // Promote hard priors BEFORE validating, so an infeasibility that only exists after promotion
  // (a prior that is also prohibited, or one pushing required-degree over k) is refused.
  const active = withHardPriors(cons);
  const refusals = validate(active, k);
  if (refusals.length > 0) return refusedResult(n, refusals);

  const graph = constrainedGreedy(n, k, active, {
    minSeparation: options.minSeparation,
  });

  let g = graph;
  let polished = false;
  let priorWeight = 0;
  let priorsWeighed = false;
  // Resolved once, above the gate: the gate, the optimizer and the report all read this weight
  // and must not disagree, and the gate has to charge for the prior probes the pass will pay for.
  const requestedPriorWeight =
    options.priorWeight ?? (active.priorCount > 0 ? DEFAULT_PRIOR_WEIGHT : 0);
  // priorHard already promoted priors to required, so no soft penalty then. The rest is the SAME
  // predicate `polishConstrained` enforces by throwing — normalised here instead, because this
  // entry point's contract is to refuse via `report.refusals` and never to throw.
  const resolvedPriorWeight =
    active.priorHard || !(Number.isFinite(requestedPriorWeight) && requestedPriorWeight >= 0)
      ? 0
      : requestedPriorWeight;
  if (
    resolveWantPolish(
      options.polish,
      n,
      k,
      resolvedPriorWeight === 0 ? 0 : active.priorCount,
      DEFAULT_CONSTRAINED_POLISH_ITERS,
    )
  ) {
    priorWeight = resolvedPriorWeight;
    // polishConstrained returns the lowest-energy graph it saw, never worse than its input on the
    // objective, so adopting it is always safe. Seed normalised, not thrown on, like `priorWeight`.
    const requestedSeed = options.seed ?? 0;
    const res = polishConstrained(g, active, {
      seed: isSeed(requestedSeed) ? requestedSeed : 0,
      iters: options.polishIters,
      priorWeight,
    });
    g = res.graph;
    // Two different facts, not one: `changed` describes the OUTPUT, while `decisions > 0`
    // describes whether the priors were ever WEIGHED — a pass that accepted nothing still did.
    polished = res.changed;
    priorsWeighed = res.decisions > 0;
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
    // ORIGINAL cons, not active: reqViolations must reflect the caller's declared requireds, not
    // priors promoted to required (safe — the postconditions guarantee every active-required edge
    // is present). Priors count as accounted for by either route, promotion or a polish pass that
    // ran; any other case leaves `priorsKeptFraction` measuring coincidence, so it must be null.
    report: buildReport(g, cons, summary.connected, active.priorHard || (priorsWeighed && priorWeight !== 0)),
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

// A product-tunable dial sitting on the preservation plateau measured in
// docs/findings/churn-priors-weight.md. Tests check monotonicity in the weight, not this value.
const DEFAULT_PRIOR_WEIGHT = 2;

/**
 * Resolve the polish option. "auto" (the default) enables polish when its MODELLED WORK fits
 * `MAX_POLISH_WORK`, rather than when n alone is small.
 *
 * `MAX_POLISH_WORK` reproduces the old `n <= 120` threshold exactly at k=4, the configuration the
 * fixtures and the reroll boundary test pin, so retuning it moves what they pin. The gate is
 * modelled on the DEFAULT iteration budget, not the caller's `polishIters`, so a small
 * `polishIters` cannot flip auto-polish on.
 */
// Do not clamp iterations here: `boundedPolishIterations` lives inside `polish` /
// `polishConstrained` because both are exported public API, so a clamp in this wrapper would not
// apply to a direct caller — which is how `polish(ring(20), { maxIters: Infinity })` used to hang.
function resolveWantPolish(
  option: boolean | "auto" | undefined,
  n: number,
  k: number,
  priorCount: number,
  defaultIters: number,
): boolean {
  if (option === undefined || option === "auto") {
    return polishWork(n, k, priorCount, defaultIters) <= MAX_POLISH_WORK;
  }
  return option === true;
}

/**
 * Whether `buildBuddyGraph` will generate this configuration rather than throw — the gate itself,
 * exported, the sibling of {@link autoPolishEnabled} and for the same reason.
 *
 * A consumer's pre-flight must call this rather than re-derive it from the exported constants: the
 * densest advertised configuration clears `MAX_GREEDY_WORK` by zero margin, so one constant edit in
 * either package would have a UI offer Generate for a configuration this package throws on.
 *
 * Covers only what is predictable BEFORE the run (argument domain, memory cap, work budget); it
 * cannot cover `repairDegrees`' runtime counter, which is bounded rather than predicted.
 */
export function canGenerate(n: number, k: number): boolean {
  return (
    Number.isInteger(n) &&
    Number.isInteger(k) &&
    n >= 0 &&
    k >= 2 &&
    n <= MAX_CACHED_N &&
    greedyWork(n, k) <= MAX_GREEDY_WORK
  );
}

/**
 * Whether the default ("auto") path polishes this configuration — the gate itself, exported, so a
 * consumer never re-derives it. Polish is the only seed-dependent stage, so a UI offering "give me
 * a different arrangement" must ask this before promising variation it cannot deliver; the cutoff
 * is a function of (n, k, which builder), not an n literal, hence a function rather than a number.
 */
export function autoPolishEnabled(
  n: number,
  k: number,
  opts: { constrained?: boolean } = {},
): boolean {
  return resolveWantPolish(
    "auto",
    n,
    k,
    // 0, not a new option: no caller has a prior concept yet. `polishWork` underneath still
    // REQUIRES the dimension, because defaulting it away is how it went missing.
    0,
    opts.constrained ? DEFAULT_CONSTRAINED_POLISH_ITERS : DEFAULT_POLISH_ITERS,
  );
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
  /**
   * Accounted for by EITHER route — promoted to required edges, or weighed by polish — which is
   * why it is not named `priorsWeighed`: on the promotion path nothing weighed them and
   * `priorsKeptFraction` is correctly 1, not null.
   */
  priorsAccountedFor: boolean,
): ConstraintReport {
  let prohViolations = 0;
  for (const [a, b] of cons.prohibitedPairs()) if (g.hasEdge(a, b)) prohViolations++;
  let reqViolations = 0;
  for (const [a, b] of cons.requiredPairs()) if (!g.hasEdge(a, b)) reqViolations++;

  const priors = cons.priorPairs();
  const priorsKeptFraction =
    priorsAccountedFor && priors.length > 0 ? countPresentEdges(g, priors) / priors.length : null;

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
  // A malformed/oversized n reaches here (that IS what is being refused), so never allocate an
  // n-sized array from it. Bounded by MAX_CONSTRAINED_N, not MAX_ROSTER (1e6): a refusal that
  // costs more than a success is a denial-of-service gradient pointing the wrong way.
  const size = Number.isInteger(n) && n >= 0 && n <= MAX_CONSTRAINED_N ? n : 0;
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

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
  // Checked HERE rather than left to the `RNG` constructor, which only runs when polish does.
  // `resolveWantPolish` is a function of (n, k), so leaving it there made an option's acceptance
  // depend on roster size — the same shape as the `priorWeight` bug on the constrained path,
  // where a contract broke as a function of n. This entry point throws on bad input (see the
  // doc comment above); its constrained sibling refuses, and normalises instead.
  const seed = checkSeed(options.seed ?? 12345);
  const wantPolish = resolveWantPolish(options.polish, n, k, DEFAULT_POLISH_ITERS);

  const { graph, finalMind } = ringGreedy(n, k, { mind, repair: true });

  let g: Graph = graph;
  let polished = false;
  if (wantPolish) {
    // polish returns the lowest penalized-ASPL graph it saw, never worse than its
    // input (disconnection is penalized, so a connected input stays connected) —
    // adopting it is always safe, exactly as buildConstrainedBuddyGraph trusts
    // polishConstrained.
    // FROM THE ARTIFACT, not from a counter, and not from the decision to call. Three versions
    // of this flag: the call site (true whenever polish was invoked), then `iters > 0` — and
    // `iters` counts loop PASSES, so `polish(ring(3))` reports 19,990 of them while returning the
    // triangle untouched, because no vertex-disjoint edge pair exists to propose. `changed` is
    // set where `best` is replaced, which needs a strict energy improvement, so `polished: true`
    // now implies the edge list differs from `{ polish: false }`.
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
    // Scored against the degree actually DELIVERED, not the one requested. The
    // demotion floor can hand back a uniformly smaller degree, and scoring that
    // graph against the requested k reports a large gap for one that is exactly
    // optimal for what it delivered — buildBuddyGraph(8, 6) returns a 3-regular
    // graph whose ASPL equals mooreLowerBounds(8, 3) exactly. `model.ts` already
    // scores the displayed quality this way; this aligns the library's own field.
    asplGap: asplGap(summary.aspl, n, degreeMax),
    polished,
    // Derived from the graph being RETURNED, not from the pre-polish target.
    // `ringGreedy` reports the separation it reached; polish then runs and is NOT
    // separation-aware, so the old value routinely over-advertised — for
    // buildBuddyGraph(16, 5) it claimed 3 while the returned graph had girth 3,
    // i.e. buddies two steps apart. Linking two people d apart closes a (d+1)
    // cycle, so the achieved separation is girth - 1.
    finalMinSeparation: Number.isFinite(gi) ? gi - 1 : finalMind,
    connected: summary.connected,
    largestComponentFraction: largestComponentFraction(g),
  };
}

export interface ConstrainedBuddyOptions {
  /**
   * ACCEPTED AND IGNORED on this path. The constrained completion always takes the
   * farthest legal partner rather than aiming at a target, so no value here can
   * change the output — see `choosePartner` in `constrainedGreedy.ts`, whose own
   * contract says the same. Kept for call-site compatibility with
   * {@link BuddyOptions}; removing it would be a breaking change.
   *
   * It previously documented "Default 5", which was doubly wrong: nothing applies a default
   * because nothing ACTS on the field — it is read here and passed to `constrainedGreedy`, which
   * ignores it — and stating a default invites a caller to believe passing 7 does something.
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
  /**
   * Fraction (0..1) of prior buddies preserved, or null when priors were never
   * WEIGHED — either because there were none, or because polish did not run at this
   * (n, k) and so nothing ever consulted them.
   *
   * The second case used to report a number, and the number was meaningless: above
   * roughly n≈190 at k=4 the auto-polish gate declines, `constrainedGreedy` never
   * looks at priors at all, and whatever fraction happened to survive was pure
   * coincidence. A caller reading "62% of prior buddies kept" could not tell that
   * from "priors were honoured to the tune of 62%". `null` already means "not
   * measured" on this field, so reusing it removes a misleading number rather than
   * adding a flag that has to be interpreted alongside it.
   */
  priorsKeptFraction: number | null;
  /** Plain-language reasons the input was refused (empty when generated). */
  refusals: string[];
}

/**
 * Result of {@link buildConstrainedBuddyGraph}. When `report.refusals` is
 * non-empty the input was refused: `edges` is empty, the metric fields are placeholders, and
 * `buddies` holds one EMPTY list per person — read `report` first, and note `buddies.length` is
 * therefore not a "did this succeed" test.
 *
 * `buddies.length === n` HOLDS ONLY FOR n THIS BUILDER COULD HAVE ACCEPTED, i.e. an integer in
 * [0, MAX_CONSTRAINED_N]; for anything larger it is 0. That is deliberate and the reasoning is
 * at `refusedResult`: allocating from an n the builder is refusing FOR being too large would
 * make a refusal cost more than a success, which is a denial-of-service gradient pointing the
 * wrong way. The condition is stated here because this docblock is the contract, and it
 * previously promised the indexing shape without it.
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
  // Hoisted out of the branch because the report needs it. `priorsKeptFraction` is only
  // meaningful when priors were ACCOUNTED FOR, and there are two ways that happens —
  // promoted to required edges, or weighed as a soft penalty by a polish pass that ran.
  // The full rule is at the `buildReport` call below; this only has to survive the branch.
  let priorWeight = 0;
  let priorsWeighed = false;
  if (resolveWantPolish(options.polish, n, k, DEFAULT_CONSTRAINED_POLISH_ITERS)) {
    // priorHard already promoted priors to required, so no soft penalty then.
    // Finiteness-checked HERE, not only inside `polishConstrained`. Both places used to
    // decide independently: the optimizer coerced a non-finite weight to 0 and never
    // weighed the priors, while the report tested the RAW value against `!== 0`, found
    // NaN !== 0 true, and published a `priorsKeptFraction` — the exact coincidental number
    // that field's contract says must be null. Resolving once means the optimizer and the
    // report cannot disagree about what was actually optimized.
    const requested = options.priorWeight ?? (active.priorCount > 0 ? DEFAULT_PRIOR_WEIGHT : 0);
    // The SAME predicate `polishConstrained` enforces, so this wrapper can never hand its callee
    // a value the callee throws on. Only finiteness was normalized here, so a NEGATIVE weight
    // passed straight through and `polishConstrained`'s new sign check threw out of the one entry
    // point whose documented contract is that it REFUSES rather than throws — and only at the
    // roster sizes where auto-polish happens to run, so the contract broke as a function of n.
    // Normalising to 0 rather than refusing is what this entry point does with a bad option
    // value generally — it refuses INPUTS, never options. The siblings reach the same outcome by
    // different routes, and the difference is worth naming rather than implying one rule: a
    // non-finite `polishIters` falls back to the default inside `boundedPolishIterations`, and
    // `minSeparation` is passed through to `constrainedGreedy`, which does not act on a
    // non-integer floor. Only `priorWeight` is normalised HERE, because only it is read twice
    // (by the optimizer and by the report) and they must not disagree.
    priorWeight =
      active.priorHard || !(Number.isFinite(requested) && requested >= 0) ? 0 : requested;
    // polishConstrained returns the lowest-energy graph it saw, never worse
    // than its input on the objective, so adopting it is always safe.
    // Normalised, not thrown, for the same reason `priorWeight` is: this entry point's contract
    // is to REFUSE (via `report.refusals`), so it must never hand `polishConstrained` a value
    // its `RNG` throws on. Polish is the only seed-dependent stage here, so unlike the fast
    // tier there is nothing outside this branch for the seed to affect.
    const requestedSeed = options.seed ?? 0;
    const res = polishConstrained(g, active, {
      seed: isSeed(requestedSeed) ? requestedSeed : 0,
      iters: options.polishIters,
      priorWeight,
    });
    g = res.graph;
    // TWO DIFFERENT FACTS, and they were one field for two rounds. `polished` describes the
    // OUTPUT — same correction as the fast tier — while `priorsKeptFraction` describes whether
    // the priors were ever WEIGHED, which a pass that took decisions and accepted none still did.
    // Collapsing them made a pass that changed nothing publish a fraction, and a pass that
    // weighed priors without improving report none.
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
    // report from the ORIGINAL cons (not active): reqViolations reflects the
    // caller's declared requireds, not priors promoted to required — safe because
    // the postconditions guarantee every active-required edge is present.
    // Whether priors were ACCOUNTED FOR at all, by either of the two mechanisms that
    // can do it: promoted to required edges (priorHard), or weighed as a soft penalty
    // by a polish pass that actually ran. Only the remaining case — polish declined at
    // this (n, k) and no promotion — leaves `priorsKeptFraction` measuring coincidence,
    // and that is the case it must report as null.
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
 * The caller decides WHETHER to polish; `boundedPolishIterations` decides how much work
 * that may cost. Before, honouring the instruction meant one boolean could
 * re-open the exact 33 s case this budget was introduced to close.
 *
 * The decision is modelled on the DEFAULT iteration budget, not on whatever the
 * caller passed. "Is this a configuration we auto-polish?" is a property of the
 * roster (n, k). Letting a small `polishIters` flip the gate on would tie a stable
 * contract to a tuning knob.
 */
// NOTE for anyone tempted to clamp iterations here: don't. `boundedPolishIterations` lives
// inside `polish` / `polishConstrained` because both are exported public API, so a clamp in this
// wrapper would not apply to a direct caller — which is exactly how `polish(ring(20), { maxIters:
// Infinity })` used to never return. This comment sits next to the gate it is about; it spent a
// round floating between two unrelated functions, describing code that is not there.
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

/**
 * Whether the default ("auto") path polishes this configuration — the gate itself,
 * exported, so a consumer never has to re-derive it.
 *
 * Polish is the only seed-dependent stage, so a UI that offers "give me a different
 * arrangement" has to know this to avoid promising variation it cannot deliver. The
 * app used to answer with its own `POLISH_MAX_N = 120` literal, which was correct
 * only at k=4: the real cutoff is k-dependent (146 at k=2, 131 at k=3, 120 at k=4,
 * 78 at k=12) and different again for the constrained builder. It disagreed with
 * this function in BOTH directions, and the disagreement reached users as a false
 * "this group is too large to shuffle".
 *
 * Exporting a number would have re-created the same problem one release later. The
 * gate is a function of (n, k, which builder), so the export is the function.
 */
/**
 * Whether `buildBuddyGraph` will generate this configuration rather than throw — the gate
 * itself, exported, the sibling of {@link autoPolishEnabled} and for the same reason.
 *
 * The app's pre-flight promised "you can generate this" for its whole advertised rectangle
 * (n <= 1000, k in [2, 12]) from its own constants, and that promise was true only because the
 * densest corner lands on `MAX_GREEDY_WORK` by exactly zero margin: `greedyWork(1000, 12)` is
 * 1.5e10 and the budget is 1.5e10. One constant edit in either package — a roster cap of 1001,
 * a buddy cap of 13, or a tightened budget here — would have had the UI enable Generate for a
 * configuration this package throws on, surfacing as a raw library string. That is the same
 * shape as the k-blind polish-cap literal `autoPolishEnabled` replaced above, and exporting the NUMBER
 * would recreate it one release later.
 *
 * Covers what is predictable BEFORE the run: the argument domain, the memory cap, and the work
 * budget. It cannot cover `repairDegrees`' runtime counter, which by construction only knows
 * what it has already spent — that path is bounded, not predicted, and says so.
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

export function autoPolishEnabled(
  n: number,
  k: number,
  opts: { constrained?: boolean } = {},
): boolean {
  return resolveWantPolish(
    "auto",
    n,
    k,
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
  priorsWeighed: boolean,
): ConstraintReport {
  let prohViolations = 0;
  for (const [a, b] of cons.prohibitedPairs()) if (g.hasEdge(a, b)) prohViolations++;
  let reqViolations = 0;
  for (const [a, b] of cons.requiredPairs()) if (!g.hasEdge(a, b)) reqViolations++;

  const priors = cons.priorPairs();
  const priorsKeptFraction =
    priorsWeighed && priors.length > 0 ? countPresentEdges(g, priors) / priors.length : null;

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
  //
  // Bounded by MAX_CONSTRAINED_N, not MAX_ROSTER. This builder cannot ACCEPT a
  // roster above 5000, so clamping the placeholder to MAX_ROSTER (1e6) meant
  // refusing an oversized roster allocated 200x more than accepting the largest
  // legal one — a refusal that costs more than success is a denial-of-service
  // gradient pointing the wrong way.
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

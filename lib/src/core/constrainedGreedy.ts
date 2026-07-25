/**
 * Constrained buddy-graph generation (algorithm B) plus constraint-preserving
 * polish. Both guarantee the hard constraints — required edges are present,
 * prohibited edges never are, and no vertex exceeds k buddies — while minimizing
 * average shortest path length, with an optional soft penalty that preserves
 * prior buddies across churn.
 *
 * `constrainedGreedy` is RNG-free and deterministic. `polishConstrained` uses
 * the seeded RNG, so it is reproducible within JS for a given seed. Validated
 * against the Python reference on invariants and aggregate metrics rather than
 * byte-for-byte structure.
 *
 * Unlike `ringGreedy`, completion has no `demote` step: when no partner sits at
 * least `minSeparation` away, `choosePartner` falls back to the farthest legal
 * partner available (even if closer than the target) instead of iteratively
 * shrinking the target (matches the reference).
 *
 * These are low-level primitives; the safe entry point is
 * `buildConstrainedBuddyGraph`, which runs `validate` first. Called directly
 * they throw a clear error on malformed input (out-of-range ids, bad k,
 * required-degree over k) but otherwise assume feasibility.
 */
import {
  Graph,
  DEFAULT_MIN_SEPARATION,
  MAX_CONSTRAINED_N,
  MAX_CONSTRAINED_WORK,
  constrainedWork,
} from "./graph.js";
import {
  bfsDistances,
  allPairsSummary,
  penalizedAspl,
  countPresentEdges,
  connectedComponents,
  UNREACHABLE,
} from "./metrics.js";
import { RNG } from "./rng.js";
import { Constraints } from "./constraints.js";
import { Swap, proposeSwap, applySwap, revertSwap } from "./swap.js";

// Unreachable vertices score as +infinity so completion prefers joining
// disconnected pieces before shortening already-connected ones.
const INFINITE_DISTANCE = 1e9;

/** True when u–v may legally be added: distinct, absent, allowed, both under k. */
type EdgePredicate = (u: number, v: number) => boolean;

interface Measured {
  energy: number;
  connected: boolean;
  /** Number of connected components — the quantity the fragmentation guard compares. */
  components: number;
}

export interface ConstrainedGreedyOptions {
  /** Separation to aim for during completion. Default 5, clamped to floor(n/2). */
  minSeparation?: number;
}

export interface PolishConstrainedOptions {
  /** Seed for the swap RNG (reproducible within JS). Default 0. */
  seed?: number;
  /** Iteration budget. Default 8000. */
  iters?: number;
  /** Soft penalty weight for keeping prior buddies. Default 0 (off). */
  priorWeight?: number;
}

/**
 * Lay required edges first (never removed), greedily complete toward degree k
 * while honoring prohibited pairs and a soft minimum-separation target, then
 * force-connect leftover components without exceeding k. Sacrifices regularity
 * and, when the degree budget won't allow it, connectivity — never a hard
 * constraint.
 */
export function constrainedGreedy(
  n: number,
  k: number,
  cons: Constraints,
  opts: ConstrainedGreedyOptions = {},
): Graph {
  checkWellFormed(n, k, cons);

  const g = new Graph(n);
  const legal = legalEdge(g, cons, k);

  for (const [a, b] of cons.requiredPairs()) g.addEdge(a, b);

  const minSep = Math.min(
    opts.minSeparation ?? DEFAULT_MIN_SEPARATION,
    Math.floor(n / 2),
  );

  // Most-deficient vertex connects to its farthest legal partner. A vertex with
  // no legal partner is skipped, not fatal — one stuck person must not starve
  // the rest. A stuck vertex stays stuck (completion only ever saturates
  // partners, never frees one), so we mark it once and never rescan it — that
  // is what keeps the loop from going cubic on many-stuck inputs.
  const stuck = new Uint8Array(n);
  // The real exits are below: no deficient vertices left, or extendOne finds no
  // legal edge. This cap is a defensive backstop that should never bind — at most
  // n*k/2 edges are ever added, so 6*n*k is comfortably above any real run.
  const completionCap = n * k * 6;
  for (let step = 0; step < completionCap; step++) {
    const under = deficientVertices(g, k, stuck);
    if (under.length === 0) break;
    if (!extendOne(g, under, legal, minSep, stuck)) break;
  }

  forceConnect(g, cons, k);

  assertHardConstraints(g, cons, "constrainedGreedy");
  assertWithinDegreeCap(g, k, "constrainedGreedy");
  return g;
}

/**
 * Constraint-preserving swap polish: degree-preserving double edge swaps that
 * never break a required edge, create a prohibited one, or leave the roster in more
 * pieces than it arrived in — keeping only strictly-improving moves. The objective
 * is ASPL (with a large disconnection penalty) plus an optional
 * prior-preservation penalty for churn. Returns just the graph — run-level
 * metrics (unlike `polish`'s `PolishResult`) come from the caller's report in
 * `buildConstrainedBuddyGraph`.
 */
export function polishConstrained(
  input: Graph,
  cons: Constraints,
  opts: PolishConstrainedOptions = {},
): Graph {
  checkConstraintIds(input.n, cons);

  const rng = new RNG(opts.seed ?? 0);
  const iters = opts.iters ?? 8000;
  const priorWeight = opts.priorWeight ?? 0;
  const measure = constrainedMeasure(cons, priorWeight);
  const breaksConstraint = (s: Swap) => swapBreaksConstraint(s, cons);

  const startDegrees = input.degrees();
  const g = input.copy();
  const start = measure(g);
  const startComponents = start.components;
  let current = start.energy;
  let best = g.copy();
  let bestEnergy = current;

  for (let it = 0; it < iters; it++) {
    const edges = g.edgeList();
    if (edges.length < 2) break;
    const swap = proposeSwap(g, edges, rng, breaksConstraint);
    if (swap === null) continue;

    applySwap(g, swap);
    const next = measure(g);
    // Never trade connectivity away, however large the prior weight. Stated as
    // "the roster must not end up in MORE pieces than it started in" rather than
    // "was connected and now is not": the old form left an ALREADY-disconnected
    // input entirely unguarded, so a big enough prior weight could buy further
    // fragmentation. penalizedAspl now charges for that too, but the prior term
    // is added on top of it and could still outweigh it — this guard is the part
    // that does not depend on relative weights.
    if (next.components > startComponents) {
      revertSwap(g, swap);
      continue;
    }
    if (next.energy < current - 1e-12) {
      current = next.energy;
      if (next.energy < bestEnergy) {
        bestEnergy = next.energy;
        best = g.copy();
      }
    } else {
      revertSwap(g, swap);
    }
  }

  assertHardConstraints(best, cons, "polishConstrained");
  assertDegreesPreserved(startDegrees, best, "polishConstrained");
  return best;
}

// --- generation helpers -----------------------------------------------------

function legalEdge(g: Graph, cons: Constraints, k: number): EdgePredicate {
  return (u, v) =>
    u !== v &&
    !g.hasEdge(u, v) &&
    !cons.isProhibited(u, v) &&
    g.degree(u) < k &&
    g.degree(v) < k;
}

/** Under-k, not-yet-stuck vertices, most-deficient first (degree, then index). */
function deficientVertices(g: Graph, k: number, stuck: Uint8Array): number[] {
  const under: number[] = [];
  for (let v = 0; v < g.n; v++) if (!stuck[v] && g.degree(v) < k) under.push(v);
  under.sort((a, b) => g.degree(a) - g.degree(b) || a - b);
  return under;
}

/**
 * Add one edge from the first vertex that has a legal partner. Vertices found to
 * have none are marked permanently stuck (see the invariant at the call site).
 */
function extendOne(
  g: Graph,
  under: number[],
  legal: EdgePredicate,
  minSep: number,
  stuck: Uint8Array,
): boolean {
  for (const u of under) {
    const candidates: number[] = [];
    for (let v = 0; v < g.n; v++) if (legal(u, v)) candidates.push(v);
    if (candidates.length === 0) {
      stuck[u] = 1;
      continue;
    }
    const dist = bfsDistances(g, u);
    g.addEdge(u, choosePartner(candidates, dist, g, minSep));
    return true;
  }
  return false;
}

/**
 * Prefer the farthest reachable (or unreachable) partner, then lower degree,
 * then lower index. Among that order, prefer partners at least `minSep` away,
 * falling back to the best available when none qualify.
 */
function choosePartner(
  candidates: number[],
  dist: Int32Array,
  g: Graph,
  minSep: number,
): number {
  const farness = (v: number) =>
    dist[v] !== UNREACHABLE ? dist[v] : INFINITE_DISTANCE;
  candidates.sort((a, b) => {
    const fa = farness(a);
    const fb = farness(b);
    if (fa !== fb) return fb - fa;
    const da = g.degree(a);
    const db = g.degree(b);
    if (da !== db) return da - db;
    return a - b;
  });
  for (const v of candidates) {
    if (dist[v] === UNREACHABLE || dist[v] >= minSep) return v;
  }
  return candidates[0];
}

/**
 * Force-connect leftover components under the degree cap: repeatedly add any legal
 * (non-prohibited, both-under-k) cross-component edge until one component remains
 * or no legal edge exists. Connectivity outranks girth and regularity, but never
 * exceed k. Residual disconnection is honest — the roster cannot be connected
 * within k buddies each, and it surfaces as report.connected.
 *
 * In practice this is an inert backstop: completion (above) exits only once every
 * under-k vertex is stuck — has no legal partner at all — and a stuck vertex never
 * regains one, so completion's output is legal-edge-maximal (no addable legal edge
 * remains, cross-component or otherwise) and this loop adds nothing. That
 * maximality is asserted as a property in constrained.props.test.ts. Retained for
 * parity with the reference and to keep the connectivity guarantee if completion's
 * termination is ever weakened.
 */
function forceConnect(g: Graph, cons: Constraints, k: number): void {
  const legal = legalEdge(g, cons, k); // same predicate as completion
  // At most n-1 joins are ever needed; each pass adds one edge or stops.
  for (let pass = 0; pass < g.n; pass++) {
    const comps = connectedComponents(g);
    if (comps.length <= 1) return;
    if (!joinAnyComponents(g, comps, legal)) return;
  }
}

/** Add one legal edge bridging two distinct components; true if one was added. */
function joinAnyComponents(
  g: Graph,
  comps: number[][],
  legal: EdgePredicate,
): boolean {
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      for (const u of comps[i]) {
        for (const v of comps[j]) {
          if (legal(u, v)) {
            g.addEdge(u, v);
            return true;
          }
        }
      }
    }
  }
  return false;
}

// --- polish helpers ---------------------------------------------------------

/** Objective + connectivity in one pass: ASPL, disconnection penalty, prior penalty. */
function constrainedMeasure(
  cons: Constraints,
  priorWeight: number,
): (g: Graph) => Measured {
  const priors = cons.priorPairs();
  const usePriorPenalty = priorWeight !== 0 && priors.length > 0;
  return (g) => {
    const summary = allPairsSummary(g);
    let energy = penalizedAspl(summary, g.n);
    if (usePriorPenalty) {
      energy += priorWeight * (priors.length - countPresentEdges(g, priors));
    }
    // The component count is what the fragmentation guard compares, and it is
    // O(n+m) beside the O(n·(n+m)) sweep just performed — free at this scale.
    return { energy, connected: summary.connected, components: connectedComponents(g).length };
  };
}

/** A swap is illegal when it would break a required edge or create a prohibited one. */
function swapBreaksConstraint(s: Swap, cons: Constraints): boolean {
  return (
    cons.isRequired(s.a, s.b) ||
    cons.isRequired(s.c, s.d) ||
    cons.isProhibited(s.x1, s.y1) ||
    cons.isProhibited(s.x2, s.y2)
  );
}

// --- preconditions (always-on) ----------------------------------------------
// These make the documented hard guarantees hold in production too, turning a
// direct-call contract violation into a clear error instead of a cryptic crash
// or a silent degree-cap breach. Cheap: O(#constraints), off the hot path.

// Throw-on-first mirror of constraints.ts `structuralReasons` (which collects
// reasons for validate); keep the two checks in step.
//
// "In step" means the CONTENT of the id check, not its precedence. `validateDetailed`
// returns structural reasons before it looks at the size/work caps, while
// `checkWellFormed` below checks the caps first and calls this afterwards — so an
// input that is both oversized AND structurally invalid gets a different FIRST
// diagnosis depending on which entry point is asked. Both diagnoses are true and
// both refuse; only the ordering differs, and it is stated here rather than left
// for a reader to infer from the word "mirror".
function checkConstraintIds(n: number, cons: Constraints): void {
  const outOfRange = (a: number, b: number) =>
    !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n;
  for (const [a, b] of [
    ...cons.requiredPairs(),
    ...cons.prohibitedPairs(),
    ...cons.priorPairs(),
  ]) {
    if (outOfRange(a, b)) {
      throw new Error(
        `constraint references person out of range (${a},${b}) for n=${n} — call validate() first`,
      );
    }
    if (a === b) {
      throw new Error(`person ${a} cannot be paired with themselves — call validate() first`);
    }
  }
}

function checkWellFormed(n: number, k: number, cons: Constraints): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`roster size ${n} is not a valid count — call validate() first`);
  }
  // O(n²) generation; refuse an oversized roster before the k-check, mirroring
  // validate's order (rationale on MAX_CONSTRAINED_N in graph.ts).
  if (n > MAX_CONSTRAINED_N) {
    throw new Error(
      `roster size ${n} exceeds the constrained maximum of ${MAX_CONSTRAINED_N} — call validate() first`,
    );
  }
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`k must be a non-negative integer, got ${k} — call validate() first`);
  }
  // Dense k blows generation up past the n-cap (see MAX_CONSTRAINED_WORK).
  if (constrainedWork(n, k) > MAX_CONSTRAINED_WORK) {
    throw new Error(
      `roster size ${n} with k=${k} is too large to generate in reasonable time — call validate() first`,
    );
  }
  checkConstraintIds(n, cons);
  const reqd = cons.requiredDegree();
  for (let v = 0; v < n; v++) {
    if (reqd[v] > k) {
      throw new Error(
        `person ${v} has ${reqd[v]} required buddies but k=${k} — call validate() first`,
      );
    }
  }
}

// --- postconditions (dev-mode only) -----------------------------------------
// Compiled out of production bundles where `process` is absent, so they never
// cost the hot path. NOTE: a new hard-constraint kind must be enforced in
// legalEdge (used by both completion and forceConnect), swapBreaksConstraint,
// AND asserted here — keep the three in sync. A genuinely new constraint
// *category* (not a new tag policy — those only emit required/prohibited pairs
// already handled) would also need reporting in index.ts buildReport.
const CONTRACTS_ENABLED =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

function assertHardConstraints(g: Graph, cons: Constraints, where: string): void {
  if (!CONTRACTS_ENABLED) return;
  for (const [a, b] of cons.prohibitedPairs()) {
    if (g.hasEdge(a, b)) {
      throw new Error(`${where}: prohibited edge ${a}–${b} present`);
    }
  }
  for (const [a, b] of cons.requiredPairs()) {
    if (!g.hasEdge(a, b)) {
      throw new Error(`${where}: required edge ${a}–${b} missing`);
    }
  }
}

function assertWithinDegreeCap(g: Graph, k: number, where: string): void {
  if (!CONTRACTS_ENABLED) return;
  for (let v = 0; v < g.n; v++) {
    if (g.degree(v) > k) {
      throw new Error(`${where}: degree of ${v} is ${g.degree(v)} > k=${k}`);
    }
  }
}

function assertDegreesPreserved(before: number[], after: Graph, where: string): void {
  if (!CONTRACTS_ENABLED) return;
  const now = after.degrees();
  for (let v = 0; v < now.length; v++) {
    if (now[v] !== before[v]) {
      throw new Error(`${where}: degree of ${v} changed ${before[v]}→${now[v]}`);
    }
  }
}

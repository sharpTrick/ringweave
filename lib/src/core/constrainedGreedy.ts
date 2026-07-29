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
 * Unlike `ringGreedy`, completion has no `demote` step and no separation target at
 * all: `choosePartner` always takes the farthest legal partner. `minSeparation` is
 * accepted on the options for call-site compatibility and cannot change the
 * output — see `choosePartner`.
 *
 * These are low-level primitives; the safe entry point is
 * `buildConstrainedBuddyGraph`, which runs `validate` first. Called directly
 * they throw a clear error on malformed input (out-of-range ids, bad k,
 * required-degree over k) but otherwise assume feasibility.
 */
import { Graph } from "./graph.js";
import {
  MAX_CONSTRAINED_N,
  MAX_CONSTRAINED_WORK,
  constrainedWork,
  boundedPolishIterations,
  checkPolishSize,
} from "./budgets.js";
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

// Unreachable vertices score as 1e9 — effectively infinity for graph distances,
// which never exceed n-1 — so completion prefers joining disconnected pieces
// before shortening already-connected ones. Not `Infinity` itself: this value is
// arithmetic on, and a real Infinity would make every comparison between two
// unreachable candidates a tie.
const INFINITE_DISTANCE = 1e9;

/** True when u–v may legally be added: distinct, absent, allowed, both under k. */
type EdgePredicate = (u: number, v: number) => boolean;

interface Measured {
  energy: number;
  connected: boolean;
  /** Number of connected components. */
  components: number;
  /** Size of the largest component. Count alone is too weak — see the guard. */
  largest: number;
}

export interface ConstrainedGreedyOptions {
  /**
   * ACCEPTED AND IGNORED. Completion maximises separation greedily rather than
   * aiming at a value, so this cannot change the output — see `choosePartner` for
   * the proof. Kept for call-site compatibility; removing it is a breaking change.
   */
  minSeparation?: number;
}

/**
 * Documented default iteration budget for the constrained pass. Exported for the
 * same reason as `DEFAULT_POLISH_ITERS`: the auto-polish gate in
 * `buildConstrainedBuddyGraph` models it, and two declarations cannot be kept in
 * step by hoping.
 */
export const DEFAULT_CONSTRAINED_POLISH_ITERS = 8000;

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
 * while honoring prohibited pairs and maximising separation greedily, then
 * force-connect leftover components without exceeding k. Sacrifices regularity
 * and, when the degree budget won't allow it, connectivity — never a hard
 * constraint.
 */
export function constrainedGreedy(
  n: number,
  k: number,
  cons: Constraints,
  // Accepted and unused: `minSeparation` is its only field and completion cannot
  // act on it (see `choosePartner`). Named with a leading underscore so the
  // unused-parameter rule confirms that rather than being suppressed.
  _opts: ConstrainedGreedyOptions = {},
): Graph {
  checkWellFormed(n, k, cons);

  const g = new Graph(n);
  const legal = legalEdge(g, cons, k);

  for (const [a, b] of cons.requiredPairs()) g.addEdge(a, b);

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
    if (!extendOne(g, under, legal, stuck)) break;
  }

  forceConnect(g, cons, k);
  // REWIRE, because adding is not enough — see `repairConnectivity`.
  repairConnectivity(g, cons, k);

  assertHardConstraints(g, cons, "constrainedGreedy");
  assertWithinDegreeCap(g, k, "constrainedGreedy");
  return g;
}

/**
 * Constraint-preserving swap polish: degree-preserving double edge swaps that
 * never break a required edge, create a prohibited one, or leave the roster in more
 * pieces than it arrived in — keeping only strictly-improving moves. The objective
 * is ASPL (with a large disconnection penalty) plus an optional
 * prior-preservation penalty for churn.
 *
 * Reports what it did alongside the graph. It used to return the graph alone, with a comment
 * saying run-level metrics come from the caller's report — and that was the hole: the caller
 * could only infer whether a pass had happened from its own decision to CALL, so `polishIters: 0`
 * produced `polished: true` over an untouched graph and a `priorsKeptFraction` measuring nothing.
 * A fact about what a pass did has to come from the pass.
 */
export interface PolishConstrainedResult {
  graph: Graph;
  /**
   * Accept/reject decisions actually taken — swaps proposed, applied and measured.
   *
   * Not the iteration BUDGET: the loop breaks immediately on a graph with fewer than two edges,
   * and an iteration that finds no legal swap weighs nothing. Both are cases where a budget of
   * 8,000 and a real count of 0 differ, and both are reachable without passing an option.
   *
   * NOT the same quantity as `PolishResult.iters`, which counts loop PASSES — an earlier version
   * of this comment claimed it was. What the priors gate needs is this one: a pass that took a
   * decision weighed the priors, whether or not any move was accepted.
   */
  decisions: number;
  /**
   * Whether the returned graph differs from the input — see `PolishResult.changed`, which this
   * mirrors. `decisions > 0` means the pass DID something; this means it CHANGED something, and
   * the two are different claims. `polished` is the second.
   */
  changed: boolean;
}

export function polishConstrained(
  input: Graph,
  cons: Constraints,
  opts: PolishConstrainedOptions = {},
): PolishConstrainedResult {
  checkConstraintIds(input.n, cons);
  // ALWAYS-ON, not a dev-mode postcondition. This pass only ever SWAPS edges, so it
  // cannot repair an input that already violates the constraints — yet the module header
  // promises both functions guarantee them. The only check was the postcondition at the
  // end, which is compiled out in production (so a violating input came back unflagged)
  // and in dev blamed this function for its caller's defect. A precondition names the
  // right culprit, and it is O(#constraints) — the same class as the id check above.
  checkInputSatisfiesConstraints(input, cons);

  const rng = new RNG(opts.seed ?? 0);
  // A size cap as well as the work cap below. `boundedPolishIterations` cannot
  // reach the all-pairs sweeps and graph copies this function pays outside its
  // loop, so `polishConstrained(ring(30000), cons, { iters: 0 })` — priced at zero
  // iterations — still ran for 48 s.
  // `degrees()` rather than `edgeList()`: the same m, without allocating m two-element arrays
  // and sorting them, so the REFUSAL path no longer pays O(m log m) time and O(m) memory for a
  // graph it is about to reject. `polish` already derives it this way.
  const m = input.degrees().reduce((a, b) => a + b, 0) / 2;
  checkPolishSize(input.n, m);
  // Bound the loop here, not in `buildConstrainedBuddyGraph`: this function is
  // exported public API and a wrapper clamp does not apply to a direct caller.
  const iters = boundedPolishIterations(input.n, m, opts.iters, DEFAULT_CONSTRAINED_POLISH_ITERS);
  // Finiteness-checked like `iters`, and for the same reason. A NaN weight
  // poisons every energy comparison — `next.energy < current` is false for all
  // NaN — so the pass ran its full iteration budget of O(n·m) re-measurements and
  // returned the input unchanged while reporting `polished: true`. Silent no-ops
  // are worse than refusals.
  // Sign-checked as well as finiteness-checked. `constrainedMeasure` subtracts
  // `priorWeight * priorsKept`, so a NEGATIVE weight makes breaking a prior an IMPROVEMENT —
  // the objective actively works against the option's stated purpose. This is the knob F9's
  // "preserve current buddies" toggle drives, so the inversion would arrive with a feature
  // whose whole point it reverses.
  if (opts.priorWeight !== undefined && !(Number.isFinite(opts.priorWeight) && opts.priorWeight >= 0)) {
    throw new Error(`prior weight ${opts.priorWeight} must be a non-negative finite number`);
  }
  const priorWeight = Number.isFinite(opts.priorWeight) ? (opts.priorWeight as number) : 0;
  const measure = constrainedMeasure(cons, priorWeight);
  const breaksConstraint = (s: Swap) => swapBreaksConstraint(s, cons);

  const startDegrees = input.degrees();
  const g = input.copy();
  const start = measure(g);
  const startComponents = start.components;
  const startLargest = start.largest;
  let current = start.energy;
  let best = g.copy();
  let bestEnergy = current;
  let changed = false;

  let decisions = 0;
  for (let it = 0; it < iters; it++) {
    const edges = g.edgeList();
    if (edges.length < 2) break;
    const swap = proposeSwap(g, edges, rng, breaksConstraint);
    if (swap === null) continue;

    applySwap(g, swap);
    const next = measure(g);
    decisions++;
    // Never trade connectivity away, however large the prior weight, and never
    // shrink the biggest group. BOTH quantities are needed: component count alone
    // is too weak, because a swap that splits the largest group while merging two
    // small ones leaves the count flat and passes — it was reachable at the
    // library's own DEFAULT_PRIOR_WEIGHT of 2. Largest-size alone is also too
    // weak, since splitting a small component leaves the largest untouched. The
    // two together are the same pair the unconstrained pass's property tests
    // assert, so both passes are now held to one invariant.
    //
    // This guard does not depend on relative weights, which is why it exists on
    // top of penalizedAspl's charge for unreachable pairs: the prior term is added
    // above that charge and could outweigh it.
    if (next.components > startComponents || next.largest < startLargest) {
      revertSwap(g, swap);
      continue;
    }
    if (next.energy < current - 1e-12) {
      current = next.energy;
      if (next.energy < bestEnergy) {
        bestEnergy = next.energy;
        best = g.copy();
        changed = true;
      }
    } else {
      revertSwap(g, swap);
    }
  }

  assertHardConstraints(best, cons, "polishConstrained");
  assertDegreesPreserved(startDegrees, best, "polishConstrained");
  return { graph: best, decisions, changed };
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
    g.addEdge(u, choosePartner(candidates, dist, g));
    return true;
  }
  return false;
}

/**
 * Prefer the farthest reachable (or unreachable) partner, then lower degree, then
 * lower index. Completion MAXIMISES separation greedily; it does not aim at a
 * target value.
 *
 * There used to be a second pass here that scanned for the first candidate at
 * least `minSeparation` away, "falling back to the best available when none qualify".
 * That scan was provably a no-op and it is deleted rather than kept as decoration:
 * candidates are sorted by farness DESCENDING, and unreachable sorts to the top
 * (INFINITE_DISTANCE), so `candidates[0]` is always the farthest. If it qualifies
 * the scan returns it immediately; if it does not, nothing else can either — it is
 * the maximum — and the fallback returns `candidates[0]` anyway. Every branch
 * returned the same vertex.
 *
 * Consequence, stated because it is a public option behaving as a no-op:
 * `minSeparation` cannot change the output of the constrained path. It is still
 * ACCEPTED on `ConstrainedGreedyOptions`/`ConstrainedBuddyOptions` so the app's
 * existing call does not break, and both are documented as ignoring it. Removing
 * it from the public surface is a breaking change and a tracked follow-on.
 */
function choosePartner(candidates: number[], dist: Int32Array, g: Graph): number {
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
/**
 * Join components by ADDING a legal cross-component edge, while both endpoints are under k.
 *
 * This used to be the last word on connectivity, and its comment said residual disconnection
 * "means the roster cannot be connected within k buddies each" — a claim about the caller's
 * input that was really a limit of this function. `repairConnectivity` runs after it and can
 * rewire; what survives BOTH is disconnection no single constraint-preserving double edge swap
 * can remove.
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

/**
 * Edges whose removal disconnects their component, keyed as `min * n + max`.
 *
 * Needed because a double edge swap between two components merges them IFF at least one of the
 * two dropped edges is NOT a bridge. If both are bridges, dropping them splits both components
 * and the two new edges reconnect the halves crosswise into two pieces again — the count does
 * not fall. That makes this an exact test, so the repair never applies a swap speculatively and
 * measures afterwards.
 *
 * Iterative Tarjan. Bridges are a property of the GRAPH, not of the traversal, so the adjacency
 * `Set`'s insertion order cannot make this differ from the Python mirror.
 */
function bridges(g: Graph): Set<number> {
  const disc = new Int32Array(g.n).fill(-1);
  const low = new Int32Array(g.n);
  const out = new Set<number>();
  let timer = 0;
  for (let root = 0; root < g.n; root++) {
    if (disc[root] !== -1) continue;
    disc[root] = low[root] = timer++;
    const stack: { u: number; parent: number; nbrs: number[]; at: number }[] = [
      { u: root, parent: -1, nbrs: [...g.adj[root]], at: 0 },
    ];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.at < top.nbrs.length) {
        const w = top.nbrs[top.at++];
        if (w === top.parent) continue;
        if (disc[w] === -1) {
          disc[w] = low[w] = timer++;
          stack.push({ u: w, parent: top.u, nbrs: [...g.adj[w]], at: 0 });
        } else if (disc[w] < low[top.u]) {
          low[top.u] = disc[w];
        }
        continue;
      }
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent !== undefined) {
        if (low[top.u] < low[parent.u]) low[parent.u] = low[top.u];
        if (low[top.u] > disc[parent.u]) out.add(edgeKey(g.n, parent.u, top.u));
      }
    }
  }
  return out;
}

function edgeKey(n: number, a: number, b: number): number {
  return a < b ? a * n + b : b * n + a;
}

/**
 * Merge components with degree-preserving, constraint-preserving double edge swaps.
 *
 * `joinAnyComponents` needs BOTH endpoints under k, so a component whose whole boundary is
 * saturated cannot be joined however many legal pairs exist elsewhere — and the comment that
 * used to sit at the end of this generator claimed residual disconnection "means the roster
 * cannot be connected within k buddies each", which is false. Witness: n=7, k=2, prohibiting
 * (3,5) and (3,4). `validate` accepts it, completion leaves {0,1,2,3,6} and {4,5} with every
 * vertex at its degree cap, and the 7-cycle 0-1-2-3-6-4-5-0 is a connected graph at the same k
 * under the same prohibitions — one double edge swap away. A swap reaches it where an addition
 * cannot, because it frees the degree it spends.
 *
 * Deterministic and RNG-free like the rest of this generator: components are visited in
 * ascending-minimum-vertex order (`connectedComponents` scans vertices ascending) and edges in
 * `edgeList()`'s sorted order, so the first legal rewiring is a function of the graph alone.
 *
 * BOUNDED, and the bound is part of the contract. Each pass costs O(n + m) for the
 * component/bridge scan plus at most the remaining candidate-pair budget, which is charged
 * across the WHOLE repair so a pathological input cannot make this quadratic in m. If the budget
 * runs out the graph is returned as it stands, and residual disconnection then means "no legal
 * rewiring was found within the budget" — which is what this says, rather than a claim about the
 * roster the caller supplied.
 */
function repairConnectivity(g: Graph, cons: Constraints, k: number): void {
  void k; // degrees are PRESERVED by a swap, so the cap needs no re-check here
  let budget = 8 * (g.n + 2 * g.numEdges()) + 64;
  for (let pass = 0; pass < g.n; pass++) {
    const comps = connectedComponents(g);
    if (comps.length <= 1) return;
    const spent = swapJoin(g, comps, cons, bridges(g), budget);
    if (spent === null) return;
    budget = spent;
  }
}

/** One merging swap, or null when none was found (or the budget ran out). Returns what is left. */
function swapJoin(
  g: Graph,
  comps: number[][],
  cons: Constraints,
  bridged: Set<number>,
  budget: number,
): number | null {
  const owner = new Int32Array(g.n);
  comps.forEach((comp, ci) => comp.forEach((v) => { owner[v] = ci; }));
  const per: [number, number][][] = comps.map(() => []);
  for (const [a, b] of g.edgeList()) per[owner[a]].push([a, b]);
  let left = budget;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      for (const [a, b] of per[i]) {
        if (cons.isRequired(a, b)) continue;
        for (const [c, d] of per[j]) {
          if (cons.isRequired(c, d)) continue;
          if (left <= 0) return null;
          left--;
          if (bridged.has(edgeKey(g.n, a, b)) && bridged.has(edgeKey(g.n, c, d))) continue;
          for (const [x, y] of [[c, d], [d, c]] as const) {
            if (a === x || b === y) continue;
            if (g.hasEdge(a, x) || g.hasEdge(b, y)) continue;
            if (cons.isProhibited(a, x) || cons.isProhibited(b, y)) continue;
            g.removeEdge(a, b);
            g.removeEdge(c, d);
            g.addEdge(a, x);
            g.addEdge(b, y);
            return left;
          }
        }
      }
    }
  }
  return null;
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
    // Both quantities come from one O(n+m) walk, beside the O(n·(n+m)) sweep just
    // performed — free at this scale.
    const comps = connectedComponents(g);
    let largest = 0;
    for (const c of comps) if (c.length > largest) largest = c.length;
    return { energy, connected: summary.connected, components: comps.length, largest };
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
/**
 * The hard constraints must already hold on the graph handed to a swap-only pass.
 *
 * (The mirroring note that used to sit here belongs to `checkConstraintIds` below, which checks
 * constraint STRUCTURE against the Python reference; this one checks graph STATE and has no
 * Python counterpart, because the Python port has no equivalent precondition.)
 */
function checkInputSatisfiesConstraints(g: Graph, cons: Constraints): void {
  for (const [a, b] of cons.requiredPairs()) {
    if (!g.hasEdge(a, b)) {
      throw new Error(
        `polishConstrained was given a graph missing required pair (${a},${b}) — it only swaps ` +
          `edges and cannot add one; build with constrainedGreedy first`,
      );
    }
  }
  for (const [a, b] of cons.prohibitedPairs()) {
    if (g.hasEdge(a, b)) {
      throw new Error(
        `polishConstrained was given a graph containing prohibited pair (${a},${b}) — it only ` +
          `swaps edges and cannot remove one safely; build with constrainedGreedy first`,
      );
    }
  }
}

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
  // AFTER the validity check, deliberately: `NaN !== NaN` is true, so checking the
  // disagreement first reported "roster size NaN does not match the constraints (built for
  // NaN)" — technically accurate and useless, when the real problem is that NaN is not a
  // count. Order the messages so the most fundamental fault is the one named.
  //
  // The disagreement itself: endpoints were validated against the parameter `n` while the
  // required-degree vector came from `cons.requiredDegree()`, sized by `cons.n`. With
  // cons.n < n the vector had holes at exactly the vertices being checked, `undefined > k`
  // was false, and the documented "required-degree over k" refusal never fired — so this
  // returned a graph exceeding k, in production, with the dev-mode postcondition compiled
  // out. `Constraints.merge` and `buildConstrainedBuddyGraph` already enforce the rule; this
  // primitive was the one public entry point that did not.
  // The required/prohibited OVERLAP, checked here rather than only by the dev-mode
  // postcondition. `legalEdge` refuses prohibited pairs, but required edges are laid down
  // BEFORE it runs, so a pair that is both goes straight into the graph — and the only thing
  // that caught it was `assertHardConstraints`, which is compiled out when NODE_ENV is
  // "production". The library's headline guarantee ("prohibited edges never are") was therefore
  // enforced only in development. `validate` refuses this input; the primitive now throws for
  // the same reason, which is the split the module header already documents.
  for (const [a, b] of cons.requiredPairs()) {
    if (cons.isProhibited(a, b)) {
      throw new Error(
        `pair ${a}-${b} is both required and prohibited — call validate() first`,
      );
    }
  }
  if (n !== cons.n) {
    throw new Error(
      `roster size ${n} does not match the constraints (built for ${cons.n}) — call validate() first`,
    );
  }
  // O(n²) generation; refuse an oversized roster before the k-check, mirroring
  // validate's order (rationale on MAX_CONSTRAINED_N in budgets.ts).
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

/**
 * Constrained buddy-graph generation (algorithm B) plus constraint-preserving polish. Both
 * guarantee the hard constraints: required edges present, prohibited edges absent, no vertex
 * above k.
 *
 * `constrainedGreedy` is RNG-free; `polishConstrained` uses only the seeded RNG — keep it that
 * way, or the determinism contract breaks.
 *
 * Python-first: change `reference-python/` and regenerate fixtures before touching these
 * algorithms, or the oracle silently stops being an oracle.
 *
 * Low-level primitives: the safe entry point is `buildConstrainedBuddyGraph`, which runs
 * `validate` first. Called directly they throw on malformed input but otherwise assume
 * feasibility.
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

// Not `Infinity`: this value is arithmetic on, and a real Infinity would make every comparison
// between two unreachable candidates a tie. 1e9 beats any real distance (which never exceeds n-1).
const INFINITE_DISTANCE = 1e9;

/** True when u–v may legally be added: distinct, absent, allowed, both under k. */
type EdgePredicate = (u: number, v: number) => boolean;

interface Measured {
  energy: number;
  connected: boolean;
  components: number;
  /** Size of the largest component — the swap guard needs it as well as `components`. */
  largest: number;
}

export interface ConstrainedGreedyOptions {
  /**
   * Accepted and IGNORED: completion always takes the farthest legal partner, so this cannot
   * change the output (see `choosePartner`). Kept because removing it is a breaking change.
   */
  minSeparation?: number;
}

/**
 * Default iteration budget. Exported because the auto-polish gate in
 * `buildConstrainedBuddyGraph` models this value; the two cannot be kept in step by hoping.
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
 * Lay required edges first (never removed), greedily complete toward degree k while honoring
 * prohibited pairs, then connect leftover components without exceeding k. Sacrifices regularity
 * and, when the degree budget won't allow it, connectivity — never a hard constraint.
 */
export function constrainedGreedy(
  n: number,
  k: number,
  cons: Constraints,
  _opts: ConstrainedGreedyOptions = {},
): Graph {
  checkWellFormed(n, k, cons);

  const g = new Graph(n);
  const legal = legalEdge(g, cons, k);

  for (const [a, b] of cons.requiredPairs()) g.addEdge(a, b);

  // Completion only ever saturates partners, never frees one, so a stuck vertex stays stuck:
  // marking it once and never rescanning is what keeps this loop from going cubic.
  const stuck = new Uint8Array(n);
  // A backstop that should never bind — the real exits are the two breaks below.
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
 * What a `polishConstrained` pass did, reported by the pass — a caller cannot infer it from its
 * own decision to call.
 */
export interface PolishConstrainedResult {
  graph: Graph;
  /**
   * Accept/reject decisions actually taken, NOT the iteration budget and not `PolishResult.iters`
   * (which counts loop passes): 0 is reachable without passing an option.
   */
  decisions: number;
  /** Whether the graph CHANGED, which `decisions > 0` (the pass DID something) does not imply. */
  changed: boolean;
}

/**
 * Constraint-preserving swap polish: degree-preserving double edge swaps that never break a
 * required edge, create a prohibited one, or leave the roster in more pieces than it arrived in.
 * Keeps only strictly-improving moves; objective is ASPL plus an optional prior-preservation
 * penalty.
 */
export function polishConstrained(
  input: Graph,
  cons: Constraints,
  opts: PolishConstrainedOptions = {},
): PolishConstrainedResult {
  checkConstraintIds(input.n, cons);
  // A PRECONDITION, not the dev-mode postcondition below: this pass only swaps, so it cannot
  // repair a violating input, and the postcondition is compiled out in production (where such an
  // input came back unflagged) and blames this function for its caller's defect in dev.
  checkInputSatisfiesConstraints(input, cons);

  const rng = new RNG(opts.seed ?? 0);
  // `degrees()` rather than `edgeList()`, so the REFUSAL path below does not pay O(m log m) time
  // and O(m) memory for a graph it is about to reject.
  const m = input.degrees().reduce((a, b) => a + b, 0) / 2;
  // NaN poisons every energy comparison (`next.energy < current` is false for all NaN), so the
  // pass would burn its whole budget and report success over an untouched graph; a NEGATIVE
  // weight makes breaking a prior an improvement, inverting the option it implements.
  if (opts.priorWeight !== undefined && !(Number.isFinite(opts.priorWeight) && opts.priorWeight >= 0)) {
    throw new Error(`prior weight ${opts.priorWeight} must be a non-negative finite number`);
  }
  const priorWeight = Number.isFinite(opts.priorWeight) ? (opts.priorWeight as number) : 0;
  // The gates below need the RESOLVED weight: re-counting priors every measurement is a third
  // cost dimension, and at weight 0 the penalty is never built, so it is charged nothing.
  const weighedPriors = priorWeight === 0 ? 0 : cons.priorCount;
  // A size cap as well as the work cap: `boundedPolishIterations` cannot reach the all-pairs
  // sweeps and graph copies paid outside the loop, so even `iters: 0` is not free.
  checkPolishSize(input.n, m, weighedPriors);
  // Bound the loop here, not in `buildConstrainedBuddyGraph`: this is public API and a wrapper
  // clamp does not apply to a direct caller.
  const iters = boundedPolishIterations(
    input.n,
    m,
    weighedPriors,
    opts.iters,
    DEFAULT_CONSTRAINED_POLISH_ITERS,
  );
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
    // BOTH quantities: component count alone passes a swap that splits the largest group while
    // merging two small ones; largest-size alone misses a small component splitting. Needed on
    // top of `penalizedAspl`'s unreachable-pair charge because the prior term is added above it
    // and can outweigh it.
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
 * Add one edge from the first vertex that has a legal partner. A vertex with none is marked
 * permanently stuck, not treated as fatal — one stuck person must not starve the rest.
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
 * Farthest reachable-or-unreachable partner, then lower degree, then lower index. Completion
 * MAXIMISES separation; it never aims at a target, which is why `minSeparation` cannot change
 * the output of the constrained path.
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
 * Join components by ADDING a legal cross-component edge, both endpoints under k.
 *
 * Inert in practice — completion already leaves no addable legal edge (asserted in
 * constrained.props.test.ts). Kept for parity with the reference and in case completion's
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

/**
 * Edges whose removal disconnects their component, keyed as `min * n + max`.
 *
 * A double edge swap merges two components IFF at least one dropped edge is NOT a bridge — with
 * two bridges the new edges reconnect the halves crosswise and the count does not fall. Exact,
 * so the repair never swaps speculatively and measures afterwards.
 *
 * Bridges are a property of the GRAPH, not the traversal, so adjacency `Set` insertion order
 * cannot make this differ from the Python mirror.
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
 * Merge components by REWIRING: a degree-preserving double edge swap (`swapJoin`) first, then a
 * single-degree relocation (`stealSlot`). Addition alone cannot reach a component whose whole
 * boundary is saturated, though such a component is often one swap away — a swap frees the
 * degree it spends.
 *
 * RNG-free and insertion-order independent: components ascending, edges in `edgeList()`'s sorted
 * order, so the first legal rewiring is a function of the graph alone.
 *
 * Budget-bounded, and that is part of the contract: residual disconnection means "no legal
 * rewiring found within the budget", not that the roster is infeasible at k.
 */
function repairConnectivity(g: Graph, cons: Constraints, k: number): void {
  // A SHARED cell, so a failed search cannot hand the next one a budget it has already spent.
  const budget = { left: 8 * (g.n + 2 * g.numEdges()) + 64 };
  for (let pass = 0; pass < g.n; pass++) {
    const comps = connectedComponents(g);
    if (comps.length <= 1) return;
    const bridged = bridges(g);
    if (swapJoin(g, comps, cons, bridged, budget)) continue;
    // Second because it MOVES a degree, the larger concession; reached only when the swap fails.
    if (!stealSlot(g, comps, cons, bridged, k, budget)) return;
  }
}

/** Edges of the graph bucketed by the component their lower endpoint belongs to. */
function edgesByComponent(g: Graph, comps: number[][]): [number, number][][] {
  const owner = new Int32Array(g.n);
  comps.forEach((comp, ci) => comp.forEach((v) => { owner[v] = ci; }));
  const per: [number, number][][] = comps.map(() => []);
  for (const [a, b] of g.edgeList()) per[owner[a]].push([a, b]);
  return per;
}

/** True when one merging swap was applied; false when none was found or the budget ran out. */
function swapJoin(
  g: Graph,
  comps: number[][],
  cons: Constraints,
  bridged: Set<number>,
  budget: { left: number },
): boolean {
  const per = edgesByComponent(g, comps);
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      for (const [a, b] of per[i]) {
        if (cons.isRequired(a, b)) continue;
        for (const [c, d] of per[j]) {
          if (cons.isRequired(c, d)) continue;
          if (budget.left <= 0) return false;
          budget.left--;
          if (bridged.has(edgeKey(g.n, a, b)) && bridged.has(edgeKey(g.n, c, d))) continue;
          for (const [x, y] of [[c, d], [d, c]] as const) {
            if (a === x || b === y) continue;
            if (g.hasEdge(a, x) || g.hasEdge(b, y)) continue;
            if (cons.isProhibited(a, x) || cons.isProhibited(b, y)) continue;
            g.removeEdge(a, b);
            g.removeEdge(c, d);
            g.addEdge(a, x);
            g.addEdge(b, y);
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Join two components by MOVING a degree: drop a non-bridge edge (a,b) in one component and spend
 * the freed slot on an under-k vertex u in another.
 *
 * Exists because a swap needs a droppable edge in EACH component. Witness: n=4, k=2, prohibiting
 * (1,3) and (2,3) — completion builds triangle 0-1-2 and strands person 3, which no swap can
 * reach, yet `0-1, 0-3, 1-2` is connected at the same k under the same prohibitions.
 *
 * Dropping a NON-BRIDGE keeps a and b connected, so the only component change is the merge.
 * RNG-free: components, vertices and edges all scanned in ascending order.
 */
function stealSlot(
  g: Graph,
  comps: number[][],
  cons: Constraints,
  bridged: Set<number>,
  k: number,
  budget: { left: number },
): boolean {
  const per = edgesByComponent(g, comps);
  for (let i = 0; i < comps.length; i++) {
    for (const u of [...comps[i]].sort((a, b) => a - b)) {
      if (g.degree(u) >= k) continue;
      for (let j = 0; j < comps.length; j++) {
        if (j === i) continue;
        for (const [a, b] of per[j]) {
          if (cons.isRequired(a, b) || bridged.has(edgeKey(g.n, a, b))) continue;
          if (budget.left <= 0) return false;
          budget.left--;
          for (const keep of [a, b]) {
            if (cons.isProhibited(u, keep) || g.hasEdge(u, keep)) continue;
            g.removeEdge(a, b);
            g.addEdge(u, keep);
            return true;
          }
        }
      }
    }
  }
  return false;
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
// Always-on so the documented hard guarantees hold in production too, where the postconditions
// below are compiled out. O(#constraints), off the hot path.

/** The hard constraints must already hold on the graph handed to a swap-only pass. */
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

/**
 * Throw-on-first mirror of `structuralReasons` in constraints.ts and of `_structural_errors` in
 * reference-python; keep the three in step (content, not precedence — the entry points differ in
 * which fault they name first).
 */
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
  // Required∩prohibited, checked here and not only by the dev-mode postcondition: required edges
  // are laid down BEFORE `legalEdge` runs, so in production such a pair reaches the graph
  // unflagged and the headline "prohibited edges never are" guarantee fails.
  for (const [a, b] of cons.requiredPairs()) {
    if (cons.isProhibited(a, b)) {
      throw new Error(
        `pair ${a}-${b} is both required and prohibited — call validate() first`,
      );
    }
  }
  // After the n-validity check, deliberately: `NaN !== NaN`, so checking the mismatch first
  // reports "roster size NaN does not match the constraints (built for NaN)" and buries the fault.
  if (n !== cons.n) {
    throw new Error(
      `roster size ${n} does not match the constraints (built for ${cons.n}) — call validate() first`,
    );
  }
  // Before the k-check, mirroring `validateDetailed`'s order (rationale in budgets.ts).
  if (n > MAX_CONSTRAINED_N) {
    throw new Error(
      `roster size ${n} exceeds the constrained maximum of ${MAX_CONSTRAINED_N} — call validate() first`,
    );
  }
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`k must be a non-negative integer, got ${k} — call validate() first`);
  }
  // Dense k blows generation up past the n-cap (see MAX_CONSTRAINED_WORK).
  if (constrainedWork(n, k, cons.prohibitedCount) > MAX_CONSTRAINED_WORK) {
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
// Compiled out of production bundles where `process` is absent.
//
// A new hard-constraint KIND must be enforced at every edge-touching site — `legalEdge`,
// `swapBreaksConstraint`, `swapJoin`, `stealSlot` — AND asserted here; `test/constraintSync.test.ts`
// reads this file and fails when they stop agreeing. A new constraint CATEGORY also needs
// reporting in index.ts `buildReport`.
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

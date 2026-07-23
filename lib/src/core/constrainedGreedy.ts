/**
 * Constrained buddy-graph generation (algorithm B) plus constraint-preserving
 * polish. Both guarantee the hard constraints — required edges are present,
 * prohibited edges never are — while minimizing average shortest path length,
 * with an optional soft penalty that preserves prior buddies across churn.
 *
 * `constrainedGreedy` is RNG-free and deterministic. `polishConstrained` uses
 * the seeded RNG, so it is reproducible within JS for a given seed. Validated
 * against the Python reference on invariants and aggregate metrics rather than
 * byte-for-byte structure.
 */
import { Graph } from "./graph.js";
import { bfsDistances, allPairsSummary } from "./metrics.js";
import { RNG } from "./rng.js";
import { Constraints, pairKey } from "./constraints.js";
import { Swap, proposeSwap, applySwap, revertSwap } from "./swap.js";

const UNREACHABLE = -1;
const NO_VERTEX = -1;

// Unreachable vertices score as +infinity so completion prefers joining
// disconnected pieces before shortening already-connected ones.
const INFINITE_DISTANCE = 1e9;

/** True when u–v may legally be added: distinct, absent, allowed, both under k. */
type EdgePredicate = (u: number, v: number) => boolean;

/** The scalar objective `polishConstrained` minimizes over a graph. */
type Objective = (g: Graph) => number;

export interface ConstrainedGreedyOptions {
  minSeparation?: number;
}

export interface PolishConstrainedOptions {
  seed?: number;
  iters?: number;
  priorWeight?: number;
}

/**
 * Lay required edges first (never removed), greedily complete toward degree k
 * while honoring prohibited pairs and a soft minimum-separation target, then
 * force-connect any leftover components. Sacrifices regularity, never a hard
 * constraint.
 */
export function constrainedGreedy(
  n: number,
  k: number,
  cons: Constraints,
  opts: ConstrainedGreedyOptions = {},
): Graph {
  const g = new Graph(n);
  const legal = legalEdge(g, cons.prohibited, k);

  for (const [a, b] of cons.requiredPairs()) g.addEdge(a, b);

  const minSep = Math.min(opts.minSeparation ?? 5, Math.floor(n / 2));

  // Each iteration adds one new edge, so a feasible completion needs far fewer
  // than n*k*6 steps; this is a safety bound that cannot be reached on valid
  // input. If it ever were, forceConnect still guarantees connectivity and only
  // degree regularity would be at risk.
  const completionCap = n * k * 6;
  for (let step = 0; step < completionCap; step++) {
    const u = mostDeficient(g, k);
    if (u === NO_VERTEX) break;
    const dist = bfsDistances(g, u);
    const candidates: number[] = [];
    for (let v = 0; v < n; v++) if (legal(u, v)) candidates.push(v);
    if (candidates.length === 0) break;
    g.addEdge(u, choosePartner(candidates, dist, g, minSep));
  }

  forceConnect(g, cons.prohibited);

  assertHardConstraints(g, cons, "constrainedGreedy");
  return g;
}

/**
 * Constraint-preserving swap polish: degree-preserving double edge swaps that
 * never break a required edge nor create a prohibited one, keeping only
 * strictly-improving moves. The objective is ASPL (with a large disconnection
 * penalty) plus an optional prior-preservation penalty for churn.
 */
export function polishConstrained(
  input: Graph,
  cons: Constraints,
  opts: PolishConstrainedOptions = {},
): Graph {
  const rng = new RNG(opts.seed ?? 0);
  const iters = opts.iters ?? 8000;
  const priorWeight = opts.priorWeight ?? 0;
  const energy = constrainedEnergy(cons, priorWeight);
  const breaksConstraint = (s: Swap) => swapBreaksConstraint(s, cons);

  const startDegrees = input.degrees();
  const g = input.copy();
  let current = energy(g);
  let best = g.copy();
  let bestEnergy = current;

  for (let it = 0; it < iters; it++) {
    const edges = g.edgeList();
    if (edges.length < 2) break;
    const swap = proposeSwap(g, edges, rng, breaksConstraint);
    if (swap === null) continue;

    applySwap(g, swap);
    const next = energy(g);
    if (next < current - 1e-12) {
      current = next;
      if (next < bestEnergy) {
        bestEnergy = next;
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

function legalEdge(g: Graph, prohibited: Set<string>, k: number): EdgePredicate {
  return (u, v) =>
    u !== v &&
    !g.hasEdge(u, v) &&
    !prohibited.has(pairKey(u, v)) &&
    g.degree(u) < k &&
    g.degree(v) < k;
}

/** Lowest-degree under-k vertex, ties broken by lowest index; NO_VERTEX if none. */
function mostDeficient(g: Graph, k: number): number {
  let best = NO_VERTEX;
  let bestDegree = Infinity;
  for (let v = 0; v < g.n; v++) {
    const d = g.degree(v);
    if (d < k && d < bestDegree) {
      bestDegree = d;
      best = v;
    }
  }
  return best;
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

/** Connect leftover components; connectivity outranks girth and regularity. */
function forceConnect(g: Graph, prohibited: Set<string>): void {
  const comps = components(g);
  if (comps.length <= 1) return;
  let main = comps[0];
  for (let i = 1; i < comps.length; i++) {
    const comp = comps[i];
    joinComponents(g, main, comp, prohibited);
    // Merge unconditionally: even when every main×comp pair is prohibited, comp
    // still becomes reachable-target territory for a later component to attach
    // to (a graceful degradation, not a lost component).
    main = main.concat(comp);
  }
}

function joinComponents(
  g: Graph,
  main: number[],
  comp: number[],
  prohibited: Set<string>,
): boolean {
  for (const u of main) {
    for (const v of comp) {
      if (!prohibited.has(pairKey(u, v)) && !g.hasEdge(u, v)) {
        g.addEdge(u, v);
        return true;
      }
    }
  }
  return false;
}

function components(g: Graph): number[][] {
  const seen = new Uint8Array(g.n);
  const comps: number[][] = [];
  for (let s = 0; s < g.n; s++) {
    if (seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    const comp: number[] = [];
    while (stack.length > 0) {
      const u = stack.pop() as number;
      comp.push(u);
      for (const w of g.adj[u]) {
        if (!seen[w]) {
          seen[w] = 1;
          stack.push(w);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

// --- polish helpers ---------------------------------------------------------

/** Objective: ASPL, a heavy penalty when disconnected, plus a prior penalty. */
function constrainedEnergy(cons: Constraints, priorWeight: number): Objective {
  const priors = cons.priorPairs();
  const usePriorPenalty = priorWeight !== 0 && priors.length > 0;
  return (g) => {
    const { aspl, connected } = allPairsSummary(g);
    let e = connected ? aspl : aspl + 10 * g.n;
    if (usePriorPenalty) {
      let kept = 0;
      for (const [a, b] of priors) if (g.hasEdge(a, b)) kept++;
      e += priorWeight * (priors.length - kept);
    }
    return e;
  };
}

/** A swap is illegal when it would break a required edge or create a prohibited one. */
function swapBreaksConstraint(s: Swap, cons: Constraints): boolean {
  return (
    cons.required.has(pairKey(s.a, s.b)) ||
    cons.required.has(pairKey(s.c, s.d)) ||
    cons.prohibited.has(pairKey(s.x1, s.y1)) ||
    cons.prohibited.has(pairKey(s.x2, s.y2))
  );
}

// --- contracts (dev-mode only) ----------------------------------------------

// Postcondition checks run under test/dev but are compiled out of production
// bundles where `process` is absent, so they never cost the hot path.
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

function assertDegreesPreserved(before: number[], after: Graph, where: string): void {
  if (!CONTRACTS_ENABLED) return;
  const now = after.degrees();
  for (let v = 0; v < now.length; v++) {
    if (now[v] !== before[v]) {
      throw new Error(`${where}: degree of ${v} changed ${before[v]}→${now[v]}`);
    }
  }
}

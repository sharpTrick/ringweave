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
 * least `minSeparation` away, `choosePartner` falls back to the closest legal
 * partner instead of iteratively shrinking the target (matches the reference).
 *
 * Callers that skip `buildConstrainedBuddyGraph` must run `validate` first —
 * these functions assume well-formed, feasible input (checked only in dev mode).
 */
import { Graph } from "./graph.js";
import {
  bfsDistances,
  allPairsSummary,
  penalizedAspl,
  countPresentEdges,
} from "./metrics.js";
import { RNG } from "./rng.js";
import { Constraints } from "./constraints.js";
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
  assertWellFormed(n, k, cons);

  const g = new Graph(n);
  const legal = legalEdge(g, cons, k);

  for (const [a, b] of cons.requiredPairs()) g.addEdge(a, b);

  const minSep = Math.min(opts.minSeparation ?? 5, Math.floor(n / 2));

  // Each iteration adds one edge, so a completion needs far fewer than n*k*6
  // steps; this is an unreachable safety bound (the loop exits earlier when no
  // deficient vertex or no legal partner remains).
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

  forceConnect(g, cons, k);

  assertHardConstraints(g, cons, "constrainedGreedy");
  assertWithinDegreeCap(g, k, "constrainedGreedy");
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

function legalEdge(g: Graph, cons: Constraints, k: number): EdgePredicate {
  return (u, v) =>
    u !== v &&
    !g.hasEdge(u, v) &&
    !cons.isProhibited(u, v) &&
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

/**
 * Force-connect leftover components under the degree cap. Connectivity outranks
 * girth and regularity, but never exceed k: repeatedly add any legal
 * (non-prohibited, both-under-k) cross-component edge until one component
 * remains or none exists. Residual disconnection is honest — it means the roster
 * cannot be connected within k buddies each, and surfaces as report.connected.
 */
function forceConnect(g: Graph, cons: Constraints, k: number): void {
  // At most n-1 joins are ever needed; each pass adds one edge or stops.
  for (let pass = 0; pass < g.n; pass++) {
    const comps = components(g);
    if (comps.length <= 1) return;
    if (!joinAnyComponents(g, comps, cons, k)) return;
  }
}

/** Add one legal edge bridging two distinct components; true if one was added. */
function joinAnyComponents(
  g: Graph,
  comps: number[][],
  cons: Constraints,
  k: number,
): boolean {
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      for (const u of comps[i]) {
        if (g.degree(u) >= k) continue;
        for (const v of comps[j]) {
          if (g.degree(v) < k && !cons.isProhibited(u, v) && !g.hasEdge(u, v)) {
            g.addEdge(u, v);
            return true;
          }
        }
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
    let e = penalizedAspl(allPairsSummary(g), g.n);
    if (usePriorPenalty) {
      e += priorWeight * (priors.length - countPresentEdges(g, priors));
    }
    return e;
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

// --- contracts (dev-mode only) ----------------------------------------------

// Postcondition/precondition checks run under test/dev but are compiled out of
// production bundles where `process` is absent, so they never cost the hot path.
// NOTE: any new hard-constraint kind must be enforced in legalEdge,
// joinAnyComponents, swapBreaksConstraint, AND asserted here — keep the four in sync.
const CONTRACTS_ENABLED =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

/** Turn the "call validate first" contract into a clear dev-mode error. */
function assertWellFormed(n: number, k: number, cons: Constraints): void {
  if (!CONTRACTS_ENABLED) return;
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`constrainedGreedy: k must be a non-negative integer, got ${k}`);
  }
  const outOfRange = (a: number, b: number) =>
    !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n;
  for (const [a, b] of [...cons.requiredPairs(), ...cons.prohibitedPairs()]) {
    if (outOfRange(a, b)) {
      throw new Error(
        `constrainedGreedy: constraint references person out of range (${a},${b}) for n=${n} — call validate() first`,
      );
    }
  }
}

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

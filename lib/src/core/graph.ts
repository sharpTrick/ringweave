/**
 * Graph container: adjacency as an array of Sets, vertices 0..n-1. Mirrors the
 * Python reference `core.Graph`. The RNG-free `ringGreedy`/`repairDegrees` (whose
 * decisions don't depend on Set iteration order) produce byte-identical edge sets
 * to Python; `constrainedGreedy` traverses adjacency Sets during component
 * discovery and so is validated on invariants/metrics, not byte identity.
 *
 * `adj` is typed read-only to callers so the symmetry invariant can only be
 * mutated through `addEdge`/`removeEdge`; internal mutators cast past it.
 *
 * As the dependency leaf (it imports nothing from the core), this module is also
 * home to the cross-cutting roster/work bounds every generation entry point
 * validates against — `MAX_ROSTER`, `MAX_CONSTRAINED_N`, `MAX_CONSTRAINED_WORK`,
 * `DEFAULT_MIN_SEPARATION`, and the `constrainedWork` estimate — so every module
 * can import them without an import cycle.
 */
// Upper bound on roster size for the O(n) structures — Graph adjacency, the
// constrained path's per-BFS arrays, refusedResult. Bounds `new Array(n)` /
// `Array.from({length:n})` below the JS length limit and keeps allocation sane.
// NOTE: ringGreedy's O(n²) distance cache needs a much tighter cap of its own
// (see MAX_CACHED_N in greedy.ts) — this does not make that path memory-safe.
// Shared by every entry point that validates n. Mirrored in reference-python.
export const MAX_ROSTER = 1_000_000;

// Upper bound on roster size for the constrained path (constrainedGreedy /
// buildConstrainedBuddyGraph / validate). Bounds the costs that scale with n
// alone: generation's O(n²) baseline (one BFS per edge) and validate's O(n²)
// prohibited-pair connectivity walk. The extra blow-up from dense k is bounded
// separately by MAX_CONSTRAINED_WORK — this cap alone does not make a large-k
// roster tractable. Enforced as a refusal in `validate` and a throw in
// `constrainedGreedy`'s precondition. Its value coincides with MAX_CACHED_N but
// is unrelated — do not merge them: that one bounds ringGreedy's distance-cache
// *memory*, this one bounds roster size on the constrained path.
export const MAX_CONSTRAINED_N = 5000;

// Work budget for constrained generation, bounding the cost that MAX_CONSTRAINED_N
// misses: dense k. `constrainedGreedy` runs one BFS (~O(n)) per edge added and
// adds ~n·min(k,n-1)/2 edges, so wall-clock tracks n²·min(k,n-1) — but not at a
// uniform rate: ~7.5M work-units/s for sparse k, dropping to ~2.2M/s in the
// near-complete corner (each BFS is deeper as m grows). A dense roster (e.g.
// n=500,k=499) clears the n-cap but then runs for minutes-to-days; this budget
// (1e8) refuses it, holding worst-case generation to ~13 s for sparse rosters and
// ~46 s at the deepest allowed corner (n≈464, k=n-1 — an unrealistic near-complete
// graph). Enforced in `validate` (refuse) and `checkWellFormed` (throw); mirrored
// in reference-python. The real fix — an incremental single-source distance scheme
// — is a tracked follow-on.
export const MAX_CONSTRAINED_WORK = 100_000_000;

/**
 * Estimated constrained-generation cost, ∝ vertices × edges-added. Monotone in n
 * and k; compared against MAX_CONSTRAINED_WORK to refuse rosters that would hang.
 * `min(k, n-1)` mirrors the effective degree cap (k is silently capped at n-1).
 */
export function constrainedWork(n: number, k: number): number {
  return n * n * Math.min(k, Math.max(0, n - 1));
}

// Work budget for the UNCONSTRAINED generator (ringGreedy). MAX_CACHED_N bounds
// its MEMORY (the flat n×n distance cache) and says so; nothing bounded its TIME,
// which is the larger hazard: completion updates the O(n²) cache once per edge
// added and adds ~n·min(k,n-1)/2 edges, so wall-clock tracks n³·k/2. The n-cap
// alone let (1000, 999) — which `validate` refuses outright on the constrained
// path — run for over 22 minutes without returning.
//
// Calibrated against measurement on this machine, taking the slowest observed
// rate (~1.5e8 work-units/s at the dense end; sparse runs are 2-3x faster):
//   (500, 4)    2.5e8  ->  0.55 s
//   (1000, 4)   2.0e9  ->  5.4 s
//   (1000, 12)  6.0e9  ->  38.5 s      <- the app's own ceiling, deliberately still allowed
//   (1500, 4)   6.8e9  ->  16.8 s
//   (1000, 999) 5.0e11 ->  refused (was: >22 min)
//   (5000, 4)   2.5e11 ->  refused (was: tens of minutes)
// 1e10 is therefore ~60 s worst case. It is NOT tighter than that on purpose: the
// app advertises rosters up to 1000 at up to 12 buddies, and a budget below 6e9
// would refuse a configuration that ships today.
//
// DELIBERATELY NOT the same budget as MAX_CONSTRAINED_WORK, and the two accept-sets
// are NOT nested. The paths have different cost models (this one pays O(n²) per
// edge for the cache update; the constrained one pays O(n) per edge for a BFS), so
// a single constant would either refuse working configurations here or admit
// hanging ones there.
export const MAX_GREEDY_WORK = 10_000_000_000;

/** Estimated ringGreedy cost, ∝ vertices² × edges-added. Monotone in n and k. */
export function greedyWork(n: number, k: number): number {
  return n * n * ((n * Math.min(k, Math.max(0, n - 1))) / 2);
}

// Work budget for the polish pass, expressed in the unit polish actually costs:
// iterations × (per-iteration edge-list build + full all-pairs re-measure), i.e.
// iters·n·m. The previous gate was `n <= 120`, which bounds n and nothing else —
// so the most expensive input on the whole default path sat just below it.
// Measured with default options before the change:
//   buildBuddyGraph(120, 12) -> 33.0 s
//   buildBuddyGraph(121, 12) ->  0.1 s     (one more person, 300x less work)
// Density never participated, and cost DECREASED with n across the threshold.
//
// The value is chosen to reproduce the old threshold exactly at k=4 — the
// configuration every fixture and the reroll boundary test use — so nothing that
// is pinned today moves: polishWork(120, 4) = 5.76e8 is admitted and
// polishWork(121, 4) = 5.86e8 is not. Denser rosters, which the n-cap waved
// through, are now refused: polishWork(120, 12) = 1.73e9.
//
// HONEST RESIDUAL: this bounds the cost and makes the gate k-aware, but any
// on/off gate still has a discontinuity at its boundary — cost jumps from the
// budget to ~0 as n crosses it. Removing that entirely means deriving the
// ITERATION COUNT from the budget rather than switching polish off, which changes
// every polished output and would have to be mirrored in reference-python first.
// Recorded as a follow-on in lib/CLAUDE.md rather than done here.
export const MAX_POLISH_WORK = 576_000_000;

/**
 * Estimated polish cost: iterations × per-iteration work (an edge-list build plus
 * an all-pairs re-measure, both linear in n·m). `m` is estimated from (n, k) at
 * the gate, where the seed graph does not exist yet.
 */
export function polishWork(n: number, k: number, iters: number): number {
  const m = (n * Math.min(k, Math.max(0, n - 1))) / 2;
  return iters * n * m;
}

// Default minimum degrees of separation to aim for (the `mind`/`minSeparation`
// option). Shared so the three generation entry points can't drift apart.
export const DEFAULT_MIN_SEPARATION = 5;

export class Graph {
  readonly n: number;
  readonly adj: ReadonlyArray<ReadonlySet<number>>;

  constructor(n: number) {
    // Guard the invariant n === adj.length: Array.from clamps a fractional or
    // negative length while `this.n` would keep the raw value, so later indexing
    // walks off the end. Refuse the bad input with a clear message instead.
    if (!Number.isInteger(n) || n < 0 || n > MAX_ROSTER) {
      throw new Error(`Graph size ${n} must be an integer in [0, ${MAX_ROSTER}]`);
    }
    this.n = n;
    this.adj = Array.from({ length: n }, () => new Set<number>());
  }

  // The public `adj` type is read-only; mutation goes through this internal view.
  #mut(u: number): Set<number> {
    return this.adj[u] as Set<number>;
  }

  addEdge(u: number, v: number): boolean {
    if (u === v) return false;
    if (this.adj[u].has(v)) return false;
    this.#mut(u).add(v);
    this.#mut(v).add(u);
    return true;
  }

  removeEdge(u: number, v: number): void {
    this.#mut(u).delete(v);
    this.#mut(v).delete(u);
  }

  hasEdge(u: number, v: number): boolean {
    return this.adj[u].has(v);
  }

  degree(u: number): number {
    return this.adj[u].size;
  }

  degrees(): number[] {
    return this.adj.map((a) => a.size);
  }

  numEdges(): number {
    let s = 0;
    for (const a of this.adj) s += a.size;
    // The degree sum is even by the symmetry invariant; floor is a cheap guard.
    return Math.floor(s / 2);
  }

  /** Undirected edges as sorted [u, v] pairs with u < v, in ascending order. */
  edgeList(): [number, number][] {
    const out: [number, number][] = [];
    for (let u = 0; u < this.n; u++) {
      for (const v of this.adj[u]) {
        if (u < v) out.push([u, v]);
      }
    }
    out.sort((a, b) => (a[0] - b[0] !== 0 ? a[0] - b[0] : a[1] - b[1]));
    return out;
  }

  copy(): Graph {
    const g = new Graph(this.n);
    for (let u = 0; u < this.n; u++) {
      for (const v of this.adj[u]) g.#mut(u).add(v);
    }
    return g;
  }
}

/** Hamiltonian cycle on n vertices: i — (i+1) mod n. */
export function ring(n: number): Graph {
  const g = new Graph(n);
  for (let i = 0; i < n; i++) g.addEdge(i, (i + 1) % n);
  return g;
}

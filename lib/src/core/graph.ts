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

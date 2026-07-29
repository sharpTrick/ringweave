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
 * It holds `MAX_ROSTER`, because the constructor is that bound's only in-file
 * consumer. Every OTHER cross-cutting bound and estimator now lives in
 * `budgets.ts` — a leaf that imports nothing, which is what made this module their
 * home in the first place and is better served by a module that is only that.
 */
// Upper bound on roster size for the O(n) structures — Graph adjacency, the
// constrained path's per-BFS arrays, refusedResult. Bounds `new Array(n)` /
// `Array.from({length:n})` below the JS length limit and keeps allocation sane.
// NOTE: ringGreedy's O(n²) distance cache needs a much tighter cap of its own
// (see MAX_CACHED_N in greedy.ts) — this does not make that path memory-safe.
// Shared by every entry point that validates n. Mirrored in reference-python.
export const MAX_ROSTER = 1_000_000;

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

  /**
   * Throw on an endpoint outside 0..n-1, BEFORE any mutation.
   *
   * The order matters and was a real defect: `addEdge` wrote `adj[u]` and then
   * threw on an out-of-range `v`, so a caller that caught the error kept a Graph
   * whose adjacency was asymmetric and contained a non-vertex — degree sum odd,
   * `numEdges()` disagreeing with `edgeList()`, and every invariant downstream
   * quietly false. A guard that runs after half the work is not a guard.
   */
  #checkEndpoints(u: number, v: number): void {
    this.#checkVertex(u);
    this.#checkVertex(v);
  }

  #checkVertex(x: number): void {
    if (!Number.isInteger(x) || x < 0 || x >= this.n) {
      throw new Error(`vertex ${x} must be an integer in [0, ${this.n - 1}]`);
    }
  }

  addEdge(u: number, v: number): boolean {
    this.#checkEndpoints(u, v);
    if (u === v) return false;
    if (this.adj[u].has(v)) return false;
    this.#mut(u).add(v);
    this.#mut(v).add(u);
    return true;
  }

  removeEdge(u: number, v: number): void {
    // Same reason as addEdge: half a removal leaves asymmetric adjacency.
    this.#checkEndpoints(u, v);
    this.#mut(u).delete(v);
    this.#mut(v).delete(u);
  }

  hasEdge(u: number, v: number): boolean {
    // The read path is guarded too, so it cannot report a phantom edge for a
    // non-vertex — `this.adj[u]` is `undefined` there and `.has` would throw a
    // TypeError with no useful message instead of naming the bad index.
    this.#checkEndpoints(u, v);
    return this.adj[u].has(v);
  }

  degree(u: number): number {
    // GUARDED like every other public index-taking method. `hasEdge`'s comment already gives the
    // reason — a non-vertex must be named, not surfaced as `Cannot read properties of undefined`
    // — and this was the one entry point left out of it, which showed in both directions:
    // `degree(-1)` threw a raw TypeError naming nothing, while `degree("0")` returned a real
    // answer, because `adj["0"]` aliases `adj[0]`. `metrics.ts` added the same guard to
    // `bfsDistances` for the same reason; this is its sibling.
    //
    // The cost is one `Number.isInteger` and two comparisons on a path the generators call
    // ~n²k times, so it was measured rather than assumed — and the first measurement was wrong.
    // A single run of `buildBuddyGraph(600, 8)` showed 3.84 s -> 4.68 s and looked like a 22%
    // regression; repeated, the medians are 4.90 s unguarded against 5.19 s guarded with the
    // ranges overlapping (4.52-5.42 vs 4.77-5.30). So the honest figure is single-digit percent
    // at most, not zero and not 22%. It is paid because every internal caller passes a loop
    // index, so the branch never fires, and because the alternative is a public read path that
    // answers `1` for `degree("0")`.
    this.#checkVertex(u);
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

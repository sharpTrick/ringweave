/**
 * Graph container: adjacency as an array of Sets, vertices 0..n-1. Mirrors the Python reference
 * `core.Graph`; `ringGreedy`/`repairDegrees` are byte-identical to it, while `constrainedGreedy`
 * traverses adjacency Sets and so is validated on invariants and metrics, not byte identity.
 *
 * `adj` is read-only to callers so the symmetry invariant can only be mutated through
 * `addEdge`/`removeEdge`.
 */
// Roster-size cap for the O(n) structures only. ringGreedy's O(n²) distance cache needs a much
// tighter cap of its own (`MAX_CACHED_N` in greedy.ts) — this does not make that path memory-safe.
// Shared by every entry point that validates n; mirrored in reference-python.
export const MAX_ROSTER = 1_000_000;

export class Graph {
  readonly n: number;
  readonly adj: ReadonlyArray<ReadonlySet<number>>;

  constructor(n: number) {
    // Guards n === adj.length: `Array.from` clamps a fractional or negative length while `this.n`
    // keeps the raw value, so later indexing walks off the end.
    if (!Number.isInteger(n) || n < 0 || n > MAX_ROSTER) {
      throw new Error(`Graph size ${n} must be an integer in [0, ${MAX_ROSTER}]`);
    }
    this.n = n;
    this.adj = Array.from({ length: n }, () => new Set<number>());
  }

  #mut(u: number): Set<number> {
    return this.adj[u] as Set<number>;
  }

  /**
   * Throws on an out-of-range endpoint BEFORE any mutation. Checking mid-write leaves a caught
   * error holding an asymmetric adjacency containing a non-vertex.
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
    this.#checkEndpoints(u, v);
    this.#mut(u).delete(v);
    this.#mut(v).delete(u);
  }

  hasEdge(u: number, v: number): boolean {
    // Read paths are guarded too: unguarded, `adj["0"]` aliases `adj[0]` and answers for a
    // non-vertex, while `adj[-1].has` throws a TypeError naming nothing.
    this.#checkEndpoints(u, v);
    return this.adj[u].has(v);
  }

  degree(u: number): number {
    // Guarded for `hasEdge`'s reason, on a path the generators call ~n²k times. The cost was
    // measured, not assumed: single-digit percent at most; see
    // docs/findings/generation-cost-budgets.md.
    this.#checkVertex(u);
    return this.adj[u].size;
  }

  degrees(): number[] {
    return this.adj.map((a) => a.size);
  }

  numEdges(): number {
    let s = 0;
    for (const a of this.adj) s += a.size;
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

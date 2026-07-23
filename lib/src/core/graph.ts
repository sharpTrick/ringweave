/**
 * Graph container: adjacency as an array of Sets, vertices 0..n-1. Mirrors the
 * Python reference `core.Graph`. The RNG-free `ringGreedy`/`repairDegrees` (whose
 * decisions don't depend on Set iteration order) produce byte-identical edge sets
 * to Python; `constrainedGreedy` traverses adjacency Sets during component
 * discovery and so is validated on invariants/metrics, not byte identity.
 *
 * `adj` is typed read-only to callers so the symmetry invariant can only be
 * mutated through `addEdge`/`removeEdge`; internal mutators cast past it.
 */
// A sane upper bound on roster size: far beyond the product scale (n ~ hundreds)
// but small enough that `new Array(n)` / `Array.from({length:n})` can't overflow
// (JS array length maxes at 2**32-1) or exhaust memory. Shared by every entry
// point that validates n. Mirrored in reference-python.
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

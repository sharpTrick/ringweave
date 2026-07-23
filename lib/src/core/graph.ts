/**
 * Graph container: adjacency as an array of Sets, vertices 0..n-1.
 * Mirrors the Python reference `core.Graph` exactly so that the deterministic
 * generators produce byte-identical edge sets across languages.
 */
export class Graph {
  readonly n: number;
  readonly adj: Set<number>[];

  constructor(n: number) {
    this.n = n;
    this.adj = Array.from({ length: n }, () => new Set<number>());
  }

  addEdge(u: number, v: number): boolean {
    if (u === v) return false;
    if (this.adj[u].has(v)) return false;
    this.adj[u].add(v);
    this.adj[v].add(u);
    return true;
  }

  removeEdge(u: number, v: number): void {
    this.adj[u].delete(v);
    this.adj[v].delete(u);
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
    return s >> 1;
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
      for (const v of this.adj[u]) g.adj[u].add(v);
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

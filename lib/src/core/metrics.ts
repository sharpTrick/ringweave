/**
 * BFS-based metrics. Faithful ports of the Python reference so numbers match.
 */
import { Graph } from "./graph.js";

/** Sentinel for an unreachable vertex in a `bfsDistances` result. */
export const UNREACHABLE = -1;

/** Distance vector from s; unreachable = UNREACHABLE (-1). */
export function bfsDistances(g: Graph, s: number): Int32Array {
  const dist = new Int32Array(g.n).fill(UNREACHABLE);
  dist[s] = 0;
  const q: number[] = [s];
  let head = 0;
  while (head < q.length) {
    const u = q[head++];
    const du = dist[u];
    for (const w of g.adj[u]) {
      if (dist[w] === UNREACHABLE) {
        dist[w] = du + 1;
        q.push(w);
      }
    }
  }
  return dist;
}

/**
 * Throw on a vertex index outside 0..n-1. The path/eccentricity entry points take
 * indices chosen by a caller (ultimately a user selection), and `bfsDistances`
 * would silently tolerate a bad one — `Int32Array` ignores an out-of-range write,
 * so `dist[s]` reads back `undefined` and every downstream comparison is false.
 */
function checkVertex(g: Graph, v: number, label: string): void {
  if (!Number.isInteger(v) || v < 0 || v >= g.n) {
    throw new Error(`${label} ${v} must be an integer in [0, ${g.n - 1}]`);
  }
}

/**
 * Canonical shortest path from `s` to `t` inclusive, as vertex indices; null when
 * `t` is unreachable from `s`. `shortestPath(g, v, v)` is `[v]`.
 *
 * Determinism is the whole design. `bfsDistances` iterates `g.adj[u]`, a Set in
 * insertion order, so *distances* are order-invariant but a *predecessor* is not:
 * recording a `parent` during BFS (as `girth` does) would make the path depend on
 * edge-insertion history, and a graph rebuilt with its edges added in a different
 * order would yield a different path. Instead, BFS from `t` and then walk forward
 * from `s`, always taking the lowest-indexed neighbour one step closer. `min` is
 * order-free, so the result depends only on the edge set — and it is the
 * lexicographically smallest shortest path.
 *
 * Not symmetric: `shortestPath(g, s, t)` is generally not the reverse of
 * `shortestPath(g, t, s)`, since each is smallest read from its own start. A
 * caller treating the pair as unordered should canonicalise (e.g. always pass the
 * lower index as `s`).
 */
export function shortestPath(g: Graph, s: number, t: number): number[] | null {
  checkVertex(g, s, "source");
  checkVertex(g, t, "target");
  const dist = bfsDistances(g, t);
  const steps = dist[s];
  if (steps === UNREACHABLE) return null;

  // Bounded by the known distance rather than looping until `u === t`, so a
  // malformed adjacency can never spin. Each step is guaranteed to find a
  // neighbour: `u` is reachable at distance d > 0 only because BFS discovered it
  // from some vertex at d-1, and `Graph` keeps adjacency symmetric.
  const path = new Array<number>(steps + 1);
  path[0] = s;
  let u = s;
  for (let i = 1; i <= steps; i++) {
    const closer = dist[u] - 1;
    let next = -1;
    for (const w of g.adj[u]) {
      if (dist[w] === closer && (next === -1 || w < next)) next = w;
    }
    path[i] = next;
    u = next;
  }
  return path;
}

/**
 * Largest distance from `v` to any other vertex — how many steps the furthest
 * person is. Infinity when some vertex is unreachable from `v`, and 0 for the
 * single-vertex graph.
 *
 * Infinity, not `UNREACHABLE`, because this is a *metric*: the module keeps two
 * non-overlapping conventions and `girth`/`aspl` already return Infinity for "no
 * such value", while `UNREACHABLE` (-1) is only ever a per-entry sentinel inside a
 * distance vector. Returning -1 here would read as "0 steps away, but less" to
 * every numeric comparison — and a disconnected roster reporting a small
 * eccentricity is precisely the "disconnected reads as optimal" failure this is
 * meant to prevent.
 */
export function eccentricity(g: Graph, v: number): number {
  checkVertex(g, v, "vertex");
  const dist = bfsDistances(g, v);
  let ecc = 0;
  for (let i = 0; i < g.n; i++) {
    if (dist[i] === UNREACHABLE) return Infinity;
    if (dist[i] > ecc) ecc = dist[i];
  }
  return ecc;
}

export function isConnected(g: Graph): boolean {
  if (g.n === 0) return true;
  const d = bfsDistances(g, 0);
  for (let i = 0; i < g.n; i++) if (d[i] === UNREACHABLE) return false;
  return true;
}

export interface Summary {
  aspl: number;
  diameter: number;
  connected: boolean;
}

/**
 * Single pass over all sources. ASPL over reachable ordered pairs, diameter,
 * and a connectivity flag. Matches Python `all_pairs_summary`.
 */
export function allPairsSummary(g: Graph): Summary {
  const n = g.n;
  let total = 0;
  let count = 0;
  let diameter = 0;
  let connected = true;
  for (let s = 0; s < n; s++) {
    const dist = bfsDistances(g, s);
    let reached = 0;
    for (let t = 0; t < n; t++) {
      const d = dist[t];
      if (d > 0) {
        total += d;
        count += 1;
        reached += 1;
        if (d > diameter) diameter = d;
      }
    }
    if (reached < n - 1) connected = false;
  }
  const aspl = count ? total / count : Infinity;
  return { aspl, diameter, connected };
}

/** ASPL with a heavy penalty when disconnected — a single scalar for optimizers. */
export function penalizedAspl(summary: Summary, n: number): number {
  return summary.connected ? summary.aspl : summary.aspl + 10 * n;
}

/** How many of `pairs` are currently present as edges in `g`. */
export function countPresentEdges(g: Graph, pairs: [number, number][]): number {
  let count = 0;
  for (const [a, b] of pairs) if (g.hasEdge(a, b)) count++;
  return count;
}

/** Partition vertices into connected components (each a list of vertex indices). */
export function connectedComponents(g: Graph): number[][] {
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

/**
 * Fraction (0..1) of vertices in the largest connected component. 1 for a
 * connected graph; the empty graph is vacuously 1. A graded companion to
 * `isConnected` — how close to whole is a disconnected roster. Matches Python
 * `largest_component_fraction`.
 */
export function largestComponentFraction(g: Graph): number {
  if (g.n === 0) return 1;
  let largest = 0;
  // Loop rather than Math.max(...sizes) to avoid the argument-spread ceiling on
  // large rosters (same reason as degreeExtent in index.ts).
  for (const comp of connectedComponents(g)) {
    if (comp.length > largest) largest = comp.length;
  }
  return largest / g.n;
}

/**
 * Length of the shortest cycle, or Infinity for a forest. Matches Python girth.
 * O(n·(n+m)): a BFS from every source, with an early-out only once a triangle is
 * found — so a high-girth graph runs the full sweep. Intended for the small
 * generated graphs the builders produce (n ≤ MAX_CACHED_N); calling it on a
 * hand-built graph of hundreds of thousands of vertices is slow by design.
 */
export function girth(g: Graph): number {
  const UNVISITED = -1; // per-source BFS marker; distinct from bfsDistances' UNREACHABLE
  const n = g.n;
  let best = Infinity;
  for (let s = 0; s < n; s++) {
    const dist = new Int32Array(n).fill(UNVISITED);
    const parent = new Int32Array(n).fill(UNVISITED);
    dist[s] = 0;
    const q = [s];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const w of g.adj[u]) {
        if (dist[w] === UNVISITED) {
          dist[w] = dist[u] + 1;
          parent[w] = u;
          q.push(w);
        } else if (parent[u] !== w) {
          // a non-parent already-seen neighbour closes a cycle; skip the tree edge
          // back to the parent, which isn't one
          const cyc = dist[u] + dist[w] + 1;
          if (cyc < best) best = cyc;
        }
      }
    }
    if (best === 3) break; // 3 is the smallest possible cycle; no source can beat it
  }
  return best;
}

/**
 * BFS-based metrics. Ports of `reference-python/`: change the Python first, or the oracle
 * silently stops being an oracle.
 */
import { Graph } from "./graph.js";

/** Sentinel for an unreachable vertex in a `bfsDistances` result. */
export const UNREACHABLE = -1;

/** Distance vector from s; unreachable = UNREACHABLE (-1). */
export function bfsDistances(g: Graph, s: number): Int32Array {
  checkVertex(g, s, "source");
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
 * Throw on a vertex index outside 0..n-1. Every index-taking entry point in this module needs
 * it: `Int32Array` ignores an out-of-range write, so `dist[s]` reads back `undefined` and every
 * downstream comparison is silently false.
 */
function checkVertex(g: Graph, v: number, label: string): void {
  if (!Number.isInteger(v) || v < 0 || v >= g.n) {
    throw new Error(`${label} ${v} must be an integer in [0, ${g.n - 1}]`);
  }
}

/**
 * Canonical shortest path from `s` to `t` inclusive; null when `t` is unreachable.
 * `shortestPath(g, v, v)` is `[v]`.
 *
 * Determinism is the design: BFS from `t`, then walk forward from `s` taking the lowest-indexed
 * neighbour one step closer, so the path depends only on the edge set and not on the insertion
 * order `g.adj` iterates in. Not symmetric — each direction is smallest read from its own start,
 * so a caller treating the pair as unordered must canonicalise (pass the lower index as `s`).
 */
export function shortestPath(g: Graph, s: number, t: number): number[] | null {
  checkVertex(g, s, "source");
  checkVertex(g, t, "target");
  const dist = bfsDistances(g, t);
  const steps = dist[s];
  if (steps === UNREACHABLE) return null;

  // Bounded by the known distance rather than looping until `u === t`, so a malformed
  // adjacency can never spin.
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
 * Largest distance from `v` to any other vertex; 0 for the single-vertex graph.
 *
 * Infinity, not `UNREACHABLE`, when something is unreachable: this module keeps two
 * non-overlapping conventions — Infinity is the METRIC's "no such value" (as in `girth`/`aspl`),
 * `UNREACHABLE` (-1) is only ever a per-entry sentinel inside a distance vector. -1 here would
 * read as "nearer than 0 steps" to every numeric comparison.
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
  /**
   * Mean shortest-path length over REACHABLE ordered pairs only, so a split roster reports a
   * small, healthy-looking average. Never surface it without `connected` beside it.
   */
  aspl: number;
  /** Longest shortest path over REACHABLE pairs. Within-group, exactly as `aspl` is. */
  diameter: number;
  connected: boolean;
  /** Ordered pairs (s, t), s !== t, with t reachable from s. */
  reachablePairs: number;
}

/** Single pass over all sources. Matches Python `all_pairs_summary`. */
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
  return { aspl, diameter, connected, reachablePairs: count };
}

/** Weight by which every disconnected graph is made worse than every connected one. */
const DISCONNECTED_PENALTY = 10;

/**
 * The optimizer objective: ASPL with disconnection made strictly costly.
 *
 * Unreachable pairs are CHARGED at `n` (above any achievable finite distance) and the mean is
 * over ALL ordered pairs, so any move that disconnects strictly increases the objective and an
 * optimizer accepting only strict decreases cannot fragment. A flat penalty alone does not do
 * that — `aspl` averages over reachable pairs, so fragmenting LOWERS it — and the charged mean
 * alone does not put every disconnected graph below every connected one, so both terms stay.
 *
 * Mirrored in `reference-python/core.py` `penalized_aspl`.
 */
export function penalizedAspl(summary: Summary, n: number): number {
  if (summary.connected) return summary.aspl;
  const totalPairs = n * (n - 1);
  if (totalPairs === 0) return summary.aspl;
  const reachable = summary.reachablePairs;
  // `aspl` is Infinity when nothing is reachable, and Infinity * 0 is NaN.
  const reachedTotal = reachable === 0 ? 0 : summary.aspl * reachable;
  const charged = (reachedTotal + (totalPairs - reachable) * n) / totalPairs;
  return charged + DISCONNECTED_PENALTY * n;
}

export function countPresentEdges(g: Graph, pairs: [number, number][]): number {
  let count = 0;
  for (const [a, b] of pairs) if (g.hasEdge(a, b)) count++;
  return count;
}

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
 * Fraction (0..1) of vertices in the largest connected component; the empty graph is vacuously
 * 1. Matches Python `largest_component_fraction`.
 */
export function largestComponentFraction(g: Graph): number {
  if (g.n === 0) return 1;
  let largest = 0;
  // Loop, not `Math.max(...sizes)`: the argument-spread ceiling throws on large rosters.
  for (const comp of connectedComponents(g)) {
    if (comp.length > largest) largest = comp.length;
  }
  return largest / g.n;
}

/**
 * Length of the shortest cycle, or Infinity for a forest. Matches Python girth.
 * Uncapped O(n·(n+m)) with an early-out only on a triangle, so a large high-girth graph runs
 * the full sweep — a diagnostic for generated rosters, not for hand-built graphs of any size.
 */
export function girth(g: Graph): number {
  // Deliberately the same value as UNREACHABLE but a separate constant: it means "not yet seen
  // in THIS sweep", not "unreachable". Do not merge them.
  const UNVISITED = -1;
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
          // The parent test is load-bearing: without it every tree edge reads as a 2-cycle.
          const cyc = dist[u] + dist[w] + 1;
          if (cyc < best) best = cyc;
        }
      }
    }
    if (best === 3) break; // no source can beat the smallest possible cycle
  }
  return best;
}

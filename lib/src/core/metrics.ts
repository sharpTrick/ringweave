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
      if (dist[w] === -1) {
        dist[w] = du + 1;
        q.push(w);
      }
    }
  }
  return dist;
}

export function isConnected(g: Graph): boolean {
  if (g.n === 0) return true;
  const d = bfsDistances(g, 0);
  for (let i = 0; i < g.n; i++) if (d[i] === -1) return false;
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

// (largestComponentFraction removed as dead code — reintroduce with a test when
// the M2 churn-resilience report needs it; connectedComponents makes it a one-liner.)

/** Length of the shortest cycle, or Infinity for a forest. Matches Python girth. */
export function girth(g: Graph): number {
  const n = g.n;
  let best = Infinity;
  for (let s = 0; s < n; s++) {
    const dist = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    dist[s] = 0;
    const q = [s];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const w of g.adj[u]) {
        if (dist[w] === -1) {
          dist[w] = dist[u] + 1;
          parent[w] = u;
          q.push(w);
        } else if (parent[u] !== w) {
          const cyc = dist[u] + dist[w] + 1;
          if (cyc < best) best = cyc;
        }
      }
    }
    if (best === 3) break; // 3 is the smallest possible cycle; no source can beat it
  }
  return best;
}

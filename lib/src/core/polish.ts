/**
 * Swap-polish: improve ASPL by degree-preserving double edge swaps.
 * The swap (a-b, c-d) -> (a-c, b-d) never changes any vertex degree, so a
 * regular graph stays regular. Deterministic given a seed (via RNG).
 *
 * Two modes: "hill" (accept only improvements) and "anneal" (Metropolis).
 */
import { Graph } from "./graph.js";
import { allPairsSummary } from "./metrics.js";
import { RNG } from "./rng.js";

export type PolishMode = "hill" | "anneal";

export interface PolishOptions {
  mode?: PolishMode;
  seed?: number;
  maxIters?: number; // iteration budget (browser-friendly; not wall-clock)
  sampledSources?: number; // if set, use sampled-ASPL energy from this many sources
}

export interface PolishResult {
  graph: Graph;
  aspl: number;
  iters: number;
}

function sampledAspl(g: Graph, srcs: number[]): number {
  let total = 0;
  let count = 0;
  for (const s of srcs) {
    // local BFS
    const dist = new Int32Array(g.n).fill(-1);
    dist[s] = 0;
    const q = [s];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const w of g.adj[u]) {
        if (dist[w] === -1) {
          dist[w] = dist[u] + 1;
          q.push(w);
        }
      }
    }
    for (let t = 0; t < g.n; t++) {
      const d = dist[t];
      if (d > 0) {
        total += d;
        count += 1;
      }
    }
  }
  return count ? total / count : Infinity;
}

function energy(g: Graph, srcs: number[] | null): number {
  if (srcs) return sampledAspl(g, srcs);
  const { aspl, connected } = allPairsSummary(g);
  return connected ? aspl : aspl + 10 * g.n;
}

export function polish(
  input: Graph,
  opts: PolishOptions = {},
): PolishResult {
  const mode = opts.mode ?? "anneal";
  const rng = new RNG(opts.seed ?? 12345);
  const maxIters = opts.maxIters ?? 20000;
  const srcs =
    opts.sampledSources && opts.sampledSources < input.n
      ? rng.sample(input.n, opts.sampledSources)
      : null;

  const g = input.copy();
  let edges = g.edgeList();
  let curE = energy(g, srcs);
  let best = g.copy();
  let bestE = curE;

  // temperature calibration for anneal
  let T = 0;
  let TFloor = 0;
  const alpha = 0.995;
  if (mode === "anneal") {
    const deltas: number[] = [];
    const trials = Math.min(100, Math.max(10, edges.length));
    for (let i = 0; i < trials && edges.length >= 2; i++) {
      const sw = proposeSwap(g, edges, rng);
      if (!sw) continue;
      applySwap(g, sw);
      deltas.push(Math.abs(energy(g, srcs) - curE));
      revertSwap(g, sw);
    }
    const T0 = Math.max(
      deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0.1,
      1e-3,
    );
    T = T0;
    TFloor = 1e-4 * T0;
  }

  let iters = 0;
  let rejects = 0;
  const rejectCap = 200 * g.n;
  while (iters < maxIters) {
    iters++;
    edges = g.edgeList();
    if (edges.length < 2) break;
    const sw = proposeSwap(g, edges, rng);
    if (!sw) continue;
    applySwap(g, sw);
    const newE = energy(g, srcs);
    const delta = newE - curE;

    let accept: boolean;
    if (mode === "hill") {
      accept = delta < -1e-12;
    } else if (delta < 0) {
      accept = true;
    } else {
      accept = T > 0 ? rng.random() < Math.exp(-delta / T) : false;
    }

    if (accept) {
      curE = newE;
      if (newE < bestE - 1e-12) {
        bestE = newE;
        best = g.copy();
        rejects = 0;
      } else {
        rejects++;
      }
    } else {
      revertSwap(g, sw);
      rejects++;
    }

    if (mode === "anneal" && T > TFloor) T *= alpha;
    if (mode === "hill" && rejects >= rejectCap) break;
  }

  const { aspl } = allPairsSummary(best);
  return { graph: best, aspl, iters };
}

interface Swap {
  a: number;
  b: number;
  c: number;
  d: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function proposeSwap(g: Graph, edges: [number, number][], rng: RNG): Swap | null {
  const [i, j] = rng.twoDistinct(edges.length);
  const [a, b] = edges[i];
  const [c, d] = edges[j];
  let x1: number, y1: number, x2: number, y2: number;
  if (rng.random() < 0.5) {
    x1 = a; y1 = c; x2 = b; y2 = d;
  } else {
    x1 = a; y1 = d; x2 = b; y2 = c;
  }
  const distinct = new Set([a, b, c, d]);
  if (distinct.size < 4) return null;
  if (g.hasEdge(x1, y1) || g.hasEdge(x2, y2)) return null;
  if (x1 === y1 || x2 === y2) return null;
  return { a, b, c, d, x1, y1, x2, y2 };
}

function applySwap(g: Graph, s: Swap): void {
  g.removeEdge(s.a, s.b);
  g.removeEdge(s.c, s.d);
  g.addEdge(s.x1, s.y1);
  g.addEdge(s.x2, s.y2);
}

function revertSwap(g: Graph, s: Swap): void {
  g.removeEdge(s.x1, s.y1);
  g.removeEdge(s.x2, s.y2);
  g.addEdge(s.a, s.b);
  g.addEdge(s.c, s.d);
}

/**
 * Swap-polish: improve ASPL by degree-preserving double edge swaps (mechanics in
 * `swap.ts`). Deterministic given a seed (via RNG). Two modes: "hill" (accept
 * only improvements) and "anneal" (Metropolis). Cost is O(n·m) per iteration
 * (full re-measure), so it is impractical much past a few hundred vertices.
 */
import { Graph } from "./graph.js";
import { allPairsSummary, penalizedAspl } from "./metrics.js";
import { RNG } from "./rng.js";
import { proposeSwap, applySwap, revertSwap } from "./swap.js";

export type PolishMode = "hill" | "anneal";

export interface PolishOptions {
  /** Acceptance rule: "anneal" (Metropolis, default) or "hill" (improvements only). */
  mode?: PolishMode;
  /** Seed for the swap RNG. Default 12345. */
  seed?: number;
  /** Iteration budget (browser-friendly; not wall-clock). Default 20000. Same
   * concept as `PolishConstrainedOptions.iters`; named `maxIters` here because
   * `PolishResult.iters` reports the count actually run. */
  maxIters?: number;
}

export interface PolishResult {
  graph: Graph;
  aspl: number;
  iters: number;
}

function energy(g: Graph): number {
  return penalizedAspl(allPairsSummary(g), g.n);
}

export function polish(
  input: Graph,
  opts: PolishOptions = {},
): PolishResult {
  const mode = opts.mode ?? "anneal";
  const rng = new RNG(opts.seed ?? 12345);
  const maxIters = opts.maxIters ?? 20000;

  const g = input.copy();
  let edges = g.edgeList();
  let curE = energy(g);
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
      deltas.push(Math.abs(energy(g) - curE));
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
  const rejectCap = 200 * g.n; // empirically-tuned early-stop for "hill" mode
  while (iters < maxIters) {
    iters++;
    edges = g.edgeList();
    if (edges.length < 2) break;
    const sw = proposeSwap(g, edges, rng);
    if (!sw) continue;
    applySwap(g, sw);
    const newE = energy(g);
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

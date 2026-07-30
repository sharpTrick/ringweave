/**
 * Swap-polish: improve ASPL by degree-preserving double edge swaps. Deterministic given a seed.
 *
 * Cost is O(n·(n+m)) per iteration, NOT O(n·m) — that reading under-charges a sparse graph by the
 * whole n² term — so it is impractical much past a few hundred vertices.
 */
import { Graph } from "./graph.js";
import { allPairsSummary, penalizedAspl } from "./metrics.js";
import { boundedPolishIterations, checkPolishSize } from "./budgets.js";
import { RNG } from "./rng.js";
import { proposeSwap, applySwap, revertSwap } from "./swap.js";

export type PolishMode = "hill" | "anneal";

/**
 * Default iteration budget, and also the ceiling. Exported because `buildBuddyGraph`'s auto-polish
 * gate models the same number — declared twice, a change to one would not reach the other.
 */
export const DEFAULT_POLISH_ITERS = 20000;

export interface PolishOptions {
  /** Acceptance rule: "anneal" (Metropolis, default) or "hill" (improvements only). */
  mode?: PolishMode;
  /** Seed for the swap RNG. Default 12345. */
  seed?: number;
  /** Iteration budget (not wall-clock). Default 20000. Same knob as
   * `PolishConstrainedOptions.iters`, spelled differently only because
   * `PolishResult.iters` reports the count actually run. */
  maxIters?: number;
}

export interface PolishResult {
  graph: Graph;
  aspl: number;
  connected: boolean;
  /**
   * Loop passes run — the budget consumed, not work done and not evidence of change:
   * `polish(ring(3))` reports 19,990 over a byte-identical graph. Read `changed` for the output.
   */
  iters: number;
  /** Whether the returned graph differs from the input. The only field that answers that. */
  changed: boolean;
}

function energy(g: Graph): number {
  return penalizedAspl(allPairsSummary(g), g.n);
}

export function polish(
  input: Graph,
  opts: PolishOptions = {},
): PolishResult {
  const mode = opts.mode ?? "anneal";
  // BEFORE the copy and before `energy`: neither is reachable by the iteration budget below, so
  // a call priced at zero iterations still ran for 160 s at n=40000. `0` priors always — the
  // unconstrained objective has no prior term, so it does not pay that per-iteration cost.
  checkPolishSize(input.n, input.degrees().reduce((a, b) => a + b, 0) / 2, 0);
  const rng = new RNG(opts.seed ?? 12345);
  const g = input.copy();
  let edges = g.edgeList();
  // Bound the loop HERE, not in a caller: `polish` is public API, so a wrapper clamp is not a
  // bound — `polish(ring(20), { maxIters: Infinity })` used to never return.
  const maxIters = boundedPolishIterations(g.n, edges.length, 0, opts.maxIters, DEFAULT_POLISH_ITERS);
  let curE = energy(g);
  let best = g.copy();
  let bestE = curE;
  let changed = false;

  let T = 0;
  let TFloor = 0;
  let calibrationSweeps = 0;
  const alpha = 0.995;
  if (mode === "anneal") {
    const deltas: number[] = [];
    // Each trial is a full `energy()`, costing what a loop iteration costs, so the calibration is
    // charged against the same budget — and capped at HALF of it, or a small budget vanishes
    // entirely into setup and the pass returns its input having made no accept/reject decision.
    const trials = Math.min(100, Math.max(10, edges.length), Math.floor(maxIters / 2));
    calibrationSweeps = trials;
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

  // The loop gets what the calibration did not spend, so the two together stay inside the one
  // budget `boundedPolishIterations` computed.
  const loopIters = Math.max(0, maxIters - calibrationSweeps);
  let iters = 0;
  // Drives only the "hill" early-stop; anneal runs the full budget, governed by its temperature
  // schedule rather than a reject streak.
  let rejects = 0;
  const rejectCap = 200 * g.n;
  while (iters < loopIters) {
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
        changed = true;
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

  const { aspl, connected } = allPairsSummary(best);
  return { graph: best, aspl, connected, iters, changed };
}

/**
 * Swap-polish: improve ASPL by degree-preserving double edge swaps (mechanics in
 * `swap.ts`). Deterministic given a seed (via RNG). Two modes: "hill" (accept
 * only improvements) and "anneal" (Metropolis). Cost is O(n·m) per iteration
 * (full re-measure), so it is impractical much past a few hundred vertices.
 *
 * No dev-mode postconditions here (unlike `polishConstrained`): swaps are
 * structurally degree-preserving and `best` is monotonically non-increasing on
 * penalized ASPL, so a connected input can never end disconnected (the 10n
 * penalty dominates any connected ASPL) — provable by construction, no runtime
 * check needed.
 */
import { Graph } from "./graph.js";
import { allPairsSummary, penalizedAspl } from "./metrics.js";
import { boundedPolishIterations, checkPolishSize } from "./budgets.js";
import { RNG } from "./rng.js";
import { proposeSwap, applySwap, revertSwap } from "./swap.js";

export type PolishMode = "hill" | "anneal";

/**
 * Documented default iteration budget, and (via MAX_POLISH_ITERS) also the
 * ceiling. Exported because `buildBuddyGraph`'s auto-polish gate has to model the
 * same number — it was declared in both places, so a change to one would silently
 * not reach the other.
 */
export const DEFAULT_POLISH_ITERS = 20000;

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
  connected: boolean;
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
  // BEFORE the copy and before `energy`, which is the costly one: `allPairsSummary`
  // inside `energy` is Theta(n·(n+m)) while `copy` is only O(n+m). Neither is reachable
  // by the iteration budget below, so a call priced at zero iterations still ran for
  // 160 s at n=40000.
  checkPolishSize(input.n, input.degrees().reduce((a, b) => a + b, 0) / 2);
  const rng = new RNG(opts.seed ?? 12345);
  const g = input.copy();
  let edges = g.edgeList();
  // Bound the loop HERE rather than in a caller. `polish` is exported public API,
  // so a wrapper clamp is not a bound at all: `polish(ring(20), { maxIters:
  // Infinity })` used to never return, and `Infinity` is reachable from JSON
  // without an Infinity literal.
  const maxIters = boundedPolishIterations(g.n, edges.length, opts.maxIters, DEFAULT_POLISH_ITERS);
  let curE = energy(g);
  let best = g.copy();
  let bestE = curE;

  // temperature calibration for anneal
  let T = 0;
  let TFloor = 0;
  const alpha = 0.995;
  if (mode === "anneal") {
    const deltas: number[] = [];
    // Bounded by the SAME iteration budget the loop is (not sharing one pool with
    // it — a full-budget run does up to 100 calibration evaluations and then
    // maxIters loop iterations). These are full energy evaluations, and they used
    // to run unconditionally: `polish(g, { mode: "anneal", maxIters: 0 })` did 100
    // of them and took 587 ms on a 300-vertex graph, against 11 ms for the same
    // call in hill mode. Work before the loop that the budget cannot reach is work
    // the budget does not bound.
    const trials = Math.min(100, Math.max(10, edges.length), maxIters);
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
  // rejects drives only the "hill" early-stop below; anneal runs the full budget
  // (its temperature schedule, not a reject streak, governs convergence).
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

  const { aspl, connected } = allPairsSummary(best);
  return { graph: best, aspl, connected, iters };
}

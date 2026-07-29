/**
 * Cost budgets and their estimators. Imports nothing, so any module may import it without a cycle.
 *
 * Every generation path needs BOTH a size cap (memory) and a work cap (time), and the pairs are
 * deliberately not shared between paths: the cost shapes differ, so one constant would either
 * refuse working configurations or admit hanging ones.
 */
// Roster-size cap for the constrained path. Bounds the n-only costs; the dense-k blow-up is
// bounded separately by MAX_CONSTRAINED_WORK, so this cap alone does not make a large-k roster
// tractable. Coincides with `MAX_CACHED_N` but is unrelated — do not merge them. Enforced as a
// refusal in `validate` and a throw in `constrainedGreedy`. Calibrated against measurement; see
// docs/findings/constrained-generation-cost-and-caps.md.
export const MAX_CONSTRAINED_N = 5000;

// Work budget for constrained generation, bounding the dense-k cost MAX_CONSTRAINED_N misses.
// Enforced in `validate` (refuse) and `checkWellFormed` (throw); mirrored in reference-python —
// change both or the oracle stops matching. Calibrated against measurement; see
// docs/findings/constrained-generation-cost-and-caps.md.
export const MAX_CONSTRAINED_WORK = 100_000_000;

/**
 * Cost charged per prohibited pair — a FLOOR, not a model of the shape, so that adding
 * prohibitions can only move an input toward refusal. Calibrated against measurement; see
 * docs/findings/constrained-generation-cost-and-caps.md.
 */
const PROHIBITED_PROBE_COST = 80;

/**
 * Constrained-generation cost estimate, monotone in n, k and the constraint set; compared against
 * MAX_CONSTRAINED_WORK. `prohibitedCount` is required, not optional — an optional argument is how
 * that dimension went missing before, letting a roster sitting on the budget cost 3.3x the
 * calibrated worst case with `validate` returning no refusal.
 */
export function constrainedWork(n: number, k: number, prohibitedCount: number): number {
  return n * n * Math.min(k, Math.max(0, n - 1)) + PROHIBITED_PROBE_COST * prohibitedCount;
}

// Work budget (TIME) for the unconstrained generator. `MAX_CACHED_N` bounds only its MEMORY, and
// for a while nothing bounded time — (1000, 999) ran for over 22 minutes. Deliberately NOT the
// same budget as MAX_CONSTRAINED_WORK, and the accept-sets are NOT nested: the two paths have
// different cost models, so one constant would either refuse working configurations here or admit
// hanging ones there. Set to the tightest value that still admits (1000, 12), the app's advertised
// ceiling, which sits exactly at the cap — tightening it refuses a configuration that ships.
// Calibrated against measurement; see docs/findings/generation-cost-budgets.md.
export const MAX_GREEDY_WORK = 15_000_000_000;

/**
 * Work budget for `repairDegrees`, COUNTED at runtime rather than predicted: the cost depends on
 * graph STRUCTURE, which no function of (n, k, deficit) captures. Three cost centres are charged
 * (each BFS sweep at `n + 2m`, each sweep's candidate scan, each pass's rebuild and sort); dropping
 * any one undercharges some shape without bound. Calibrated against measurement; see
 * docs/findings/generation-cost-budgets.md.
 */
export const MAX_REPAIR_WORK = 500_000_000;

/**
 * Estimated ringGreedy cost, monotone in n and k; compared against MAX_GREEDY_WORK. Charges the
 * edges ACTUALLY added rather than n² per edge of a k-regular graph — the earlier shape was not an
 * upper bound at all. Calibrated against measurement; see docs/findings/generation-cost-budgets.md.
 */
export function greedyWork(n: number, k: number): number {
  const edgesAdded = Math.max(0, (n * Math.min(k, Math.max(0, n - 1))) / 2 - n);
  // Floor of 1: the O(n²) baseline is paid even when NO edges are added, and without it the
  // estimate is exactly 0 for every k <= 2 at every n, which is no budget check at all. It cannot
  // move ringGreedy's accept-set — at k >= 3, n >= 2, edgesAdded is already >= 1.
  return 3 * n * n * Math.max(edgesAdded, 1);
}

// The GATE for auto-polish — whether it runs at all; what it may then cost is enforced by
// `boundedPolishIterations` inside the primitives. The value reproduces the old `n <= 120`
// threshold exactly at k=4, the configuration every fixture and the reroll boundary test pin, so
// changing it moves outputs that are pinned today. Calibrated against measurement; see
// docs/findings/generation-cost-budgets.md.
//
// Still an on/off gate, so cost is discontinuous at the boundary. Deriving the iteration count
// from the budget instead would change every polished output, so reference-python changes first
// and fixtures are regenerated; tracked in lib/CLAUDE.md.
export const MAX_POLISH_WORK = 865_280_000;

/**
 * Fixed per-iteration polish cost. Without it the model prices an iteration on a 3-person roster
 * at 9 units and affords 64 million of them — measured at 35.7 s on a three-vertex graph.
 */
const POLISH_ITER_OVERHEAD = 64;

/**
 * THE ONE enforcement point for polish's iteration count, called from inside `polish` and
 * `polishConstrained` — they are public API, so a clamp in a wrapper is not a bound at all.
 * `m` is the ACTUAL edge count, and the per-iteration model is `n·(n+m)`, not `n·m`, which
 * under-charges sparse graphs by the entire n² term.
 */
export function boundedPolishIterations(
  n: number,
  m: number,
  priorCount: number,
  requested: number | undefined,
  fallback: number,
): number {
  // Clamped to the CALLER'S OWN default, so `polishIters` can only ask for less work on every
  // path. One shared constant cannot do that: it was the unconstrained default (20,000), so on the
  // constrained path (default 8,000) a caller-supplied 20,000 bought 2.5x the iterations.
  const asked = Number.isInteger(requested) && (requested as number) >= 0
    ? Math.min(requested as number, fallback)
    : fallback;
  // The overhead term also guarantees a positive divisor when m is 0.
  const perIteration = polishIterationCost(n, m, priorCount);
  // The budget LEFT after the fixed sweeps, not the whole budget — see `loopBudget`.
  return Math.min(asked, Math.floor(loopBudget(n, m) / perIteration));
}

/**
 * Cost per WEIGHED prior pair, per iteration — a FLOOR, not a model of the shape. Charged only
 * where the priors are actually weighed: at `priorWeight` 0 the probes never happen, so callers
 * pass 0 and a configuration that costs nothing is never refused. Calibrated against measurement;
 * see docs/findings/generation-cost-budgets.md.
 */
const PRIOR_PROBE_COST = 12;

/**
 * Cost of ONE polish iteration — ONE definition shared by all three gates, so a cost dimension
 * cannot be added to two of them and missed by the third. The dominant term is `allPairsSummary`
 * at Theta(n·(n+m)), NOT n·m: it accumulates n-wide per source however few edges exist.
 */
function polishIterationCost(n: number, m: number, priorCount: number): number {
  return POLISH_ITER_OVERHEAD + n * (n + m) + PRIOR_PROBE_COST * priorCount;
}

/**
 * Estimated polish cost for the pre-generation gate; `m` is estimated from (n, k) because the seed
 * graph does not exist yet, `priorCount` is exact. Required rather than defaulted, for the same
 * reason as `constrainedWork`'s `prohibitedCount`: an optional argument is how the dimension went
 * missing the first time.
 */
export function polishWork(n: number, k: number, priorCount: number, iters: number): number {
  const m = (n * Math.min(k, Math.max(0, n - 1))) / 2;
  return iters * polishIterationCost(n, m, priorCount);
}

/**
 * All-pairs sweeps a polish pass pays OUTSIDE its loop, which the iteration budget cannot reach —
 * a call priced at zero iterations still ran for 160 s at n=40000. Three is the measured count for
 * `polish`; `polishConstrained` pays two and is charged the larger figure, so one constant cannot
 * drift into two.
 */
const FIXED_POLISH_SWEEPS = 3;

/** Throws when the fixed sweeps leave the loop unable to afford even one iteration. */
export function checkPolishSize(n: number, m: number, priorCount: number): void {
  const fixed = FIXED_POLISH_SWEEPS * n * (n + m);
  // Asks whether the LOOP can afford one iteration, not merely whether the fixed sweeps fit: the
  // latter admitted a band that paid three all-pairs sweeps and returned its input unchanged
  // (`polish(ring(11000))`: 6.68 s to report `iters: 0`). It subsumes the old check rather than
  // adding to it, so it cannot refuse a configuration the loop would have accepted.
  if (loopBudget(n, m) < polishIterationCost(n, m, priorCount)) {
    throw new Error(
      `graph too large to polish: the fixed all-pairs sweeps cost ${fixed} of a ${MAX_POLISH_WORK} ` +
        `budget, leaving nothing for the loop (n=${n}, m=${m}) — reduce the roster or skip polish`,
    );
  }
}

/**
 * What the loop may still spend once the fixed sweeps are paid for. Both gates once measured
 * against the WHOLE budget, so together they granted more than the constant they both cite.
 */
function loopBudget(n: number, m: number): number {
  return Math.max(0, MAX_POLISH_WORK - FIXED_POLISH_SWEEPS * n * (n + m));
}

// Shared by both generation entry points so they can't drift apart.
export const DEFAULT_MIN_SEPARATION = 5;


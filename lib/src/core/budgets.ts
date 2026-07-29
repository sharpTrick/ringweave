/**
 * Cost budgets and their estimators.
 *
 * Split out of `graph.ts`, which had become the home for every cross-cutting
 * bound purely because it was the dependency leaf. That reason still holds — this
 * module imports nothing, so anything may import it without a cycle — but it is
 * satisfied better by a module that is ONLY that. None of these take or return a
 * `Graph`; they are arithmetic over plain numbers, and `MAX_ROSTER` stays behind
 * because the `Graph` constructor is its only in-file consumer.
 *
 * Each generation path needs BOTH a size cap (memory) and a work cap (time), and
 * the pairs are deliberately not shared between paths: the costs have different
 * shapes, so one constant would either refuse working configurations or admit
 * hanging ones.
 */
// Upper bound on roster size for the constrained path (constrainedGreedy /
// buildConstrainedBuddyGraph / validate). Bounds the costs that scale with n
// alone: generation's O(n²) baseline (one BFS per edge) and validate's O(n²)
// prohibited-pair connectivity walk. The extra blow-up from dense k is bounded
// separately by MAX_CONSTRAINED_WORK — this cap alone does not make a large-k
// roster tractable. Enforced as a refusal in `validate` and a throw in
// `constrainedGreedy`'s precondition. Its value coincides with MAX_CACHED_N but
// is unrelated — do not merge them: that one bounds ringGreedy's distance-cache
// *memory*, this one bounds roster size on the constrained path.
export const MAX_CONSTRAINED_N = 5000;

// Work budget for constrained generation, bounding the cost that MAX_CONSTRAINED_N
// misses: dense k. `constrainedGreedy` runs one BFS (~O(n)) per edge added and
// adds ~n·min(k,n-1)/2 edges, so wall-clock tracks n²·min(k,n-1) — but not at a
// uniform rate: ~7.5M work-units/s for sparse k, dropping to ~2.2M/s in the
// near-complete corner (each BFS is deeper as m grows). A dense roster (e.g.
// n=500,k=499) clears the n-cap but then runs for minutes-to-days; this budget
// (1e8) refuses it, holding worst-case generation to ~13 s for sparse rosters and
// ~46 s at the deepest allowed corner (n≈464, k=n-1 — an unrealistic near-complete
// graph). Enforced in `validate` (refuse) and `checkWellFormed` (throw); mirrored
// in reference-python. The real fix — an incremental single-source distance scheme
// — is a tracked follow-on.
export const MAX_CONSTRAINED_WORK = 100_000_000;

/**
 * Cost charged per prohibited pair.
 *
 * A FLOOR, deliberately, not a model of the shape. Every legality decision in the generator is
 * a `cons.isProhibited` probe, and a dense prohibited set does not merely make each probe dearer
 * — it makes more candidates fail, so more are scanned per edge added. Measured at k=4:
 *   n=5000, 0 pairs        15.0 s      n=5000, 250k pairs   42.8 s      n=5000, 1M pairs  49.4 s
 *   n=3000, 0 pairs         5.5 s                                       n=3000, 1M pairs  17.1 s
 * The marginal rate FALLS as pairs rise (742 units/pair at 250k, 230 at 1M), so a linear term
 * cannot be the true shape — and this module has already watched four models of another
 * generator's cost fail. So this is calibrated as a RATE on the one shape where the (n,k) term
 * leaves headroom to measure: n=3000 spends 11.7 s more with a million pairs, which at that
 * roster's observed 6.55e6 units/s is 77 units per pair, rounded up. (At n=5000,k=4 the base term
 * already sits exactly on the budget, so any positive charge refuses and the shape teaches
 * nothing.) It binds only above n≈1500 with a large fraction of all pairs prohibited — precisely
 * the regime measured — and can never bind at n<=500, where every pair that exists costs 1e7.
 *
 * What it buys is the INVARIANT, not an accurate prediction: adding prohibited pairs can only
 * move an input toward refusal, so no dimension the inner loop probes is invisible to the gate.
 * The app's own ceiling is 200 pairs (12,800 units), so nothing it can express is affected.
 */
const PROHIBITED_PROBE_COST = 80;

/**
 * Estimated constrained-generation cost, ∝ vertices × edges-added, PLUS a charge per prohibited
 * pair. Monotone in n, k and the constraint set; compared against MAX_CONSTRAINED_WORK to refuse
 * rosters that would hang. `min(k, n-1)` mirrors the effective degree cap (k is silently capped
 * at n-1).
 *
 * `prohibitedCount` is REQUIRED rather than defaulted. Both callers hold the `Constraints` when
 * they call this, and an optional argument is how the dimension went missing the first time: the
 * estimator was (n, k)-only while every legality decision in the generator probes the prohibited
 * set, so a SPARSE roster sitting exactly on the budget could cost 3.3x the calibrated worst case
 * and `validate` returned `[]` for it.
 */
export function constrainedWork(n: number, k: number, prohibitedCount: number): number {
  return n * n * Math.min(k, Math.max(0, n - 1)) + PROHIBITED_PROBE_COST * prohibitedCount;
}

// Work budget for the UNCONSTRAINED generator (ringGreedy). MAX_CACHED_N bounds
// its MEMORY (the flat n×n distance cache) and says so; nothing bounded its TIME,
// which is the larger hazard: completion updates the O(n²) cache once per edge
// added and adds ~n·min(k,n-1)/2 edges, so wall-clock tracks n³·k/2. The n-cap
// alone let (1000, 999) — which `validate` refuses outright on the constrained
// path — run for over 22 minutes without returning.
//
// Calibrated against measurement on this machine, taking the slowest observed
// rate (~1.5e8 work-units/s at the dense end; sparse runs are 2-3x faster):
//   (500, 4)    2.5e8  ->  0.55 s
//   (1000, 4)   2.0e9  ->  5.4 s
//   (1000, 12)  6.0e9  ->  38.5 s      <- the app's own ceiling, deliberately still allowed
//   (1500, 4)   6.8e9  ->  16.8 s
//   (1000, 999) 5.0e11 ->  refused (was: >22 min)
//   (5000, 4)   2.5e11 ->  refused (was: tens of minutes)
// 1e10 is therefore ~60 s worst case. It is NOT tighter than that on purpose: the
// app advertises rosters up to 1000 at up to 12 buddies, and a budget below 6e9
// would refuse a configuration that ships today.
//
// DELIBERATELY NOT the same budget as MAX_CONSTRAINED_WORK, and the two accept-sets
// are NOT nested. The paths have different cost models (this one pays O(n²) per
// edge for the cache update; the constrained one pays O(n) per edge for a BFS), so
// a single constant would either refuse working configurations here or admit
// hanging ones there.
// RECALIBRATED with the corrected estimator above; the accept-set is what changed, not just
// the number. It is set to the tightest value that still admits (1000, 12) — the app's own
// advertised ceiling, which ships — and that configuration now sits exactly at the cap:
//   (1000, 4)  3.0e9  -> admitted    (measured 6.9 s)
//   (1000, 12) 1.5e10 -> admitted exactly, the calibration point
//   (1000, 20) 2.7e10 -> refused     (was admitted; measured 137 s)
//   (800, 39)  2.8e10 -> refused     (was admitted; measured 221 s)
// The two newly-refused shapes are exactly the ones that broke the documented promise.
export const MAX_GREEDY_WORK = 15_000_000_000;

/**
 * Work budget for `repairDegrees`, COUNTED at runtime rather than predicted.
 *
 * Four predictive models of this function's cost failed in four different ways (the list is in
 * `greedy.ts`, next to the counter). The cost depends on graph STRUCTURE — how many under-degree
 * vertices a pass scans before one succeeds — which no function of (n, k, deficit) captures, so
 * `repairDegrees` now accumulates the work it actually does and stops when it exceeds this.
 *
 * Units are real, and there are three cost centres, all COUNTED:
 *   - each `bfsDistances` sweep, at `n + 2m` — the adjacency that EXISTS, not `n + n·k`, which
 *     prices a k-regular graph. `k` is a target; a caller-supplied graph whose degrees exceed it
 *     was undercharged without bound (a 2000-clique with 4000 leaves charged 9% of the budget
 *     while running 32.8 s), so the counter's first version was still a model where it mattered.
 *   - each sweep's candidate scan, at `under.length`. Exposed by the correction above: per
 *     element it costs ~10x the BFS (a `hasEdge` Set probe each), and on an edgeless graph it is
 *     the entire run — 10.9 s against a sweep charge worth 0.33 s.
 *   - each pass's under-list rebuild (n) and sort (n log n). Charging only the sweeps admitted a
 *     239 s call, because at 36,000 passes the sort dominates.
 * Each of the three was found the same way: by a shape whose cost the other two could not see.
 *
 * Calibrated against measurement on this machine, taking the SLOWEST observed rate (6.8e7
 * units/s, the edgeless scan-bound shape; the traversal-bound shapes run at 1.2-2.6e8), against
 * shapes that exercise the MULTI-PASS regime — the mistake that sank the last predictive model,
 * whose three calibration points were all edgeless graphs that exit after one pass:
 *   ring(4000, 4)        ->  admitted,  1.9 s   (2.3e8, under half the budget)
 *   tri+cycle(600, 4)    ->  admitted,  1.5 s   (2.4e8)
 *   ring(200000, 2)      ->  admitted,  3 ms    (no deficit: one scan, whatever the size)
 *   ring(8000, 4)        ->  refused after 4.1 s   (9.8e8 if allowed to finish, 8.0 s)
 *   tri+cycle(1200, 4)   ->  refused after 3.1 s   (11.7 s)
 *   edgeless(20000, 2)   ->  refused after 7.4 s   (11.8 s)
 *   ring(400, 1e9)       ->  refused after 2.4 s   (4.5 s)
 *   clique(1200)+1600    ->  refused after 1.9 s   (4.5 s)
 *   tri+cycle(2400, 4)   ->  refused              (review measured 94.8 s)
 *   ring(36000, 4)       ->  refused              (review measured 239.5 s)
 * Every refusal is reached in under 10 s, which is the property a runtime counter buys and a
 * predicted budget cannot: the ceiling applies to the work done BEFORE the refusal too. The
 * budget fell from 1e9 when the two missing centres were charged; `ring(8000, 4)` is the one
 * shape that flipped from admitted to refused, and it is far outside `MAX_ROSTER`, which is what
 * the only live caller (`ringGreedy(..., {repair: true})`) is bounded by.
 */
export const MAX_REPAIR_WORK = 500_000_000;

/**
 * Estimated ringGreedy cost. Monotone in n and k.
 *
 * SHAPE-CORRECTED. The first version charged `n²` per edge in a k-regular graph, which is
 * wrong twice: the ring seed already supplies n of those edges for free, and the per-edge
 * work is a cache update plus a `findPair` scan rather than a cache update alone. Measured
 * against an instrumented operation counter, the old model's error grew with k — ratios of
 * 1.06 at (1000,4) but 2.19 at (1000,20) and 2.34 at (800,39) — so it was not an upper
 * bound at all, and `buildBuddyGraph(800, 39)` ran for 221 s under a constant documented as
 * "~60 s worst case". Charging the edges ACTUALLY added, at 3 units of scan per edge, holds
 * the ratio between 0.71 and 0.82 across the same 5x spread of shapes.
 */
export function greedyWork(n: number, k: number): number {
  const edgesAdded = Math.max(0, (n * Math.min(k, Math.max(0, n - 1))) / 2 - n);
  // `Math.max(edgesAdded, 1)` — the O(n²) baseline is unavoidable even when NO edges are
  // added, and without this floor the estimator returned exactly 0 for every k <= 2 at every
  // n (at k=2, n·k/2 − n = 0). That turned `repairDegrees`'s new budget check into no check
  // at all: `0 > MAX_GREEDY_WORK` is false for a roster of any size up to MAX_ROSTER. The
  // floor was missing from the correction that introduced `edgesAdded`, so the fix for one
  // unbounded path opened another.
  //
  // It cannot move ringGreedy's accept-set: for k >= 3 and n >= 2, edgesAdded is already >= 1,
  // and ringGreedy refuses k < 2 outright before reaching any budget.
  return 3 * n * n * Math.max(edgesAdded, 1);
}

// Work budget for the polish pass, expressed in the unit polish actually costs:
// iterations × (per-iteration edge-list build + full all-pairs re-measure), i.e.
// iters·n·m. The previous gate was `n <= 120`, which bounds n and nothing else —
// so the most expensive input on the whole default path sat just below it.
// Measured with default options before the change:
//   buildBuddyGraph(120, 12) -> 33.0 s
//   buildBuddyGraph(121, 12) ->  0.1 s     (one more person, 300x less work)
// Density never participated, and cost DECREASED with n across the threshold.
//
// The value is chosen to reproduce the old threshold exactly at k=4 — the
// configuration every fixture and the reroll boundary test use — so nothing that
// is pinned today moves: polishWork(120, 4, 20000) = 20000*(64 + 120*(120+240)) =
// 865,280,000 is admitted exactly, and polishWork(121, 4, 20000) = 879,740,000 is
// not. (The constant has been re-derived twice, once when POLISH_ITER_OVERHEAD was
// added and once when the per-iteration model was corrected to n*(n+m); the
// boundary it reproduces has never moved.) Denser rosters, which the n-cap waved
// through, are now refused: polishWork(120, 12) = 1.73e9.
//
// This is the GATE only — whether auto-polish runs at all. What it may then cost
// is enforced by `boundedPolishIterations` inside the primitives.
//
// HONEST RESIDUAL: this bounds the cost and makes the gate k-aware, but any
// on/off gate still has a discontinuity at its boundary — cost jumps from the
// budget to ~0 as n crosses it. Removing that entirely means deriving the
// ITERATION COUNT from the budget rather than switching polish off, which changes
// every polished output and would have to be mirrored in reference-python first.
// Recorded as a follow-on in lib/CLAUDE.md rather than done here.
export const MAX_POLISH_WORK = 865_280_000;

/**
 * Fixed cost of one polish iteration, in the same units as `n·m`.
 *
 * Without it the model says an iteration on a 3-person roster costs 9 units, so
 * the budget affords 64 million of them — and 64 million iterations of anything
 * is not free. MEASURED before this constant existed:
 * `buildBuddyGraph(3, 2, { polishIters: 1e9 })` took 35.7 SECONDS, on a
 * three-vertex graph, without even needing `polish: true`. Every iteration
 * rebuilds and sorts the edge list, allocates a Set in `proposeSwap`, and copies
 * the graph on improvement, none of which scales with n·m.
 */
const POLISH_ITER_OVERHEAD = 64;

/**
 * The iteration count polish may actually run, given the graph it was handed.
 *
 * THE ONE enforcement point, called from inside `polish` and `polishConstrained`
 * rather than from the wrappers above them. Three separate defects came from
 * having it anywhere else: the exported primitives are public API and bypassed a
 * wrapper clamp entirely (`polish(ring(20), { maxIters: Infinity })` never
 * returned); the cost model had no constant term; and the anneal calibration ran
 * before the bound applied.
 *
 * `m` is the ACTUAL edge count, not an estimate from k — the primitives hold the
 * graph, so they can afford to be exact where the pre-generation gate cannot. The
 * per-iteration model is `n·(n+m)`, the true cost of the `allPairsSummary` each
 * iteration performs; `n·m` under-charged sparse graphs by the entire n² term.
 */
export function boundedPolishIterations(
  n: number,
  m: number,
  requested: number | undefined,
  fallback: number,
): number {
  // CLAMPED TO THE DEFAULT, which is what makes `polishIters` a knob that can only ask for LESS
  // work — the property the previous version of this asserted in a comment and did not enforce.
  // It bounded `asked` by a single constant (20,000) equal to the UNCONSTRAINED default, so on
  // the constrained path, whose default is 8,000, a caller-supplied 20,000 bought 2.5x the
  // iterations: `buildConstrainedBuddyGraph(150, 4, cons)` measured 11.71 s by default and
  // 18.98 s with `polishIters: 20000`. Not a hang — `MAX_POLISH_WORK` still bounds it — but the
  // stated invariant was false, and the constant chosen to make it true could not, because it
  // was one number for two defaults. Clamping to the caller's own `fallback` makes it true for
  // every path, including any added later, and retires the constant.
  const asked = Number.isInteger(requested) && (requested as number) >= 0
    ? Math.min(requested as number, fallback)
    : fallback;
  // The overhead term also guarantees a positive divisor when m is 0.
  const perIteration = POLISH_ITER_OVERHEAD + n * (n + m);
  // The budget LEFT after the fixed sweeps, not the whole budget — see `loopBudget`.
  return Math.min(asked, Math.floor(loopBudget(n, m) / perIteration));
}

/**
 * Estimated polish cost: iterations × per-iteration work. The dominant term is
 * `allPairsSummary`, which is Theta(n·(n+m)) — NOT n·m: it allocates and fills an
 * `Int32Array(n)` and runs an n-wide accumulation per source regardless of how
 * few edges there are.
 *
 * Modelling it as n·m under-charged sparse graphs by the whole n² term, and the
 * gap is not academic: a 3000-vertex graph with 4 edges was afforded the full
 * 20,000 iterations, of which 2,000 took 67.6 s. `m` is estimated from (n, k) at
 * the gate, where the seed graph does not exist yet.
 */
export function polishWork(n: number, k: number, iters: number): number {
  const m = (n * Math.min(k, Math.max(0, n - 1))) / 2;
  return iters * (POLISH_ITER_OVERHEAD + n * (n + m));
}

/**
 * The size cap the polish paths were missing.
 *
 * `boundedPolishIterations` is a WORK cap, and it was the only gate on `polish` /
 * `polishConstrained` — but both pay two to three full `allPairsSummary` sweeps
 * (Theta(n·(n+m)) each) plus two graph copies OUTSIDE the loop, to compute the
 * starting energy and the baseline measurement. Work before the loop is work the
 * iteration budget cannot reach, so a call the budget prices at ZERO iterations
 * still ran: `polish(ring(40000), { maxIters: 0 })` took 160 seconds, and
 * `polishConstrained(ring(30000), cons, { iters: 0 })` took 48.
 *
 * The module header says every path needs both a size cap and a work cap; polish
 * had one. The threshold is not a new number — a single sweep must fit the same
 * `MAX_POLISH_WORK` the whole loop is held to, which is the tightest bound that
 * cannot refuse a configuration the loop itself would have accepted. It leaves the
 * documented ceilings intact: n=5000 at k=4 on the constrained path costs 7.5e7,
 * comfortably inside, while the 40000-ring costs 3.2e9 and is refused.
 */
/**
 * All-pairs sweeps a polish pass pays OUTSIDE its loop: the starting energy, the final
 * summary of the best graph, and the anneal calibration's amortised share. Three is the
 * measured count for `polish`; `polishConstrained` pays two, and charging both the larger
 * figure keeps one constant instead of two that could drift.
 */
const FIXED_POLISH_SWEEPS = 3;

export function checkPolishSize(n: number, m: number): void {
  const fixed = FIXED_POLISH_SWEEPS * n * (n + m);
  // ONE question, not two. The gate used to ask only whether the fixed sweeps fit the budget,
  // which left a band — n·(n+m) in (2.16e8, 2.88e8] — where they fit and nothing was left over,
  // so the call was ADMITTED, paid three all-pairs sweeps and two graph copies, and returned its
  // input byte-for-byte: `polish(ring(11000))` spends 6.68 s to report `iters: 0`, and
  // `polishConstrained`'s return value carries no iteration count at all, so there is nothing in
  // it to tell the caller the pass did not happen. Asking whether the loop can afford a single
  // iteration subsumes the old check (fixed > budget ⇒ nothing left ⇒ refused) rather than adding
  // to it, and it cannot refuse a configuration the loop would have accepted: by construction the
  // loop would have run zero times.
  if (loopBudget(n, m) < POLISH_ITER_OVERHEAD + n * (n + m)) {
    throw new Error(
      `graph too large to polish: the fixed all-pairs sweeps cost ${fixed} of a ${MAX_POLISH_WORK} ` +
        `budget, leaving nothing for the loop (n=${n}, m=${m}) — reduce the roster or skip polish`,
    );
  }
}

/**
 * What the loop may still spend once the fixed sweeps are paid for.
 *
 * `checkPolishSize` and `boundedPolishIterations` were each measuring against the WHOLE
 * budget, so a graph that just fits the size gate was then granted a full budget of loop
 * iterations on top — the two gates summed to more than the constant they both cite. The
 * accept-set has to be defined by the total, so the size check charges the fixed work and
 * the iteration count is derived from what is left.
 */
function loopBudget(n: number, m: number): number {
  return Math.max(0, MAX_POLISH_WORK - FIXED_POLISH_SWEEPS * n * (n + m));
}

// Default minimum degrees of separation to aim for (the `mind`/`minSeparation`
// option). Shared so the two generation entry points can't drift apart.
export const DEFAULT_MIN_SEPARATION = 5;


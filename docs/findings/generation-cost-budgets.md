# Unconstrained generation and polish: cost budgets

*The calibration behind the constants in `lib/src/core/budgets.ts` (plus the runtime counter
in `greedy.ts` and one measurement from `graph.ts`). The source keeps one-line pointers here;
this is where the numbers live. Consult it before changing any of these values.*

## The one-line lesson

Every budget here is a **product**, not a cap on one dimension. `ringGreedy` updates an O(n²)
distance cache once per edge added; polish recomputes a Θ(n·(n+m)) all-pairs summary once per
iteration. Cap n and the other factor is still free — which is how a **memory** cap (`MAX_CACHED_N`)
let `(1000, 999)` run **over 22 minutes**, and how an `n <= 120` polish gate left a **33 s**
call sitting just under it.

## Scope

This document covers the **unconstrained** generator and **all** the polish budgets:
`greedyWork` / `MAX_GREEDY_WORK`, `MAX_REPAIR_WORK`, `polishIterationCost` /
`POLISH_ITER_OVERHEAD` / `PRIOR_PROBE_COST`, `polishWork` / `MAX_POLISH_WORK`,
`checkPolishSize` / `FIXED_POLISH_SWEEPS` / `loopBudget`, `boundedPolishIterations`, and the
`Graph.degree` guard.

The **constrained** path's caps — `MAX_CONSTRAINED_N`, `MAX_CONSTRAINED_WORK`,
`PROHIBITED_PROBE_COST`, `constrainedWork` — are a separate cost model with a separate
document: [`constrained-generation-cost-and-caps.md`](./constrained-generation-cost-and-caps.md).
Read that one for anything on the constrained side; nothing is duplicated between the two.

**Why the two are not one budget.** The accept-sets are deliberately **not nested**. The
unconstrained path pays O(n²) per edge (a cache update); the constrained path pays O(n) per
edge (a BFS). A single shared constant would either refuse working configurations here or
admit hanging ones there.

## Portability caveat (stated once, applies to every number below)

Every timing is wall-clock **on the machine that review round ran on**. These are **relative
rates and ratios**, not portable absolutes. A number quoted as "X units/s" is only meaningful
against the other rates in the same table. If you re-measure on different hardware, expect the
absolute seconds to move and the *shapes* of the curves — which rate falls with density, which
term dominates — to hold. The budgets are calibrated to the shapes.

---

## `greedyWork(n, k)` — the estimator

```
edgesAdded = max(n·min(k, n-1)/2 − n, 1)
greedyWork = 3·n²·edgesAdded
```

Completion updates the O(n²) cache once per edge added and adds ~`n·min(k,n-1)/2` edges, so
wall-clock tracks `n³·k/2`. Two corrections got the estimator to an actual upper bound:

**The ring seed is free, and the per-edge work is a cache update *plus* a `findPair` scan.**
Charging `n²` per edge of a *k-regular* graph is wrong twice — the ring seed already supplies
n of those edges, and the scan is uncharged. Measured against an instrumented operation
counter, as **counted ops ÷ estimate**:

| shape | old model (`n²` per k-regular edge) | current model (3 units of scan per edge actually added) |
|---|---|---|
| (1000, 4) | 1.06 | |
| (1000, 20) | 2.19 | |
| (800, 39) | 2.34 | |
| across the same 5x spread | 1.06 – 2.34 | **0.71 – 0.82** |

A ratio above 1 means the estimate is *under* the real cost — the old shape was not an upper
bound at all, and its error grew with k. The current shape overcharges by a consistent
1.2–1.4x across the same spread, which is what an upper bound looks like.

**The `max(edgesAdded, 1)` floor.** The O(n²) baseline is paid even when no edges are added.
Without the floor the estimate is **exactly 0 for every k ≤ 2 at every n** (at k=2,
`n·k/2 − n = 0`), which turns `repairDegrees`'s budget check into no check at all: `0 >
MAX_GREEDY_WORK` is false for a roster of any size up to `MAX_ROSTER` (1 000 000). The floor
cannot move `ringGreedy`'s accept-set: at k ≥ 3, n ≥ 2, `edgesAdded` is already ≥ 1, and
`ringGreedy` refuses k < 2 before reaching any budget.

## `MAX_GREEDY_WORK = 15_000_000_000`

The **time** bound. `MAX_CACHED_N` (5000) bounds only the flat n×n distance cache's *memory*.

### The measurements

Wall-clock is a property of the shape, so every row below is comparable across both estimator
generations:

| shape | edges added | pre-correction estimate | `greedyWork` (current) | measured | implied rate |
|---|---|---|---|---|---|
| (500, 4) | 500 | 2.5e8 | 3.75e8 \* | 0.55 s | 6.8e8 units/s |
| (1000, 4) | 1 000 | 2.0e9 | 3.0e9 | 5.4 s, later 6.9 s | 5.6e8 / 4.3e8 units/s |
| (1500, 4) | 1 500 | 6.8e9 | 1.01e10 \* | 16.8 s | 6.0e8 units/s |
| (1000, 12) | 5 000 | 6.0e9 | **1.5e10** | **38.5 s** | 3.9e8 units/s |
| (1000, 20) | 9 000 | 1.0e10 \* | 2.7e10 | 137 s | 2.0e8 units/s |
| (800, 39) | 14 800 | 9.98e9 \* | 2.8e10 | 221 s | **1.29e8 units/s** |
| (1000, 999) | 498 500 | 5.0e11 | 1.5e12 \* | >22 min (did not return) | — |
| (5000, 4) | 5 000 | 2.5e11 | 3.75e11 \* | tens of minutes | — |

\* computed from the stated formula; the source tables recorded only the other cells.

The rate **falls monotonically with density** — 6.8e8 units/s sparse down to 1.29e8 units/s at
(800, 39) — because each BFS/scan gets more expensive as m grows. Sparse runs are 2–3x faster
than the dense end.

### The calibration point

1.5e10 is the **tightest value that still admits (1000, 12)**, the app's advertised ceiling
(`MAX_ROSTER_N = 1000` in `app/src/model.ts`, up to 12 buddies), which ships today. That
configuration sits **exactly** on the cap.

| shape | `greedyWork` | verdict |
|---|---|---|
| (1000, 4) | 3.0e9 | admitted (6.9 s) |
| (1000, 12) | 1.5e10 | **admitted exactly — the calibration point** |
| (1000, 20) | 2.7e10 | refused (would have been 137 s) |
| (800, 39) | 2.8e10 | refused (would have been 221 s) |
| (1000, 999) | 1.5e12 | refused |
| (5000, 4) | 3.75e11 | refused |

The two refused mid-range shapes are exactly the ones that broke the documented promise.
Tightening below 1.5e10 refuses a configuration the product advertises; that is the constraint
that fixes the value from below.

### Reconciled: the worst case this budget allows

Earlier prose in `budgets.ts` read **"1e10 is therefore ~60 s worst case."** That sentence is
**stale on every term** and should not be carried forward:

- **The constant is 1.5e10, not 1e10.** The value was recalibrated when the estimator's shape
  was corrected; the accept-set changed, not just the number.
- **The units changed.** ~60 s came from 1e10 ÷ ~1.5e8 units/s (= 67 s), a rate measured in
  *pre-correction* units. Old and new units are not interchangeable: on (800, 39) the same
  shape prices at 9.98e9 old vs 2.8e10 new, a 2.8x difference.
- **It was falsified in fact, not merely superseded.** (800, 39) priced at 9.98e9 under the old
  model, cleared the 1e10 budget of the day, and ran **221 s** — 3.7x the documented "~60 s".

**What the tables do settle.** The slowest shape *inside* the current accept-set that was
actually measured is the calibration point itself: **(1000, 12), sitting exactly on 1.5e10, at
38.5 s.** No admitted shape has been measured above that.

**What they do not settle.** The accept-set's *densest* corner is unmeasured. At the budget,
`edgesAdded = 1.5e10 / (3n²)`, so the densest admitted shape at n=1000 is k=12, at n=800 it is
k=21 (1.46e10; k=22 is 1.54e10 and refused), and at n=600 it is k=48 (1.49e10). Rates fall with
density, and none of (800, 21) / (600, 48) was timed.

**The bound the tables support.** Applying the **slowest rate observed anywhere in the sweep**
— 1.29e8 units/s, at (800, 39) — to the full budget gives **1.5e10 ÷ 1.29e8 ≈ 116 s**. The
true worst case is bracketed: **≥ 38.5 s (measured at the calibration point) and ≤ ~116 s
(slowest observed rate applied to the whole budget)**. Anyone who needs it tighter should time
(800, 21) and (600, 48); that is the missing measurement, and until it exists **~116 s is the
honest ceiling to quote — not 60 s**.

---

## `MAX_REPAIR_WORK = 500_000_000` — counted, not predicted

`repairDegrees` **accumulates the work it actually does** and stops when it exceeds this
constant. It is the only budget here that is not a prediction, and that is a deliberate
consequence of measurement rather than a stylistic choice.

### Why prediction fails here

A pass ends as soon as **one** vertex is successfully paired, so the number of `bfsDistances`
sweeps per pass is anywhere from 1 to the number of under-degree vertices, depending on which
of them happen to be far enough apart. That is a property of graph **structure**, and no
function of (n, k, deficit) captures it. Four predictive models, four different failures:

| model | how it failed |
|---|---|
| reuse `greedyWork` | prices **edges added**, a quantity repair does not spend |
| `greedyWork` × 4 | same wrong quantity, scaled |
| under-count × passes × sweep | true worst case, so loose it **refused a 35 ms call** |
| passes × sweep | tracked three calibration points and **admitted a 239 s call** |

The last failure is the instructive one: all three calibration points were **edgeless** graphs,
where every candidate is unreachable, `distv[v] < minDist` rejects everything, and the loop
exits after **one** pass. A multi-pass model fitted to single-pass data, with a guard test on
the same shape, cannot catch itself. `repairDegrees(ring(36000), 4)` was admitted at 6.48e9 of
a 6.6e9 budget and ran **239.5 s**.

### The three counted cost centres

Units are real work. Dropping any one undercharges some shape without bound:

1. **Each `bfsDistances` sweep, at `n + 2m`** — the adjacency that *exists*, not `n + n·k`,
   which prices a k-regular graph. `k` is a **target**. For any graph whose real degrees exceed
   it, `n + n·k` undercharges without bound: a **2000-clique with 4000 leaves** (n=6000,
   m=2.0e6) charged **9.3e7 of a 1e9 budget — 9%** — while performing **8.0e9** real traversal
   steps and running **32.8 s**.
2. **Each sweep's candidate scan, at `under.length`** — a `hasEdge` Set probe per entry, which
   costs roughly **10x the BFS per element**. On an edgeless graph the BFS finds nothing to walk
   and the scan *is* the run: 20 000 sweeps over 20 000 candidates, **10.9 s** against a call
   the sweep charge alone priced at **0.33 s**. `under.length` is the exact scan length (no
   early exit), so it is counted, not estimated.
3. **Each pass's under-list rebuild (n) and sort (n log n)** — at **36 000 passes** the sort
   dominates; charging only the sweeps admitted the **239 s** call above.

Each centre was exposed by a shape the other two could not see.

### Calibration

Against the **slowest observed rate — 6.8e7 units/s**, the edgeless scan-bound shape
(traversal-bound shapes run at 1.2–2.6e8 units/s), and against shapes that exercise the
**multi-pass** regime:

| shape | verdict | notes |
|---|---|---|
| `ring(4000, 4)` | admitted, 1.9 s | 2.3e8 — under half the budget |
| `tri+cycle(600, 4)` | admitted, 1.5 s | 2.4e8 |
| `ring(200000, 2)` | admitted, 3 ms | no deficit: one scan, whatever the size |
| `ring(8000, 4)` | refused after 4.1 s | 9.8e8 if allowed to finish (8.0 s) |
| `tri+cycle(1200, 4)` | refused after 3.1 s | 11.7 s if allowed to finish |
| `edgeless(20000, 2)` | refused after 7.4 s | 11.8 s |
| `ring(400, 1e9)` | refused after 2.4 s | 4.5 s |
| `clique(1200)+1600` | refused after 1.9 s | 4.5 s |
| `tri+cycle(2400, 4)` | refused | 94.8 s if allowed to finish |
| `ring(36000, 4)` | refused | 239.5 s if allowed to finish |

**Every refusal is reached in under 10 s.** That is the property a runtime counter buys and a
predicted budget cannot: the ceiling applies to the work done *before* the refusal too.

The budget fell from 1e9 to 5e8 when the two missing centres were charged. `ring(8000, 4)` is
the **one** shape that flipped from admitted to refused, and it is unreachable through the only
live caller — `ringGreedy(..., { repair: true })`, bounded at n ≤ 5000 by `MAX_CACHED_N`.

---

## The polish per-iteration unit

```
polishIterationCost(n, m, priorCount)
  = POLISH_ITER_OVERHEAD + n·(n + m) + PRIOR_PROBE_COST·priorCount
  = 64 + n·(n + m) + 12·priorCount
```

**ONE definition, shared by all three gates** (`polishWork`, `boundedPolishIterations`,
`checkPolishSize`). Spelled out separately, a cost dimension can go missing from all three at
once — or worse, be added to two of them. A cost model duplicated three ways is a cost model
that will disagree with itself.

### `n·(n+m)`, not `n·m`

The dominant term is `allPairsSummary`, which is **Θ(n·(n+m))**: it allocates and fills an
`Int32Array(n)` and runs an n-wide accumulation **per source**, regardless of how few edges
there are. Modelling it as `n·m` undercharges sparse graphs by the **whole n² term**, and the
gap is not academic — a **3000-vertex graph with 4 edges** was afforded the full 20 000
iterations, of which **2 000 took 67.6 s**.

### `POLISH_ITER_OVERHEAD = 64`

The fixed cost of one iteration, in the same units as `n·m`. Every iteration rebuilds and sorts
the edge list, allocates a `Set` in `proposeSwap`, and copies the graph on improvement — none
of which scales with `n·m`. Without this term the model prices an iteration on a 3-person
roster at **9 units**, so the budget affords **64 million** of them. Measured before the
constant existed: `buildBuddyGraph(3, 2, { polishIters: 1e9 })` took **35.7 seconds** on a
three-vertex graph, without even needing `polish: true`.

It also guarantees a positive divisor when m is 0.

### `PRIOR_PROBE_COST = 12`

Per **weighed** prior pair, per iteration. `constrainedMeasure` re-counts every prior pair on
every measurement (`countPresentEdges`), so the prior set is a **third dimension** of the
per-iteration cost — invisible to a model built from (n, m) alone, and **on by default**
(`buildConstrainedBuddyGraph` resolves `priorWeight` to `DEFAULT_PRIOR_WEIGHT` whenever any
prior exists).

Measured at **n=268, k=1** — the densest shape the auto-polish gate still admits, which is why
it is the calibration point (m=134, so `n·(n+m)` = 107 736, at the constrained default of
8 000 iterations):

| priors | time | priors | time |
|---|---|---|---|
| 0 | 3.99 s | 9 034 | 6.34 s |
| 1 813 | 4.23 s | 18 012 | 10.50 s |
| | | 35 778 (all pairs) | **17.58 s** |

A **4.4x** overrun of a budget that returned no refusal. Per probe the marginal rate **rises**
with the prior count — **16.6 ns** at 1.8k priors, **47.5 ns** at 35.8k, against **4.63 ns**
for one unit of the `n·(n+m)` term. So this is a **FLOOR calibrated on the slowest observed
rate** (47.5 / 4.63 = **10.3 units per prior, rounded up**), not a model of the shape. Same
posture as `PROHIBITED_PROBE_COST` on the constrained path.

Charged **only when the priors are actually weighed**: at `priorWeight` 0, `constrainedMeasure`
never builds the penalty and the probes do not happen, so callers pass 0 and a configuration
that costs nothing is never refused. The unconstrained `polish` has no prior term at all and
passes 0 always.

---

## `MAX_POLISH_WORK = 865_280_000` — the auto-polish gate

`polishWork(n, k, priorCount, iters) = iters · polishIterationCost(n, n·min(k,n-1)/2, priorCount)`.
`m` is estimated from (n, k) because the seed graph does not exist yet at the gate;
`priorCount` is exact, because the caller holds the `Constraints`.

### Why an n-cap was the wrong gate

The previous gate was `n <= 120`, which bounds n and nothing else — so the most expensive input
on the whole default path sat just below it. Measured with default options before the change:

```
  buildBuddyGraph(120, 12) -> 33.0 s
  buildBuddyGraph(121, 12) ->  0.1 s     (one more person, 300x less work)
```

Density never participated, and cost **decreased** with n across the threshold.

### Why this exact value

Chosen to reproduce the old threshold **exactly at k=4** — the configuration every fixture and
the reroll boundary test use — so nothing pinned today moves:

```
  polishWork(120, 4, 0, 20000) = 20000·(64 + 120·(120+240)) = 865,280,000   admitted exactly
  polishWork(121, 4, 0, 20000) =                              879,740,000   refused
```

The constant has been re-derived twice — once when `POLISH_ITER_OVERHEAD` was added, once when
the per-iteration model was corrected to `n·(n+m)` — and **the boundary it reproduces has never
moved**. Denser rosters, which the n-cap waved through, are now refused: `polishWork(120, 12)`
= **1.73e9** (that figure predates the `n·(n+m)` correction; under the current model it is
2.02e9 — refused either way).

**Changing this constant moves outputs that are pinned today.** Fixtures and the reroll
boundary test depend on the k=4 boundary landing at exactly 120/121.

### What this gate is and is not

This is the **gate only** — whether auto-polish runs at all. What it may then cost is enforced
by `boundedPolishIterations` inside the primitives.

**Honest residual:** this bounds the cost and makes the gate k-aware, but any on/off gate still
has a discontinuity at its boundary — cost jumps from the budget to ~0 as n crosses it.
Removing that entirely means deriving the **iteration count** from the budget rather than
switching polish off, which changes every polished output and would have to be mirrored in
`reference-python` and the fixtures regenerated. Tracked in `lib/CLAUDE.md`, not done here.

---

## Work outside the loop: `FIXED_POLISH_SWEEPS`, `loopBudget`, `checkPolishSize`

`boundedPolishIterations` is a **work** cap on the loop, and for a while it was the only gate on
`polish` / `polishConstrained`. But both pay **two to three full `allPairsSummary` sweeps**
(Θ(n·(n+m)) each) plus two graph copies **outside** the loop, to compute the starting energy and
the baseline measurement. Work before the loop is work the iteration budget cannot reach, so a
call the budget priced at **zero iterations still ran**:

```
  polish(ring(40000), { maxIters: 0 })              -> 160 s
  polishConstrained(ring(30000), cons, { iters: 0 }) ->  48 s
```

**`FIXED_POLISH_SWEEPS = 3`** — the starting energy, the final summary of the best graph, and
the anneal calibration's amortised share. Three is the measured count for `polish`;
`polishConstrained` pays two, and charging both the larger figure keeps one constant instead of
two that could drift.

**`loopBudget(n, m) = max(0, MAX_POLISH_WORK − 3·n·(n+m))`** — what the loop may still spend
once the fixed sweeps are paid for. Both `checkPolishSize` and `boundedPolishIterations` once
measured against the **whole** budget, so a graph that just fit the size gate was then granted a
full budget of loop iterations on top: the two gates summed to more than the constant they both
cite. The accept-set has to be defined by the **total**.

**`checkPolishSize` asks ONE question, not two:** can the *loop* afford a single iteration
(`loopBudget(n,m) < polishIterationCost(n,m,priorCount)` ⇒ throw)? Asking only whether the fixed
sweeps *fit* left a band — `n·(n+m)` in **(2.16e8, 2.88e8]** — where they fit and nothing was
left over, so the call was **admitted**, paid three all-pairs sweeps and two graph copies, and
returned its input byte-for-byte. `polish(ring(11000))` (n·(n+m) = 2.42e8, inside the band)
spends **6.68 s** to report `iters: 0`, and `polishConstrained`'s return value carries no
iteration count at all, so nothing in it tells the caller the pass did not happen.

The loop-affordability question **subsumes** the fixed-sweeps question (fixed > budget ⇒ nothing
left ⇒ refused) rather than adding to it, and it cannot refuse a configuration the loop would
have accepted: by construction the loop would have run zero times.

The threshold is not a new number — a single sweep must fit the same `MAX_POLISH_WORK` the whole
loop is held to, which is the tightest bound that cannot refuse a configuration the loop itself
would have accepted. It leaves the documented ceilings intact:

| shape | `n·(n+m)` | verdict |
|---|---|---|
| n=5000, k=4 (constrained path ceiling) | 7.5e7 | comfortably inside |
| `ring(11000)` | 2.42e8 | inside the old dead band; now refused |
| `ring(40000)` | 3.2e9 | refused (was 160 s) |

**Call-site ordering matters:** `checkPolishSize` runs **before the copy and before `energy`**.
`allPairsSummary` inside `energy` is Θ(n·(n+m)) while `copy` is only O(n+m), and neither is
reachable by the iteration budget — which is why a call priced at zero iterations still ran
160 s at n=40000.

---

## `boundedPolishIterations(n, m, priorCount, requested, fallback)`

**THE ONE enforcement point** for the iteration count, called from **inside** `polish` and
`polishConstrained` rather than from the wrappers above them. Three separate defects came from
having it anywhere else:

- the exported primitives are **public API** and bypassed a wrapper clamp entirely —
  `polish(ring(20), { maxIters: Infinity })` never returned;
- the cost model had no constant term (see `POLISH_ITER_OVERHEAD`);
- the anneal calibration ran **before** the bound applied.

`m` is the **actual** edge count, not an estimate from k — the primitives hold the graph, so
they can afford to be exact where the pre-generation gate cannot.

It returns against **`loopBudget`**, the budget left after the fixed sweeps, not the whole
budget.

### The `min(requested, fallback)` clamp

Clamped to **the caller's own default**, which is what makes `polishIters` a knob that can only
ask for **less** work. Bounding `asked` by a single constant cannot do that: the constant was
20 000, the **unconstrained** default, so on the constrained path — whose default is **8 000** —
a caller-supplied 20 000 bought **2.5x** the iterations:

```
  buildConstrainedBuddyGraph(150, 4, cons)                          -> 11.71 s
  buildConstrainedBuddyGraph(150, 4, cons, { polishIters: 20000 })  -> 18.98 s
```

Not a hang — `MAX_POLISH_WORK` still bounds it — but the stated invariant was false, and one
number cannot be true for two defaults. Clamping to the caller's own `fallback` makes it true
for every path, including any added later, and retires the constant.

---

## The anneal temperature calibration cap (in `polish`)

The calibration is **real work**, charged against the same budget as the loop, and capped at
**half** of it. Each trial is a full `energy()` — one `allPairsSummary`, the same cost as a loop
iteration. Three corrections were needed to price it honestly:

1. it ran **unconditionally**, so `{ maxIters: 0 }` still did 100 sweeps — **587 ms at n=300**;
2. bounded by `maxIters` but **not subtracted** from it, so the two gates together could spend
   twice the budget they both cite;
3. subtracting it while still capping at `maxIters` made **any budget ≤ 100 vanish entirely
   into setup** — `loopIters` 0, no accept/reject decision, the input returned byte-for-byte,
   and `polished: true` reported. A silent no-op sold as work.

**Half** is the floor that keeps a decision affordable at every budget the gates admit.

(`rejectCap = 200·n` in `polish` is an empirically-tuned early-stop for `"hill"` mode. No
measurement was recorded for it; it is the one polish constant here without one.)

---

## `Graph.degree`'s guard — the measurement, and why the first one was wrong

The guard is one `Number.isInteger` and two comparisons on a path the generators call ~n²k
times, so its cost was **measured rather than assumed** — and the first measurement was wrong.

| method | unguarded | guarded | reading |
|---|---|---|---|
| single run of `buildBuddyGraph(600, 8)` | 3.84 s | 4.68 s | looked like a **22% regression** |
| medians, repeated | **4.90 s** | **5.19 s** | ranges **overlap**: 4.52–5.42 vs 4.77–5.30 |

The honest figure is **single-digit percent at most — not zero, and not 22%**. A single run of a
sub-10% effect is noise.

It is paid because every internal caller passes a loop index, so the branch never fires, and
because the alternative is a public read path that answers `1` for `degree("0")`.

---

## What would change these conclusions

- **A different machine.** Absolute seconds move; re-derive the constants from the *ratios*, not
  by scaling the numbers.
- **Timing (800, 21) and (600, 48).** These are the unmeasured dense corners of
  `MAX_GREEDY_WORK`'s accept-set. They are what would replace the ≥38.5 s / ≤~116 s bracket with
  a single figure.
- **An incremental or sampled all-pairs energy.** `polishIterationCost`'s dominant term is a
  full `allPairsSummary` per iteration. Replace it and `MAX_POLISH_WORK`, `loopBudget`,
  `FIXED_POLISH_SWEEPS` and `checkPolishSize` all need re-deriving together — they are one model
  in four places.
- **An incremental single-source distance scheme** on the constrained path would let those
  ceilings rise; see [`constrained-generation-cost-and-caps.md`](./constrained-generation-cost-and-caps.md).
- **Any new dimension the inner loop probes.** `PRIOR_PROBE_COST` and `PROHIBITED_PROBE_COST`
  both exist because a dimension the generator touched every iteration was invisible to a model
  built from (n, m) or (n, k). If a new one appears, it goes into `polishIterationCost` — the one
  definition — and it is **required**, not defaulted: an optional argument is exactly how the
  dimension went missing the first time.
- **Raising the app's advertised ceiling.** `MAX_GREEDY_WORK` is pinned from below by (1000, 12)
  and `MAX_POLISH_WORK` from below by the k=4 boundary at n=120. Move either product promise and
  both constants need re-deriving, and the fixtures with them.

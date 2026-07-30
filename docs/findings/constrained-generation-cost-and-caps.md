# Constrained generation: cost model and safety caps

*Hard-won during the M1 adversarial review of the constraint core (2026-07). The code
is in `lib/src/core/{constrainedGreedy,constraints,graph}.ts`; this explains the why.*

*Sibling document: [`generation-cost-budgets.md`](./generation-cost-budgets.md) covers the
**unconstrained** generator (`greedyWork` / `MAX_GREEDY_WORK`, `MAX_REPAIR_WORK`) and **all** the
polish budgets. The two cost models are deliberately separate and their accept-sets are not
nested — this path pays O(n) per edge for a BFS, that one pays O(n²) per edge for a cache update.*

*Scope here: `MAX_CONSTRAINED_N`, `MAX_CONSTRAINED_WORK`, `PROHIBITED_PROBE_COST`,
`constrainedWork`, the connectivity-repair stages, and the cost of `validate` /
`validateDetailed` itself.*

**Portability caveat, stated once.** Every timing below is wall-clock on the machine that review
round ran on. They are **relative rates and ratios**, not portable absolutes; the *shapes* — which
rate falls with density, which term dominates — are what the constants are calibrated to.

## The one-line lesson

`constrainedGreedy` runs **one BFS per edge added**, and it adds `~n·min(k,n-1)/2`
edges. That makes wall-clock scale like **`n²·min(k,n-1)`** — quadratic in n *and*
linear in k. Both dimensions have to be bounded, or a perfectly legal input hangs for
minutes to days.

## Two caps, two different cost sources

Neither cap subsumes the other; they bound genuinely different things.

- **`MAX_CONSTRAINED_N` (5000)** — bounds the costs that depend on *n alone*: the O(n²)
  generation floor even at k=1, and `validate`'s own O(n²) prohibited-pair connectivity
  walk. At k=1 the work estimate is `~n²`, so a work-cap alone would admit n≈10 000,
  where that connectivity walk does ~1e8 ops. The n-cap is what catches that.
- **`MAX_CONSTRAINED_WORK` (1e8, compared against `constrainedWork(n,k) = n²·min(k,n-1)`)**
  — bounds the `min(k,n-1)` multiplier the n-cap misses. Without it, a dense roster like
  `n=500, k=499` clears the n-cap and then generates for ~89 s; `n=5000, k=4999` runs for
  days. Both pass `validate` (no prohibited/required pairs → feasible).

Both are enforced identically at all three entry points: a refusal in `validate`, a throw
in `constrainedGreedy`'s precondition, and (via `validate`) a refusal from
`buildConstrainedBuddyGraph`. Mirrored in `reference-python/constraints.py`.

## The metric that looked right and wasn't

The first instinct — and a reviewer's explicit suggestion — was to budget on the **edge
count**, `n·min(k,n-1)`. Measurement killed it. At a *fixed* edge count the wall-clock
varies by ~15×, because larger n is costlier per edge (each BFS is O(n)):

| n | k | `n·min(k,n-1)` | time |
|---|---|---|---|
| 250 | 200 | 50 000 | 3.1 s |
| 1250 | 40 | 50 000 | 12 s |
| 2500 | 20 | 50 000 | 24 s |
| 5000 | 10 | 50 000 | **45 s** |

Same metric, 3 s vs 45 s. The edge count does not bound time. Adding the per-edge factor
gives `n²·min(k,n-1)`, which held to ~2× across the whole sparse/dense range
(~7.5M units/s sparse, dropping to ~2.2M/s in the near-complete corner as BFS depth grows
with m). That is the metric the cap actually uses.

**The transferable lesson:** when you cap "work," cap the thing you *measured*, not the
thing that reads cleanly. An elegant proxy that a profiler disagrees with is just wrong.

## Worst case the caps allow

- Sparse (`n=5000, k=4`, at the budget): ~13 s. **Re-measured at 15.0 s** in the later round
  that calibrated `PROHIBITED_PROBE_COST` (same shape, same machine, different round). Both
  figures are recorded; quote **13–15 s**, not one of them as exact.
- Deepest allowed dense corner (`n≈464, k=n-1`): ~46 s. Unrealistic input (nearly a
  complete graph), bounded, and refused just past it.

The caps are coarse by design — they prevent the minutes-to-days hang, not every slow
input. The real fix is a tracked follow-on: an **incremental single-source distance
scheme** that removes the per-edge BFS entirely, which would let both ceilings rise.

---

## `PROHIBITED_PROBE_COST = 80` — the third dimension the (n, k) estimator could not see

`constrainedWork` was `(n, k)`-only while **every legality decision in the generator is a
`cons.isProhibited` probe**. A dense prohibited set does not merely make each probe dearer — it
makes more candidates *fail*, so more are scanned per edge added. Measured at k=4:

| roster | 0 pairs | 250 000 pairs | 1 000 000 pairs |
|---|---|---|---|
| n=5000 | **15.0 s** (at the budget) | 42.8 s | **49.4 s** |
| n=3000 | 5.5 s | — | **17.1 s** |

### Why the charge is a floor, not a shape

The marginal rate **falls** as pairs rise — **742 units/pair at 250k, 230 units/pair at 1M** — so
a linear term cannot be the true shape. (This library has already watched four successive
predictive models of `repairDegrees`'s cost fail; see the sibling document.) The constant is
therefore calibrated as a **rate on the one shape with headroom to measure it**:

```
  n=3000, k=4:  1M pairs costs 11.7 s more than 0 pairs
                that roster's observed rate is 6.55e6 units/s
                11.7 s × 6.55e6 = 7.66e7 units over 1e6 pairs = 77 units/pair
                rounded up -> 80
```

`n=5000, k=4` cannot be the calibration shape: its base term already sits **exactly** on the
budget, so any positive charge refuses it and the shape teaches nothing.

### Where it binds

Only **above n≈1500 with a large fraction of all pairs prohibited** — precisely the regime
measured. It can never bind at **n ≤ 500**, where the base term alone is ≥ 1e7 per unit of k.
The app's own ceiling is **200 prohibited pairs = 12 800 units**, so nothing the app can express
is affected by this term.

### What it buys

The **invariant**, not an accurate prediction: adding prohibited pairs can only move an input
*toward* refusal, so no dimension the inner loop probes is invisible to the gate.

## `constrainedWork(n, k, prohibitedCount)` — why `prohibitedCount` is required, not defaulted

Both callers hold the `Constraints` when they call it, and an optional argument is exactly how
the dimension went missing the first time. With the `(n, k)`-only estimator, a **sparse** roster
sitting exactly on the budget (`n=5000, k=4`) cost **49.4 s against a calibrated 15.0 s — 3.3x
the calibrated worst case — while `validate` returned `[]`**, i.e. no refusal at all.

Same posture, and the same reason, as `polishWork`'s required `priorCount` on the polish side.

---

## The cost of refusing: `validate` / `validateDetailed` and the reason list

`validate`'s contract is that it **refuses rather than throws**. Before
`MAX_STRUCTURAL_REASONS = 16`, it did both — unbounded in work *and* in output. The old shape
built two `Reason` objects per malformed pair, `normalize` built a Map of all of them and
**sorted** it, then `validate` mapped `formatReason` over the survivors again:

| input | result |
|---|---|
| 10-person roster, 1 000 000 out-of-range prohibited pairs | `validateDetailed` returned **2 000 000 reasons in 5.0 s**, RSS **197 MB → 925 MB**; `validate` spent a further **7.9 s** producing 2 000 000 strings |
| the same roster, 4 000 000 pairs | the process **died inside `validate` with a V8 out-of-memory** |

The scan itself stays **O(P)** and that is unavoidable — it matches the `Set` the caller already
built. What the cap removes is the **5x memory amplification**, the **O(P log P) string sort**,
and the unbounded return array.

Nothing the app can express is affected (it caps at 200 pairs), but `lib/` ships standalone and
`validateDetailed` has a live **main-thread** caller that renders whatever array it returns.

**Deduping in `structuralReasons` rather than leaving it to `normalize`** costs one
`formatReason` per invalid pair — measured at **222 ms for four million**. That is the cost of
building one and dropping it; the 5.0 s / 925 MB figures above are the cost of *retaining and
sorting* that many. Without the dedupe, a thousand copies of one fault filled all 16 slots and
then collapsed to a single listed reason.

**Which 16 survive is chosen order-free.** "The first 16 encountered" made the choice a function
of `Set` insertion order, so the same constraint *set*, built forwards or backwards, refused with
different text — and the Python mirror iterates its sets in hash order and would have disagreed
with both. Selecting the **alphabetically smallest distinct messages** is order-free and is the
message parity this module is held to.

### `num` — non-finite numbers are spelled Python's way

`formatReason` claims byte-identity with `reference-python`'s `format_reason`, and raw
interpolation broke it on exactly the values these reasons are documented to **carry**: `${NaN}`
is `"NaN"` in JS against `"nan"` in Python; `${Infinity}` is `"Infinity"` against `"inf"`. A
**3 000-case differential fuzz matched 2 993 messages byte-for-byte, and every one of the 7
mismatches was this class** — invisible to the suite, which only ever uses finite values. The
oracle is the spec, so Python's spelling wins.

---

## Where the caps are enforced, and two consequences of that

### The first diagnosis differs by entry point

`validateDetailed` returns **structural** reasons before it looks at the size/work caps, while
`checkWellFormed` checks the **caps first** and calls the structural check afterwards. An input
that is both oversized *and* structurally invalid therefore gets a different **first** diagnosis
depending on which entry point is asked. Both diagnoses are true and both refuse; only the
ordering differs. Stated here rather than left to be inferred from the word "mirror".

### `cons.n < n` once breached the degree cap in production

`checkWellFormed` validated endpoints against the **parameter** `n` while the required-degree
vector came from `cons.requiredDegree()`, sized by **`cons.n`**. With `cons.n < n` the vector had
holes at exactly the vertices being checked, `undefined > k` was `false`, and the documented
"required-degree over k" refusal **never fired** — so the primitive returned a graph **exceeding
k**, in production, with the dev-mode postcondition compiled out. `Constraints.merge` and
`buildConstrainedBuddyGraph` already enforced the rule; this primitive was the one public entry
point that did not.

### A refusal must not allocate from the refused `n`

`refusedResult` bounds its placeholder by `MAX_CONSTRAINED_N`, never by `MAX_ROSTER`. Clamping to
`MAX_ROSTER` (1e6) meant **refusing an oversized roster allocated 200x more than accepting the
largest legal one** — a refusal costing more than a success is a denial-of-service gradient
pointing the wrong way. (This is also why `ConstrainedBuddyResult.buddies.length === n` holds
only for an acceptable `n`; the type-system consequence is tracked in `lib/CLAUDE.md`.)

---

## Connectivity: what residual disconnection actually means

`forceConnect` used to be the last word on connectivity, and its comment said residual
disconnection "means the roster cannot be connected within k buddies each". **That claim is
false**, and it was a limit of the function stated as a fact about the caller's input.
`repairConnectivity` now runs after it and can *rewire*; what survives **both** is disconnection
that no single constraint-preserving rewiring can remove.

**Witness that addition alone is not enough** (`joinAnyComponents` needs *both* endpoints under
k, so a component whose whole boundary is saturated cannot be joined however many legal pairs
exist elsewhere): **n=7, k=2, prohibiting (3,5) and (3,4)**. `validate` accepts it; completion
leaves `{0,1,2,3,6}` and `{4,5}` with every vertex at its degree cap; and the 7-cycle
`0-1-2-3-6-4-5-0` is a connected graph at the same k under the same prohibitions — one double
edge swap away. A swap reaches it where an addition cannot, because it **frees the degree it
spends**.

**Witness that a swap is not enough either** — a double edge swap needs a droppable edge in
*each* of the two components, so it cannot touch a component with no edges, exactly the shape a
saturated boundary produces at small k: **n=4, k=2, prohibiting (1,3) and (2,3)**. `validate`
accepts it; completion builds the triangle `0-1-2` and leaves person 3 alone (0 is full, 1 and 2
are prohibited); `forceConnect` cannot add and `swapJoin` has nothing to swap — so the result
reported `connected: false` with a **largest-component fraction of 0.75** and no refusal, while
`0-1, 0-3, 1-2` is a connected graph at the same k under the same prohibitions.

`stealSlot` covers that case by dropping a **non-bridge** `(a,b)`: a and b stay connected to each
other, so the only component change is the merge. Edge **count** is preserved (one removed, one
added); what moves is a single degree, from the dropped endpoint to u. That is a real concession
— the result is **less regular** than the input — which is why it runs only after `swapJoin`,
which concedes nothing, has failed.

**The repair is bounded, and the bound is part of the contract.** Each pass costs O(n + m) for
the component/bridge scan plus at most the remaining candidate-pair budget, which is charged
across the **whole** repair so a pathological input cannot make it quadratic in m. If the budget
runs out the graph is returned as it stands, and residual disconnection then means *"no legal
rewiring was found within the budget"* — a statement about this function, not about the roster.

Two shapes found still split after the repair by a **1 500-case cross-language sweep** are kept
as explicit witnesses in `lib/test/constrained.test.ts`, so the brute-force check beside them is
never vacuous. The remaining avoidable class (the surviving component is a **tree**) is tracked
in `lib/CLAUDE.md`.

### The sink-bottleneck guard's threshold

`buildConstrainedBuddyGraph` on a many-stuck sink bottleneck runs at **~0.13 s in practice**; the
cubic rescan regression it guards against runs at **~4.6 s**. The test asserts **< 1500 ms** —
above the noise floor of the fast path, an order of magnitude under the regression.

## `forceConnect` is provably inert

`constrainedGreedy` ends with a `forceConnect` pass meant to bridge leftover components.
It **never fires**. Completion exits only once every under-degree vertex is *stuck* (has
no legal partner at all), a stuck vertex never regains one (edges only saturate partners),
and `forceConnect` reuses the *same* legality predicate — so no legal edge can remain for
it to add. Completion's output is **legal-edge-maximal**; that invariant is now asserted
as a property test (`lib/test/constrained.props.test.ts`). The function is retained for
parity with the Python reference and as a safety net if completion's termination is ever
weakened — but do not mistake it for the thing that provides connectivity. (Cost someone a
round of review to establish; written down so it costs no one else.)

What `forceConnect` *does* do is bridge leftover components under the degree cap: repeatedly add
any legal (non-prohibited, both-under-k) cross-component edge until one component remains or no
legal edge exists — connectivity outranking girth and regularity, but never exceeding k. It is
inert because completion has already exhausted that move. Connectivity is provided by
`repairConnectivity`'s two rewiring stages instead; see *Connectivity: what residual
disconnection actually means* above.

## Meta: how these were found

Every one of these came out of **unfocused, full-surface** adversarial review — pointing
critics at the whole component each round, not the diff. Each cleared issue exposed the
next one beneath it (a non-integer-input hang → the n-cap → the k-cap), because critics
anchor on the biggest thing in view and clearing it changes the view. A diff-scoped review
would have hidden every layer the anchor was sitting on. Every confirmed finding was then
ratcheted into a parameterized or property test, so the class can never be rediscovered by
accident — see `lib/CLAUDE.md` for the protocol.

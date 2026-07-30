# When the reported number did not describe the returned graph

*Why this file exists: the material below is not a cost model, so it belongs in neither
[`generation-cost-budgets.md`](./generation-cost-budgets.md) nor
[`constrained-generation-cost-and-caps.md`](./constrained-generation-cost-and-caps.md), and it is
not one module's problem either — it spans `metrics.ts`, `polish.ts`, `constrainedPolish`,
`index.ts` and the public option surface. It is collected here because every entry shares one
failure shape:* **the library returned a number that did not describe the artifact it returned
alongside it** — an unchanged graph reported as improved, a fragmented graph reported as
better-connected, success reported for a request that was silently answered with a different one.
Each was found by review and is now pinned by a test whose name states the claim; the
measurements are here.

---

## The objective itself: a flat disconnection penalty rewarded fragmentation

`aspl` is averaged over **reachable pairs only**, so breaking a disconnected graph into *smaller*
pieces **lowers** it. With a constant disconnection term, `polish` and `polishConstrained`
hill-climbed into deeper fragmentation while the average separation they reported "improved".

That was a real defect, not a refinement. Measured before the fix:

| shape | before | after the hill-climb | reported |
|---|---|---|---|
| 16-person roster | one group of 14 | **five fragments** | separation fell **5.0 → 1.3** |
| 12-cycle + disjoint 4-cycle | 2 components | **4 components** | ASPL **1.36** |
| 16-person, k=2, through the public constrained builder | one group of 14 | largest group of 4 | largest-component fraction **0.25** |

`penalizedAspl` now scales the penalty with the fragmentation, so a split can never buy a lower
energy.

**Independently corroborated.** A review lens built its own exhaustive probe over randomly
structured disconnected graphs (mixed paths, cycles and partial cliques) and examined
**432,954 fragmenting double-edge swaps without finding a single one that lowers the energy** — a
far larger sample than fast-check reaches in the property suite, and produced by something with
no stake in the fix.

### The guard needs BOTH component count and largest-component size

Component count alone is too weak: a swap that **splits the largest group while merging two small
ones** leaves the count flat and passes a count-only guard. That is not hypothetical — it is
reachable at the library's own `DEFAULT_PRIOR_WEIGHT` of 2 (see
[`churn-priors-weight.md`](./churn-priors-weight.md) for why the default sits there). The guard
asserts both: the count never rises **and** the largest group never shrinks.

### A non-finite `priorWeight` poisoned every comparison

`NaN` makes `next.energy < current` false for **every** candidate, so the pass burned its whole
budget of O(n·m) re-measurements and returned the input unchanged — while still reporting
`polished: true`. It now falls back to *no penalty* rather than to a comparison that can never
succeed.

---

## Metrics must be read off the graph that is actually returned

### `finalMinSeparation` reported the target, not the achievement

`buildBuddyGraph(16, 5)` advertised `finalMinSeparation` **3** while returning a graph of
**girth 3** — buddies two steps apart. `ringGreedy` reported its own achievement, and then
`polish`, which is **not separation-aware**, ran afterwards. The figure is now derived from the
returned graph: **separation = girth − 1**.

### `asplGap` was scored against the degree requested, not delivered

`buildBuddyGraph(8, 6)` returns a **3-regular** graph whose ASPL equals `mooreLowerBounds(8, 3)`
**exactly** — provably optimal. Scoring it against k=6 reported a gap of **0.375**, so an optimal
graph read as badly wired. Score against the degree actually delivered.

### `PolishResult.iters` counts loop passes, not changes

The counter sits at the top of the body, before the fewer-than-two-edges break and before the
"no swap could be proposed" continue. So `polish(new Graph(5))` reports **1**, and
`polish(ring(3))` reports **19,990** over a byte-identical graph — a triangle admits no
vertex-disjoint edge pair, so every proposal fails. `iters` is *the budget actually consumed*,
useful for cost accounting and nothing else: **`polished` must come from `res.changed`**, never
from a function of `iters`.

(Related, tracked in `lib/CLAUDE.md`: `iters` is the total loop count, not the index at which
`best` was captured, so it cannot name the prefix that would replay the returned graph.)

### `PolishConstrainedResult` exists because the caller cannot infer what a pass did

`polishConstrained` used to return the graph alone, on the reasoning that run-level metrics come
from the caller's report. That was the hole: the caller could only infer whether a pass had
happened from its own decision to **call**, so `polishIters: 0` produced `polished: true` over an
untouched graph and a `priorsKeptFraction` measuring nothing. A fact about what a pass did has to
come from the pass, so it now reports alongside the graph.

### `shortestPath` returns a canonical path, not an insertion-order artefact

Recording a `parent` during BFS — as `girth` does — would make the returned path depend on
**edge-insertion history**, so a graph rebuilt with the same edges added in a different order
would yield a different path. Determinism is a contract, and a path is one of the few
byte-for-byte artifacts this library hands out, so it is reconstructed from the distance array
instead.

---

## Malformed inputs are refused, not coerced or spun on

### `mooreLowerBounds` / `asplGap` used to spin forever

A **non-integer k in roughly (1.6, 1.98)** fed directly to the bounds exports never terminated —
a denormal fixed point in the iteration. The ratchet is a per-test timeout, so a regression fails
as a *timeout* rather than as a hang, and the `1.9` / `1.95` entries in the bad-input table are
there because they sit inside that band.

### Every seed the core accepts names its own stream

`seed >>> 0` broke that for a whole family of values at once: **`0.9`, `-0`, `NaN`, `2**32` and
`12345 + 2**32`** all silently became a seed that had already been asked for. Seed is the app's
"give me a different arrangement" control, so aliasing answers the one request the user made with
the graph they were trying to leave — and reports success. It was the last numeric option in the
core that was coerced rather than checked; it is now refused.

---

## What would change these conclusions

- **A cheaper energy function.** The fragmentation guard and `penalizedAspl` are coupled: if the
  objective is replaced with an incremental or sampled energy (see the two cost documents), the
  fragmentation property must be re-established against the new objective, not assumed to carry
  over.
- **Separation becoming an optimization target.** `finalMinSeparation` is derived from the
  returned graph precisely because polish does not optimize for it. If polish ever becomes
  separation-aware the derivation stays correct, but the two would then need to agree — and
  nothing checks that today.

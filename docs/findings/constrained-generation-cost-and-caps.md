# Constrained generation: cost model and safety caps

*Hard-won during the M1 adversarial review of the constraint core (2026-07). The code
is in `lib/src/core/{constrainedGreedy,constraints,graph}.ts`; this explains the why.*

*Sibling document: [`generation-cost-budgets.md`](./generation-cost-budgets.md) covers the
**unconstrained** generator (`greedyWork` / `MAX_GREEDY_WORK`, `MAX_REPAIR_WORK`) and **all** the
polish budgets. The two cost models are deliberately separate and their accept-sets are not
nested — this path pays O(n) per edge for a BFS, that one pays O(n²) per edge for a cache update.*

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

- Sparse (`n=5000, k=4`, at the budget): ~13 s.
- Deepest allowed dense corner (`n≈464, k=n-1`): ~46 s. Unrealistic input (nearly a
  complete graph), bounded, and refused just past it.

The caps are coarse by design — they prevent the minutes-to-days hang, not every slow
input. The real fix is a tracked follow-on: an **incremental single-source distance
scheme** that removes the per-edge BFS entirely, which would let both ceilings rise.

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

## Meta: how these were found

Every one of these came out of **unfocused, full-surface** adversarial review — pointing
critics at the whole component each round, not the diff. Each cleared issue exposed the
next one beneath it (a non-integer-input hang → the n-cap → the k-cap), because critics
anchor on the biggest thing in view and clearing it changes the view. A diff-scoped review
would have hidden every layer the anchor was sitting on. Every confirmed finding was then
ratcheted into a parameterized or property test, so the class can never be rediscovered by
accident — see `lib/CLAUDE.md` for the protocol.

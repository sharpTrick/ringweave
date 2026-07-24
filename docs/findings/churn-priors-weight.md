# M1b — churn prior-weight sweep: how much do we preserve, and at what weight?

**Question.** When the roster changes (someone joins) and we recalculate, the previous
buddy pairs become *soft priors*: the constraint-preserving polish pass carries a penalty
`prior_weight` for every prior it drops. How large should that weight be, what fraction of
prior buddies do we actually keep, and what does keeping them cost in connection quality?
This sets the product default `DEFAULT_PRIOR_WEIGHT` (`lib/src/core/index.ts`) and the
honest **F9** ("recalculate with minimal disruption") claim.

**Method.** `reference-python/churn_bench.py`. Model: build the full-roster host graph,
treat one *random* person as the newcomer (their links form fresh), and make every other
existing pair a soft prior. Sweep `prior_weight ∈ {0, 0.5, 1, 2, 4, 8, 16}` × `n ∈ {30, 60,
120}` (k=4) × 5 seeds, generate with constrained-greedy, then polish (8000 iters — the
production default). Fully seeded/deterministic. Raw data: `docs/churn_results.csv`.
Reproduce: `python3 churn_bench.py` (sweep) and `python3 churn_bench.py --mechanism`.

## Result: preservation is a step function in the weight

| n | weight 0 | weight ≥ 0.5 (kept, mean) | kept min | ASPL gap | connected |
|---|---|---|---|---|---|
| 30  | 0.24 | **0.978** | 0.964 | 0.010 | 100% |
| 60  | 0.18 | **0.855** | 0.828 | 0.062 | 100% |
| 120 | 0.22 | **0.643** | 0.627 | 0.052 | 100% |

Every weight from 0.5 to 16 produced **identical** results — the rows are flat. The knob is
effectively **on/off**, not a dial, at this scale.

**Why (mechanism, `--mechanism`).** Three regimes:
1. **Constrained-greedy keeps priors only incidentally** — ~28% survive generation (it
   optimizes structure, not history). This matches the earlier bake-off's "raw B ~27%".
2. **Weight-0 polish *erodes* them** further (down to ~0.20–0.27), because with no penalty
   it freely swaps prior edges away chasing ASPL.
3. **Any positive weight *restores* them** — a swap that re-adds a prior lowers energy by
   `weight`, so polish actively rebuilds the prior structure. Because single degree-preserving
   swaps move ASPL only by tiny fractions, even `weight = 0.5` already dominates every such
   trade, and larger weights cannot reach further priors (the unrecovered ones are blocked by
   degree caps / hard constraints, not by an insufficient penalty). Hence the plateau.

## Decisions

- **Keep `DEFAULT_PRIOR_WEIGHT = 2`.** It sits squarely on the plateau, with comfortable
  margin above the ~0.5 activation threshold — robust to instances whose threshold is
  marginally higher — while costing nothing extra over 0.5. No behavior change; the value is
  now *measured*, not provisional. The `priorHard` toggle remains the lever when a specific
  pair must be kept unconditionally.
- **Honest F9 claim (replaces the vague "47–81%").** Recalculating after one person joins
  preserves, at negligible ASPL cost (gap ≤ ~6%, always connected):
  - **~98%** of prior buddies at n=30,
  - **~86%** at n=60,
  - **~64%** at n=120.

  Preservation is high for small groups and **declines with roster size** (a fixed k=4 budget
  and one newcomer force proportionally more rewiring as n grows). The F9 acceptance target
  ("adding 1 person to n=50 preserves ≥90%") holds only for **small rosters (n ≲ 50)**; state
  it that way in the UI rather than promising ≥90% at every size.

## Caveats / follow-ons

- Measured for **k=4, add-one-person** churn (the F9 scenario). Remove-a-person and k≠4 are
  unmeasured; the mechanism should carry over, but claims for them need their own runs.
- Polish is O(n·m) per iteration, so the sweep stops at n=120 (see `lib/CLAUDE.md`); larger n
  needs the incremental-energy follow-on before a churn claim at scale is cheap to produce.

# Sextant — pre-registration

**Written before any review round was run against the corpus, and before the admission results were
known.** The point is that the allocation rule and the success criteria are fixed in advance, so a
disappointing number cannot be rescued afterwards by re-cutting the data. E1's documented failure was
optimising a metric that had quietly stopped tracking value; the cheapest defence is to say in
advance what would count as failure.

Commit this file before running anything. If it is amended later, the amendment must say what changed
and why, and the original must remain readable in git history.

## What is being measured

Three instruments over one seeded-defect corpus, plus unseeded controls:

| instrument | scored on | cost |
| --- | --- | --- |
| the prose critic ensemble, **model-diverse** | the pre-registered prose subset + all controls | expensive (agents) |
| the prose critic ensemble, **homogeneous all-opus** (E1's configuration) | the pre-registered paired arm | expensive (agents) |
| the **hygiene linter** (`npm run lint`) | every admitted seed | ~free |
| the **existing test suite** | every admitted seed | ~free (it is the admission gate) |

## Allocation rule — deterministic, stated before results were seen

Applied mechanically to `data/admission.json`, no judgement at selection time:

1. **Admitted seeds** are those passing all gates in `scripts/sextant/forge.mjs`: the edit applied
   with a unique anchor; the seeded line covered by ≥1 existing test; and `npm test`,
   `npm run typecheck`, `npm run lint` all still green — **except** seeds explicitly marked
   `expectGates: false`, which are the linter/a11y-oracle probes and are scored against the tool that
   is supposed to catch them rather than against the critics.
2. **The prose subset** is the admitted seeds in ascending seed-id order, capped at 12. If fewer than
   12 are admitted, all of them are used and the shortfall is reported as a power limitation, not
   quietly absorbed.
3. **The homogeneous paired arm** is every second member of the prose subset in the same order,
   capped at 6 — i.e. subset positions 1, 3, 5, 7, 9, 11. Same seeds for both configurations, so the
   comparison is paired.
4. **Controls** are all four unseeded worktrees, reviewed under the model-diverse configuration.

## Pre-registered success criteria

Taken from the proposal's §7, and unchanged by anything learned since.

| | criterion | counts as failure |
| --- | --- | --- |
| **E3** (recall harness, Lever B1/B2) | ≥1 seeded defect class caught by an instrument that the prose ensemble missed | the prose critics match or beat the other instruments on every class — Lever B is then unfalsifiable on this codebase |
| **E4** (lean ensemble, Lever A1/A2/A3) | **zero** loss of recall from retiring a saturated lens, computed leave-one-lens-out | any dropped seed |
| **A1 handoff** | the linter catches every seed marked `expectGates: false` | the linter misses one — A1 is then **not safe to adopt**, because the critics have been told to stop looking there |

## Reporting constraints, fixed now so results cannot be overstated later

- **Recall is a relative discriminator between configurations, never an absolute capability
  estimate.** The sentence "the loop finds N% of defects" is prohibited: mutant-to-real-fault
  coupling is thin, and under test-suite-size control the mutation-score↔real-fault correlation
  collapses to ~0.05–0.20.
- **Strata are never pooled.** Hand-authored defects are measurably *harder* to detect than real
  ones, so a lower figure on `M-hand` is an artifact, not a signal.
- **n is small and the arithmetic is stated in advance.** At n≈12 a Wilson 95% CI is roughly
  ±25 points, and a paired exact McNemar test needs **≥6 discordant seeds all in one direction** to
  reach p<0.05. Anything short of that is labelled *underpowered*, explicitly. "Config B found 8,
  config A found 7" is noise.
- **Zero loss on 12 seeds bounds the true loss rate below roughly 26%, not below zero.** Report the
  bound, not "no loss".
- **Two strictness levels for seed matching are both reported** (`strict` = same file + ±10 lines;
  `loose` = also a shared class/theme token). Quoting only the flattering one would be the same error
  as quoting a single blame configuration.
- **Recall for the maintainability lens is not meaningful** — seeded maintainability defects have no
  ground truth. That lens is assessed on acceptance/usefulness instead.

## Known limitations, recorded before they become excuses

- **Stratum R is "a real defect with its guard removed", not "a reverted fix".** E1 ratcheted every
  confirmed finding into a test, so re-introducing a historical defect necessarily fails its guard.
  Removing the guard is what lets the seed pass the green-suite gate, and it changes what the stratum
  measures: these are defects the suite *could* see with its eyes closed.
- **The coverage gate biases seeds toward well-tested code.** That is deliberate — without it, recall
  partly measures "can the reviewer read code no test exercises" — but it means the corpus lives
  where the suite is strongest and surviving mutants are rarest.
- **Survivorship selects for triviality.** Google's production mutation system found developers
  judged ~85% of *surviving* mutants unproductive. The coverage gate plus per-seed adjudication are
  the mitigations; neither is a guarantee.
- **Blind spots are only blind spots for these instruments on this corpus.** A seed nothing found is
  evidence about the ensemble, not proof of absence in the code.
- **Same-vendor models throughout.** Cross-vendor review would decorrelate errors better; no
  non-Anthropic model is available in this environment. Residual correlation is a threat to validity,
  not a solved problem.

## Information hygiene

Every worktree has the corpus manifest, the forge script, and the entire `critical-review/` findings
tree **removed** before any review runs, and worktrees are named by opaque slot (`wt-07`) rather than
by seed id — because the critic is handed the target *path*, and a descriptive path would hand it the
answer. Both are asserted by `assertNoLeak`, not assumed. The first version of the forge failed this
check, which is why it is a check.

# Sextant — measuring the review loop with instruments outside it

**Experiment.** E1 ([`2026-07-24-ouroboros/`](../2026-07-24-ouroboros/)) measured one adversarial
review loop to convergence and concluded it had spent its second half reviewing its own output. The
follow-up proposal ([`2026-07-24-external-oracle-review-proposal.md`](../2026-07-24-external-oracle-review-proposal.md))
argued that every robust fix *replaces agent judgment with an external oracle or is strictly
subtractive* — and then pre-registered three experiments, because nothing in it had been measured.
This is the measurement.

**Why "Sextant."** A sextant fixes your position by something outside the ship. Every number here is
produced by an instrument the loop does not control: `git blame`, a linter, a coverage map, a test
suite, seeded defects with known locations. Where judgment was unavoidable it is named as such and
pushed onto a different model.

**Status: partial.** The retrospective measurements over E1 are complete and are reported below. The
seeded-defect recall run (E3) is in progress; its section says so explicitly rather than being left
to look finished. The pre-registration is [`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md), committed
before any scoring run.

---

## What we concluded so far

> E1's most-attacked number was **right**. An independent mechanical oracle reproduces its
> hand-labelled 66.7% self-induction to within ~1.3 points — the criticism was that the figure was
> unverifiable, not that it was wrong. What changes is the framing: against a measured **20% chance
> baseline**, the defensible claim is a **3.37× enrichment**, not a raw percentage. And the loop's
> test ratchet turns out to be far stronger than its reputation: **7 of 9** boundary mutations planted
> in well-covered files were caught by the suite it built.

### 1. Self-induction, measured: 68% of classifiable findings, 3.37× over chance

`scripts/review-metrics/blame-attribution.mjs`, data in
[`data/e1-self-induction.json`](./data/e1-self-induction.json).

For each of E1's 92 findings, blame the line it cites at the **parent** of that round's fix commit —
so any fix commit appearing in the result is necessarily from an earlier round.

| blame configuration | classified | self-induced | pre-existing | unknown | rate | base rate | **lift** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 87 | 62 | 25 | 5 | 71% | 21% | **3.33×** |
| `-w` | 87 | 62 | 25 | 5 | 71% | 21% | **3.34×** |
| `-w -M -C` *(primary)* | 87 | 59 | 28 | 5 | **68%** | **20%** | **3.37×** |
| `-w -M -CCC` | 87 | 59 | 28 | 5 | 68% | 20% | **3.37×** |

Three things worth separating:

- **The hand-label was accurate.** E1 reported 66.7% (56/84 post-baseline); this reports 68% (59/87,
  all findings). Two different denominators landing ~1.3 points apart. E1's corrections section called
  the figure "an upper bound, not a measurement" and asked for blind coding; the honest update is that
  it was a *measurement* all along, arrived at by an untrustworthy route.
- **The base rate is what was missing.** 20% of product lines at the reviewed revision were written
  by fix commits, so ~20% of *randomly located* findings would land on fix-authored code by chance.
  Quoting 68% without that denominator is what made the original so easy to attack.
- **The SZZ mitigations barely move it.** The published precision spread across SZZ variants is
  0.42–0.73, so the blame configuration *could* have dominated the result. Here it shifts the rate by
  3 points. That is worth publishing precisely because it is small — it means the number is not an
  artifact of a flag choice.

**Limitations, not caveats.** This is SZZ, and it inherits SZZ's ceiling (no variant exceeds
F1 ≈ 0.7). It is documented as **sub-optimal for non-functional bugs**, which are the majority of
E1's findings. And because it runs *forward* from a line that exists, it can always produce an answer
— including for "missing guard" findings where no line is wrong and blame merely names whoever wrote
the neighbourhood. The 5 unknowns are excluded rather than guessed; an oracle that can never say
"I can't tell" is not more rigorous than a hand label, just differently overconfident.

**Still owed:** the split between a fix that *injected* a defect and a fix that was *incomplete* and
got hardened later. Only the first is waste. That needs judgment, so it goes to a blind coder on a
different model family — and cross-vendor is unavailable here, which is a threat to validity rather
than a solved problem.

### 2. The loop rewrote 23% of its own output

`scripts/review-metrics/fix-churn.mjs`, data in [`data/e1-fix-churn.json`](./data/e1-fix-churn.json).

Of **1,195** non-test product lines added by the 21 review-round fix commits, **920** still stand at
round 21 — so **23.0%** were rewritten or removed by a later round of the same loop. No model and no
label anywhere in that number.

The per-round column declines monotonically with recency (round 2: 90% rewritten; rounds 16, 18, 19,
21: 0%), which is the tell for the confound: **round 2 had 19 further rounds in which to be
overwritten and round 21 had none.** The aggregate therefore understates early churn, and the
per-round figures are partly a survivorship artifact. Read the curve, not the total, and compare
rounds at equal depth. Tests are excluded deliberately — the loop was *supposed* to rework the suite
(68 → 136 tests), so counting that as waste would score the ratchet working as intended.

### 3. The ratchet is much stronger than E1's write-up suggests

This one was discovered by accident, while building the corpus, and it is the most practically useful
result so far.

E1 concluded the ratchet "locked cases, not themes" — durable against the exact input, poor against
the underlying concern. True, and it undersells what the case-locks achieve. Of the mutation-style
seeds planted in **well-covered** `app/src` files, **7 of 9 were caught by the existing test suite**
and had to be rejected from the corpus:

| candidate | site | caught by |
| --- | --- | --- |
| roster cap off-by-one | `parseRoster.ts:70` | suite |
| case-insensitive dedupe removed | `parseRoster.ts:58` | suite |
| people-vs-buddies boundary flip | `feasibility.ts:26` | suite |
| parity note inverted | `feasibility.ts:41` | suite |
| formula-injection guard weakened (`-` dropped) | `download.ts:18` | suite |
| CSV quote escaping dropped | `download.ts:23` | suite |
| control-char normalization removed | `parseRoster.ts:56` | suite **+ linter + typecheck** |
| max-roster off-by-one | `feasibility.ts:33` | *survived* |
| duplicate tally boundary | `parseRoster.ts:64` | *survived* |

Two observations. First, a **security**-relevant deletion was caught three ways at once — the removed
control-char normalization orphaned its import, so the linter and typechecker flagged it before any
test ran. Defence in depth, working. Second, this is a direct quantified answer to a question E1 left
open: the case-locks are dense enough that most boundary mutations *in the same files* cannot survive
them. Whatever the ratchet failed to do about themes, it did this.

It also created a problem for this experiment, recorded rather than hidden: the coverage gate pushes
seeds toward well-tested code, which is exactly where surviving mutants are rarest. See §4.

**And it found a hole.** One candidate — deleting the worker's stale-response guard
(`useGenerationWorker.ts:36`) — was rejected for the *opposite* reason: the coverage gate says **no
test exercises that line at all.** The suite mocks the *hook*, never the message protocol, so
`if (msg.id !== latestId.current) return;` is unexercised. That guard exists because of E1's round-4
finding `stale-async-result-clobbers-newer-state`, which was **confirmed blocking**. So the ratchet
locked the case one level *above* the defect: the hook's behaviour is asserted, the guard itself is
not. A defect class the loop identified as blocking has a fix with zero coverage — which is precisely
the "locked the case, not the theme" pattern, caught by a coverage map rather than by argument.

Excluding it from the corpus is still correct: a seed on an uncovered line would make recall partly
measure "can the reviewer read code no test runs". But it is the single most actionable line in this
document, and it is a test-suite gap, not a review-process one.

### 4. E3 — seeded-defect recall *(in progress)*

Corpus construction is complete and the pre-registered allocation is mechanical
([`scripts/sextant/allocate.mjs`](../../../../scripts/sextant/allocate.mjs)). The prose-ensemble
scoring run is not finished, so no recall figure is reported here yet.

What is already fixed and will not be adjusted afterwards: the allocation rule, the three success
criteria, and the reporting constraints — all in [`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md). The
corpus fell short of its planned 12 critic-corpus seeds for the reason in §3, and per the
pre-registration that shortfall is reported as a **power limitation** rather than absorbed: a paired
exact McNemar test needs ≥6 discordant seeds in one direction for p<0.05, which a smaller corpus
cannot supply. Existence claims and per-seed blind-spot reporting remain valid; effect-size
comparisons do not.

---

## Method & provenance

**Deterministic, reproducible from `data/`:** the self-induction rates and base rates
(`blame-attribution.mjs`), the churn figures (`fix-churn.mjs`), the coverage map (`coverage-app.json`,
produced by `@vitest/coverage-v8`), and the admission results (`forge.mjs`). Each is a script plus its
output; re-running reproduces the number.

**Judgment, and where it sits:** the seed set is hand-authored, so which defects exist is a choice —
mitigated by admitting them mechanically and by reporting per-stratum. The injected-vs-incomplete
split (§1) is deliberately not yet made, because it needs judgment and the right judge is a different
model family.

**Two designed-in controls that caught real mistakes.** Worktrees are stripped of the corpus manifest
and the findings tree and named by opaque slot, because the critic is handed the target *path* and
`sd-01-roster-cap-offbyone` names the defect outright — the leak assertion caught exactly that in the
forge's first version. And the churn metric's first implementation reported 94.1% with round 21 at
"100% rewritten", which is impossible because round 21 *is* HEAD; the absurd number exposed a wrong
blame range.

**Reviewed code** is at tag-equivalent `claude/m2-xapjhu` (29 commits, 21 review-round fixes);
`main` is squash-merged and **cannot** be used, because blame there resolves at PR granularity.

## What would change our mind

- **N=1 on one small offline app.** Every number here describes a single loop over ~1,900 lines of
  client-side TypeScript with no network, auth, or server. The security lens's early saturation is
  partly a property of that surface.
- **The base rate is the load-bearing denominator.** If 20% is wrong — different file filter,
  different revision — the 3.37× moves with it. It is one measurement, not a constant.
- **Blame attribution is documented as weak for non-functional findings**, which are the majority
  here. A corpus dominated by functional defects might give a very different self-induction rate.
- **The ratchet result (§3) is about mutations in well-covered files.** It says nothing about defect
  classes the suite has no case-lock for, which is precisely where §4 is aimed.
- **Same-vendor models throughout.** Measured error correlation between models from one provider is
  materially higher than across providers; nothing here escapes that.

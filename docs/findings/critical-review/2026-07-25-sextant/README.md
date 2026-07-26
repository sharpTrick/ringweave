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
>
> And the cheapest instrument beat the most expensive one outright. Replaying today's lint rules over
> E1's history finds a click-handler accessibility defect that is **byte-identical at the baseline and at
> the converged head** — twenty-one rounds of five-lens adversarial review renamed its file and never
> filed it. Lever A1 was sold as a saving; what it demonstrably is, is **more capable** on its own classes.
>
> And the harness had the same disease it was built to diagnose: saturation gating never fired in six
> rounds because nothing ever wrote the state file it reads, and a skip that *fails to happen* logs
> nothing. The guard watched only the direction its author had in mind.

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

### 4. E3 — recall is 4/5, and one lens carries it

**This supersedes two earlier readings of the same corpus.** The pre-registered figure comes from the
one run that completed with a valid denominator — `config: proposed-model-diverse-medium-effort`,
5 of 5 seeds scored, no dead lens in any scored round
([`data/recall-diverse.json`](./data/recall-diverse.json)). Two earlier attempts were quoted here
before that was true, and both were wrong in different directions; §4b records what that cost.

| seed | class | found | by |
| --- | --- | --- | --- |
| sd-05 | off-by-one boundary | FOUND | correctness |
| sd-08 | off-by-one boundary | FOUND | correctness |
| sd-12 | dropped guard clause | **MISSED** | — |
| sd-13 | wrong displayed state | FOUND | correctness, solid, maintainability |
| sd-15 | inverted comparison | FOUND | correctness, solid |

**Recall = 0.80 strict and loose** (identical, so no seed was matched only by the looser rule). Wilson
95% CI on 4/5 runs from roughly **28% to 99%** — which is the honest width at n=5 and the reason this
number is a discriminator between configurations, never a capability estimate.

**One lens carries the ensemble.**

| lens | seeds found | sole source for | recall without it |
| --- | --- | --- | --- |
| `critic-correctness` | 4 | sd-05, sd-08 | **0.40** |
| `critic-solid` | 2 | — | 0.80 |
| `critic-maintainability` | 1 | — | 0.80 |
| `critic-security`, `critic-interaction` | 0 | — | 0.80 |

Retiring any lens except correctness costs zero recall on this corpus; retiring correctness halves it.
That is the sharpest available result on Lever A3, and it points the opposite way from "more lenses
find more": four of five lenses have no unique recall here. Read narrowly — five seeds, one stratum,
all mutation-style boundary and comparison flips, which is the material a correctness lens is aimed
at. It says nothing about the classes the other lenses are aimed at.

**The blind spot is real and it is a guard clause.** `sd-12` drops a guard in `GraphCanvas.tsx` so the
neighbourhood glow misclassifies first-degree buddies as second-degree. No lens found it at medium
effort. It *was* found in an earlier run at unspecified effort — so this is run-to-run variance, not a
permanent hole, which is itself the finding: SWR-Bench reports that variance within one model nearly
equals variance across models, and here the same corpus and the same ensemble differed on one seed in
five between runs. A single run cannot support a blind-spot claim in either direction.

**Precision could not be measured, and the reason is a methodological result.** Only one of four clean
controls survived with all five lenses alive; the other three lost lenses to session limits. On that
one control the ensemble filed **13 findings, 9 of them gating** — on unseeded code with no planted
defect.

The tempting reading is "precision ≈ 0". It is wrong, and the lib loop in §5 is why: those same
critics found **three genuine blocking defects** in unseeded core code — an optimizer that made
rosters worse while reporting better numbers, a 33 s default-path generation, and a generator with no
time bound. A control worktree of your own un-reviewed code is *not* a clean-room. SWR-Bench's
Clean-PRs can assume cleanliness because they are merged, reviewed changes; a snapshot of code that
has never had five adversarial lenses pointed at it cannot.

So the honest statement is: **13 findings on one clean control, precision unresolved**, and resolving
it needs Google's *effective* false-positive definition — an issue nobody took positive action on —
adjudicated per finding, not the raw count. That adjudication is not done. Recording the number
without it would be the same error as quoting recall from a contaminated run.

**And a caution about the corpus, not the ensemble.** 4/5 on seeds that survived a green-suite gate
sounds strong, but §3 showed the suite already catches 7 of 9 comparable mutations. What is left for
the critics is a residue selected for being hard to *test*, not hard to *see*. This says the ensemble
reads carefully. It does not say it would find a defect class nobody thought to seed.

### 4b. Three readings of one corpus, and what the halts cost

This section was written three times, and the first two were wrong. That is worth publishing, because
the failure mode is not exotic — it is what happens by default when a long run is interrupted.

| reading | source | claimed | actually |
| --- | --- | --- | --- |
| 1st | first run, 33 of 49 agents dead | recall 0.8, `sd-15` a **blind spot** | void — dead lenses scored as clean |
| 2nd | recovered from transcripts | recall **5/5**, no blind spot | true of what reported; not the pre-registered config |
| 3rd | medium-effort run, complete | recall **0.80**, `sd-12` the blind spot | the figure of record |

The first reading is the dangerous one: it would have published a fabricated blind spot in a class the
ensemble does catch. The machinery that stopped it — marking a dead lens `errored`, excluding
contaminated rounds from denominators, refusing to emit a ratio without a valid denominator — was
built *because* that nearly shipped, and it then held through two more halts.

The distinction that makes partial data usable at all: **a detection is durable, an absence is not.**
Reading 2 was a legitimate existence claim (`sd-15` really was found) and an illegitimate ratio. Every
claim in §4 is now of the first kind or comes from the complete run.

The cost was real: three runs, ~2.6M subagent tokens, and precision still unresolved. The alternative
is a number that looks identical whether five lenses worked or five died.

### 4c. Original plan for this section *(superseded by 4)*

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

### 5. The M3 review loop: five rounds, and it has not converged

Data in [`data/rounds/`](./data/rounds/) and the normalized [`data/perRound.json`](./data/perRound.json).
Target: `lib/src`, the ringweave core, after M3 added `shortestPath`/`eccentricity`, connectivity
fields on `BuddyResult`, and the `validateDetailed` split.

| round | confirmed | blocking | themes | quiet lenses | dead lenses |
| --- | --- | --- | --- | --- | --- |
| 1 | 10 | 3 | 5 | 0 | 0 |
| 2 | 3 | 2 | 3 | — | **3** (session limit) |
| 3 | 14 | 4 | 8 | 2 | 0 |
| 4 | 5 | 1 | 4 | 2 | 0 |
| 5 | 13 | 5 | 9 | 1 | 0 |

**It is not monotone, and round 4 was a false summit.** After four rounds of decline, round 5 found
more than round 4 by every measure. Had the loop stopped at round 4's single blocking finding it would
have stopped one round before its largest blocking count. This is the same shape E1 had, and the same
shape Calboreanu published (15, 8, 12, 2, 8, 1, 4, 1, 0) — and it is the strongest evidence available
for the two-consecutive-clean-rounds rule, which neither this loop nor E1's has yet satisfied.

**Full-surface review of a component you just touched finds old bugs.** None of round 1's three
blocking findings were in M3's new code. They were pre-existing core defects: `penalizedAspl`'s flat
disconnection penalty meant both polish passes hill-climbed into *deeper* fragmentation while the
average separation they reported "improved" (a 16-person roster went from one group of 14 to five
fragments, reported separation falling 5.0 → 1.3); the polish gate bounded `n` and nothing else, so
`buildBuddyGraph(120, 12)` took 33 s while `(121, 12)` took 0.1 s; and `ringGreedy` had a memory cap
and no time cap, so `(1000, 999)` — which `validate` refuses outright on the constrained path — ran
over 22 minutes without returning.

**Self-induction, observed live for five consecutive rounds.** E1 could only measure this post-hoc via
blame, at 68% of classifiable findings. Here the chain is visible with its causality intact, because
each round's blocking finding names the previous round's fix:

| round | introduced | next round found |
| --- | --- | --- |
| 1 | `MAX_POLISH_WORK` gate | consulted only on the auto path — one boolean reopened the 33 s case |
| 2 | wrapper clamp on iterations | doesn't bind for direct callers; no constant term (`(3,2)` with `1e9` iterations ran **35.7 s** on a 3-vertex graph); calibration ran before the bound |
| 3 | enforcement inside the primitives | cost model missing the n² term — `allPairsSummary` is Θ(n·(n+m)), so a 3000-vertex 4-edge graph got the full budget |
| 4 | `n·(n+m)` model + overhead | fragmentation guard compares component *count*, weaker than largest-component *size* |

Two things make this different from E1's tail, and both matter. Each fix was **right about the defect
it named and wrong about where enforcement belonged** — so the sequence is a search converging on a
design (budget in the wrapper → in the primitives → with the right cost model), not churn. And
`MAX_POLISH_WORK` was re-derived twice to hold the `(120,4)`/`(121,4)` boundary that fixtures pin; both
times the fixtures regenerated **byte-identical**, which is the check that a recalibration was honest
rather than convenient.

**The ensemble does something a single reviewer would not.** Two different lenses, three rounds apart,
independently built exhaustive probes of the round-1 fix — one examining **432,954** fragmenting
double-edge swaps, the other **1,293,327** — and neither found a swap that fragments while lowering the
objective. Neither was asked to. That is stronger evidence than the property tests in the repo, and it
came from something with no stake in the answer.

**A hazard of the method, found the hard way.** A lens left its probe in the working tree as
`lib/test/zz_frag.test.ts`. Vitest picked it up, it ran 90 s, timed out, and on the next `npm test`
read as two *failing* tests — looking exactly like a regression in the fix just made, and it would have
broken CI if committed. Lenses have Bash access on purpose; nothing tells them to clean up, and a
prompt asking them to would be another instruction obeyed ~79% of the time. Closed mechanically
instead: git is the oracle, an unstaged file in a test directory is residue, and the check proves
itself by creating the thing it catches.

### 6. E2 — self-induction fell in the tier that matters least

Measured by [`scripts/review-metrics/self-induction.mjs`](../../../../scripts/review-metrics/self-induction.mjs)
over the five `lib/src` rounds; data in [`data/sextant-self-induction.json`](./data/sextant-self-induction.json).
Same oracle as E1's, pointed at this loop: for each finding, `git blame` the cited line **in the tree
its critics actually reviewed** — the fix commit's first parent — and ask whether an *earlier* fix on
the *same target* wrote it. Blaming HEAD would credit the fix made in response to a finding as its
cause.

| | E1 / Ouroboros | Sextant |
| --- | --- | --- |
| self-induced (pooled) | **68%** | **23.3%** (7 of 30 classifiable) |
| base rate | 20% | 17.1% (421 / 2,459 product lines) |
| lift over chance | **3.37×** | **1.36×** |
| unknown bucket | — | 19 of 49 |

On the pooled rate this clears the pre-registered bar of "falls by ≥½" — a 66% fall in the rate, 60%
in the lift — and the sensitivity table is flat, so the number is not an artifact of `-M -C`. Read on
before treating that as the result.

**And then the severity split, which is the part that matters.**

| severity | self-induced | pre-existing | rate |
| --- | --- | --- | --- |
| **blocking** | 5 | 4 | **55.6%** |
| suggestion | 2 | 11 | 15.4% |
| deferral | 0 | 8 | 0% |

Self-induction is concentrated almost entirely in the blocking tier. That is the *inverse* of the
comfortable reading: the loop is not mostly tidying up after itself, it is mostly **breaking its own
code in ways that matter and then catching them**. It also confirms mechanically what §5's round table
showed narratively — four of five rounds' blocking findings named the previous round's fix — so that
chain is now an oracle result, not a reading.

**The comparison the pooled numbers hide.** E1's rate is now split by the same oracle, and it changes
the conclusion:

| severity | E1 | Sextant | change |
| --- | --- | --- | --- |
| **blocking** | **61.5%** (8/13) | **55.6%** (5/9) | −10% relative |
| suggestion | 68.9% (51/74) | 15.4% (2/13) | −78% relative |

**The pooled improvement is almost entirely in the suggestion tier. Blocking-tier self-induction did
not meaningfully move.**

That matters because of how E2's criterion was worded: it pre-registered a fall in *"the injected-defect
rate (not the incomplete-fix rate)"*. Injected defects are the blocking ones. Read against the pooled
rate, as literally specified, **E2 passes**. Read against what the criterion was *for* — the loop
breaking its own code — **E2 fails**: 61.5% → 55.6% is nowhere near a halving.

Both readings are reported because the pre-registration is ambiguous between them, and picking the
flattering one after seeing the data is exactly the failure E1 diagnosed. The stronger statement is
the pessimistic one.

**And neither sample can carry a claim either way.** Nine classifiable blocking findings against
thirteen; a Wilson interval on 5/9 spans roughly 27–81% and on 8/13 roughly 36–82%. They overlap almost
completely. The correct summary is **no detectable change in blocking-tier self-induction**, not a
small improvement.

**Why the suggestion tier fell so far is the mechanism, and it is the reforms working as designed —
just not where they were sold.** Lever A1 moved E1's recurring lint-class labels to an actual linter,
and the `caseOnly` / `deferral` rules stopped preference-judgement findings from gating. Both target
exactly the volume that made up E1's suggestion tier. They were *justified* by the self-reference tail;
they *acted* on the nit tail.

**One further reason Sextant's figure can only rise.** Five rounds against twenty-one. Self-induction
is cumulative — every round adds fix code for a later round to trip over — and §5 shows this loop has
not converged.

**What is durable regardless.** The `unknown` bucket is 39% of findings, which is the oracle being
honest rather than a defect: a finding with no line, or one citing a blank/comment/brace-only line, is
not evidence either way, and Quach et al. document blame attribution as sub-optimal for exactly the
non-functional findings three of five lenses specialise in. E1's version of this figure was a
hand-label by the agent that authored the fixes; this one is `git`.

### 7. E4 — the strongest cost result is not about cost

Measured by [`scripts/review-metrics/lever-a-savings.mjs`](../../../../scripts/review-metrics/lever-a-savings.mjs);
data in [`data/leverSavings.json`](./data/leverSavings.json). The three levers are reported separately
rather than pooled into one saving, because their evidential strength differs by an order of magnitude.

**A1 — lint preemption. This is the result worth keeping, and it is a capability claim, not a cost
claim.** The lint gate did not exist during E1, so it was replayed *over E1's own history*: today's
oxlint rule set, run in detached worktrees at E1's baseline and at its converged head.

| ref | sites | rule hits |
| --- | --- | --- |
| E1 baseline `24b5dd6` | 2 | 4 |
| E1 converged head `462360d` | 2 | 4 |

Twenty-one rounds of five-lens adversarial review did not change that count. One site is **byte-identical
across the entire run**: the SVG click handler at `app/src/graph/GraphView.tsx:144` is flagged at the
baseline, and is still flagged at the converged head as `app/src/graph/GraphCanvas.tsx:208`. The loop
renamed the file and never filed the defect. The other head site, `app/src/panels/Notice.tsx:5`, is the
baseline's `App.tsx:153` notice element extracted into its own component *during* review — a new line
carrying an equivalent defect, which the script labels `introducedDuringReview` while recording in
`introducedMeaning` that the bucket asserts the line is new and not that the defect class is.

Both are `jsx-a11y` click-handler defects, which matters because **E1's only late user-visible bug was
an a11y gap it found by luck** (a missing `aria-pressed`, round 16). The lens that would own these
existed. It ran twenty-one times. A deterministic rule set finds them in under a second, and the
comparison needs no model on either side of it.

So the honest framing of Lever A1 inverts the proposal's. A1 was sold as *cheaper* — move the lint
classes off the critics to save tokens. What it demonstrably is, is **more capable on its own classes**.
The saving is real but secondary; the capability gap is the finding.

**Scope limit, stated rather than discovered.** Only oxlint can be replayed at those refs — knip needs a
repo-root install that did not exist, and the custom hygiene checks are coupled to the current tree's
identifiers. A1 is therefore a **lower bound** on lint preemption.

**A2 — triage theme-collapse.** 59 raw per-critic findings merged into 40 themes across the six rounds
recorded so far: **32.2% collapsed**. This is a deduplication figure and nothing more. Several critics
reporting one theme is not corroboration and carries no severity information — ten agents once
unanimously endorsed a padding oracle that did not exist, killed by one empirical test.

**A3 — saturation skipping: zero, and the reason is a defect in the harness rather than a fact about
the loop.** The first version of this section said no lens ever reached its gate. That was wrong, and
the way it was wrong is the more interesting result.

`critic-interaction` returned `nothingFound` on `lib/src` in rounds **3, 4, 5 and 6 — four
consecutive** — against a `saturation_gate` of 2. Its surface is `app/src/**`, so on a `lib/src` round
no changed path touches it and both halves of the skip condition were satisfied from round 5 onward. It
was spawned anyway, twice, at a measured mean of ~76 K tokens per agent.

The cause: review workflows cannot touch the filesystem, so the caller owns
`.claude/review-state.json` and passes the streaks in. **Nothing ever wrote that file.** Every round
was invoked with no prior state, so every streak restarted at zero, and the `saturation` object each
round *returned* looked entirely plausible because it was being recomputed from zero each time.

Two mechanisms failed together, and the second is the one worth generalising:

- The runner accepted a JSON-**string** `args` down its plain-target branch, so `changedPaths` and
  `saturation` silently became empty while `target` became the whole `{"target":…}` blob. It now parses
  a `{`-leading string and throws on malformed JSON rather than reviewing a directory that cannot exist.
- **A skip that fails to happen produces no output at all.** The runner was built so that "every skip
  is logged, so it is a visible decision, never a silent gap" — and that is exactly half a guard. It
  watched the direction where the loop does less work than expected and left the opposite direction
  unobserved. The fix is symmetric: every lens now reports `{streak, gate, surfaceTouched, ran, why}`
  whether it ran or not, and a round with no prior state at all says so in the log.

So A3's honest figure is **zero tokens saved, ~150 K tokens wasted**, and the lever's mechanism is
**unfalsified rather than unexercised** — it was never given its input. The streaks are now *derived*
from the round record by [`saturation-state.mjs`](../../../../scripts/review-metrics/saturation-state.mjs)
rather than maintained by hand, because a number typed into a state file by whoever ran the round is
precisely the bookkeeping this experiment exists to replace with an oracle.

This is also the cleanest instance in the run of the failure the whole experiment is about. The guard
was written by the same agent that wrote the thing it guards, it guarded the direction that agent had
in mind, and it went on reporting success for six rounds. No critic caught it either — all five lenses
review `lib/src` and `app/src`, and nobody's surface includes the harness.

**What E4's pre-registered criterion says about this.** E4 asked for ≥40% token reduction with zero loss
of recall. One of its three components is unexercised, one is a dedup count that cannot be converted to
a token figure without assuming what a critic would have spent on the duplicates, and the third is a
lower bound measured on a different codebase. **E4 is not answerable as worded** on the data this run
produced, and saying so is more useful than assembling the three into a number that would not survive
being asked how it was computed.

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

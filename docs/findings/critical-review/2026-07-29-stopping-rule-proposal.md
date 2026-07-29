# Proposal — measuring when to stop, not just what to find (experiment "Chronometer")

**Status:** proposal, not adopted. Nothing here is load-bearing until an experiment measures it.
**Baselines:** [`2026-07-24-ouroboros/`](./2026-07-24-ouroboros/) (**E1**) and
[`2026-07-25-sextant/`](./2026-07-25-sextant/) (**E2–E4**).
**Reviewed:** not yet. This document has had no adversarial pass; treat every claim in it as
unstressed.

---

## 0. Why "Chronometer"

A sextant fixes your latitude against something outside the ship. It cannot give you longitude —
for that you need a clock, and the longitude problem stayed open for a century after the sextant
was good enough. Sextant (the experiment) did the same thing: it replaced agent judgement with
external oracles and measured the result honestly, and it still could not tell the loop **when to
stop**. Forty rounds, no convergence, and a cost curve that steepened.

The open problem is not *finding*. It is *stopping*.

## 1. What the two prior runs settled

Short, because both are written up in full.

- **E1 converged and the convergence was hollow.** Zero-confirmed fired at round 21, eight rounds
  after the last blocking finding, with two-thirds of late findings pointing at the loop's own code.
- **Sextant halved self-induction and never converged.** 32.5% of classifiable findings self-induced
  against a 23.2% chance base (1.40× lift, down from E1's 3.37×) — but **51.9% of *blocking*
  findings were still self-induced**, the per-round series plateaus rather than decaying, and cost
  per blocking finding rose 7.9× on `app/src` against E1's 3.04× per confirmed finding.
- **External oracles worked; more rounds did not.** Every blocking finding in Sextant's last five
  rounds per target was closed by adding an oracle (a Python-first algorithm mirror, a counted work
  budget, a source-reading sync guard, a CSS live-region guard) rather than by more critic attention.
  Replaying today's lint rules over E1's history finds a violation that survived all 21 of its rounds.

## 2. The one thing neither run could distinguish

Both loops kept producing findings forever. There are two completely different explanations and
**no round of either experiment can tell them apart**, because every round both reviewed *and
changed* the tree:

- **(A) The loop creates its own residual.** Each fix introduces new surface; the population never
  empties because it is being refilled. Self-induction at ~52% on blocking findings is consistent
  with this.
- **(B) The critics sample stochastically from a large fixed space.** The same unchanged tree would
  yield new findings every round regardless, because a critic run is a draw, not an enumeration. The
  ~15% published precision of LLM reviewers and Sextant's own controls — 20 findings on four
  *unseeded clean* worktrees — are consistent with this.

If (A) dominates, the answer is fewer/smaller fixes. If (B) dominates, the answer is a residual
estimator and a stopping rule, and no amount of fixing will ever produce a clean round. **These
prescriptions are opposite**, and both prior experiments spent their whole budget without separating
them.

## 3. The experiment

### 3.1 The keystone: a frozen-tree arm (**F**)

Run **N = 8 rounds against a byte-identical, frozen tree**, fixing nothing. Same lenses, same
prompts, same gate, fresh contexts. Record every finding.

This is the control both prior runs lacked, it is the cheapest thing in this document, and it
answers the question directly:

| observation on the frozen tree | conclusion |
| --- | --- |
| findings/round decays toward 0 | the space is finite and enumerable; (A) dominates; zero-confirmed is a reachable stopping rule |
| findings/round stays flat | (B) dominates; zero-confirmed is **unreachable by construction** and every round of E1 and Sextant that "found something new" was partly measuring sampling noise |
| new findings decay but *repeats* stay flat | the loop is re-reporting a stable core it cannot fix — a third possibility neither run considered |

It also yields, for free and for the first time: **per-round finding overlap on identical input**,
which is the denominator every capture–recapture residual estimate needs and which neither prior run
could compute (their population was open by construction).

Pre-registered criterion: **F succeeds as an instrument if the 8 rounds produce a rank correlation
between round index and new-finding count with |ρ| interpretable at n=8** — and it is reported as
underpowered if not. It cannot fail to be informative; flat and decaying are both results.

### 3.2 Make the gate mechanical (**G**)

Sextant's design said a finding with no machine-checkable invariant is filed `caseOnly` and does not
gate convergence. Critics set the flag on **23 of 304 findings**. The mechanism aimed squarely at
E1's stated cause of non-convergence was delegated to the judgement the experiment exists to remove,
and therefore never operated.

Replace self-declaration with an executable test: **a finding gates convergence only if its
`invariant` field is submitted as a runnable test that fails on the current tree.** The runner runs
it. Red → the finding gates. Green or unrunnable → filed, logged, does not gate.

This is strictly subtractive at the protocol level (it deletes a judgement) and it is the only
change here that could plausibly make convergence fire. It is also falsifiable in a way the flag
never was: if convergence still does not fire, the preference tail was not what was blocking it.

Pre-registered criterion: **G succeeds if convergence fires within 12 rounds on a target where
Sextant's rule did not fire in 20**, with no loss of blocking-finding recall against the seeded
corpus.

### 3.3 Break the lens/model confound (**M**)

Sextant introduced the interaction lens and the small model tier in the same change. That lens filed
the fewest findings and the **highest blocking rate of any lens (60%)**, on the cheapest model —
easily the run's most striking result and completely confounded.

Run a 2×2: {interaction, correctness} × {large, small}, four cells, same target, same round. Four
extra agent-runs answers whether the result belongs to the lens or the tier.

Pre-registered criterion: **M is reported as underpowered unless the cell difference exceeds the
run-to-run variance measured by arm F** — which is exactly why F runs first.

### 3.4 Retire SOLID against the harness, not against a hunch (**S**)

47 findings, **zero blocking**, 30 deferrals across 40 Sextant rounds; removing it costs zero seeded
recall in leave-one-out. Against that: 32 themes no other lens raised.

Drop it for the whole run and measure what is lost — the same leave-one-out the harness already
computes, but prospective rather than post-hoc. If nothing is lost, that is a 20% ensemble cost
reduction with a measurement attached instead of an argument.

### 3.5 Track comment-to-code as a label-free cost of the method (**C**)

Found by the repository's owner in one sentence of review, after forty rounds and five lenses had
not looked at it. Measured across `lib/src` + `app/src`:

| point in history | code | comment | ratio |
| --- | ---: | ---: | ---: |
| M2 baseline, before any review loop | 2,282 | 537 | **0.24** |
| M3 features written, before the 40 rounds | 3,590 | 1,384 | **0.39** |
| after the 40 rounds | 4,538 | 3,166 | **0.70** |

`lib/src/core/budgets.ts` reached **6.4 comment lines per line of code**, and the largest single
comment block in the tree was 41 lines.

**The mechanism is the loop, not a taste for explaining.** Each round embedded the case against a
rejected alternative in the source so the *next* round would not re-propose it — writing to critics,
in a medium that outlives the review by years. It is the same self-reference E1 named, surfacing in
an artifact nobody had thought to measure, and it is invisible to every instrument either experiment
built: it is not a finding, not a defect, not a token cost, and no lens files it.

Two things make it worth carrying forward:

- **It is label-free**, like fix-churn. `git` answers it; no agent judges anything. Record it per
  round and the growth curve comes out for free.
- **It suggests the class rather than the instance.** If the loop inflates comments, ask what else
  it inflates that no lens is pointed at — abstraction count, indirection depth, test-to-assertion
  ratio, public API surface. "What did the method make worse in a dimension it does not measure" is
  a question neither prior experiment asked, and the one instance of it we have was found by a human
  reading the diff.

**Deliberately not a linter.** A block-length or density cap was proposed and rejected: the
pathology is *who the prose is addressed to*, and a cap measures length instead — crude, gameable by
splitting a block in two, and one more mechanism policing a problem whose fix is a rule about
audience. `docs/COMMENT_STANDARD.md` states the rule; `fix-finding` now requires adjudication in the
commit message rather than defence in the source.

### 3.6 Record effective-FP at fix time (**P**)

Google's definition, verbatim: an issue where *developers did not take some positive action after
seeing it*. Sextant measured precision only on clean controls. Record, per finding, whether the fix
step took an action — one boolean, written when the fix is applied, no new agent. That turns
precision into a per-round series on the real target rather than a single control-tree number.

## 4. What this deliberately does not do

- **It does not add a lever.** Sextant added five and the two that mattered (external oracles, lens
  rotation) were the two that replaced judgement with a mechanism. G is the only new mechanism here,
  and it removes a judgement rather than adding a step.
- **It does not chase the cost curve.** Cost per finding rose in both runs. Nothing here is designed
  to flatten it, because we do not yet know whether the curve is a property of the loop or of the
  sampling — which is F's question.
- **It does not build a bigger seeded corpus first.** Sextant pre-registered ~24 seeds and scored 5;
  the honest lesson is that a corpus built *before* the loop competes with the loop for the same
  budget and loses. If a corpus is wanted, it should be a separate deliverable with its own budget,
  not a prerequisite bolted to a review run.

## 5. Cost

Arm F is 8 rounds × 4–5 lenses ≈ 40 agents, and it is the only arm that must run first. G, M, S, C
and P ride along on a normal review loop and add roughly one agent-run per round plus four for M; C
adds no agent at all, since `git` answers it. That
is well under a third of Sextant's 21.7 M tokens, and F alone — maybe 3.5 M — would answer the
question both prior experiments spent 27 M tokens failing to separate.

## 6. What would change our mind about running this at all

- If arm F shows findings/round decaying to zero on a frozen tree, then explanation (A) holds, and
  the right next experiment is about **fix size** — not stopping rules. G, M, S and P stay; the
  framing changes.
- If the frozen tree yields near-identical findings each round (high overlap, flat count), the
  critics are more deterministic than assumed, capture–recapture is inapplicable, and the interesting
  question moves to why fixing does not reduce the count.
- If G fires convergence in three rounds, the preference tail was the whole story and Sextant's
  forty rounds were mostly a gate defect. That would be an uncomfortable result and it is the one
  this proposal is most exposed to.

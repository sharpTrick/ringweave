# Ouroboros — convergent adversarial review, measured

**Experiment.** Run a full-surface, multi-critic adversarial code review *to convergence* on
one real app (the BuddyGraph front-end, `app/`), fixing and test-ratcheting every confirmed
finding each round, and stopping only when a round reports **zero confirmed findings**. Then
reconstruct the whole run from its structured outputs and ask: *did the mechanism spend its
effort where the value was?*

**Method under test.** Each round spawned **4 fresh-context critics** (correctness, SOLID,
security, maintainability) that reviewed the **whole** `app/` surface (not a diff), returned
structured findings (`severity`, `verdict`, `class`, `file`, `failure`, `remediation`,
`testUpgrade`), and had every **confirmed** finding fixed and locked into a test before the next
round. Loop terminates on a round with zero confirmed findings; a second confirming round guards
the signal. (The executable runner is `.claude/workflows/adversarial-review.js`; the protocol is
`docs/REVIEW_PROTOCOL.md`.)

**Why "Ouroboros."** The defining empirical result is that the loop spent its **second half
reviewing its own output**: 66.7% of all post-baseline findings targeted code the loop itself
had introduced, rising to 100% across rounds 13–16. The snake ate its tail. The name is the
run's signature, not a verdict on the method — the first half was genuinely productive.

The visual companion is [`retrospective.html`](./retrospective.html) (self-contained; open in a
browser). The reproducible datasets are under [`data/`](./data). This file is the durable record.

---

## What we concluded

> The loop worked — it shipped an app with **no known blocking defects** and grew the test suite
> from 68 to 136. But it ran in **two distinct regimes of near-identical cost and opposite value**,
> and it manufactured most of its own later work. The stopping rule optimized a metric
> (zero-confirmed) that had **decoupled from user value ~8 rounds before it fired.**

### 1. Two regimes, split at round 12

| | **Regime I — Discovery** (R4–12) | **Regime II — Self-review tail** (R13–21) |
|---|---:|---:|
| Rounds | 9 | 9 |
| Confirmed findings | 57 | 18 |
| **Blocking findings** | **13** | **0** |
| Subagent tokens | 2.70 M | 2.57 M |
| **Tokens / confirmed finding** | **47 K** | **143 K** |

Near-identical compute (2.70M vs 2.57M) for opposite value: 13 blocking issues versus zero, at
**3× the cost per finding**. Rounds 13 and 15 each spent ~300 K tokens to surface a *single*
suggestion. Every analytical lens located this boundary independently (value knee at R8, last
blocking at R12, self-induced peak R13–16, security saturation at R12).

### 2. Two-thirds of what it found, it had caused (iatrogenesis)

Each round reviewed the prior round's commit, so a finding is **self-induced** when it targets a
constant, comment, abstraction, or code the loop's own fixes created.

- **56 of 84 post-baseline findings (66.7%) were self-induced** — 36 by the immediately-prior
  fix, 20 by an earlier loop-introduced construct. Only 28 were pre-existing original code.
- The share **rose** from 65% in the discovery era to **70%** in the tail.
- **Rounds 13–16 were 100% self-induced (12/12)** and surfaced **zero** pre-existing bugs — the
  loop reviewing `LAYOUT_MODES`, lazy `forcePos`, `SEPARATION_DEFAULT`, `POLISH_MAX_N`,
  `FORCE_MAX_EDGES`, all constructs it had itself added.
- Both endpoints were manufactured: the **final blocking finding** (R12, a flaky test) was
  introduced by round-11's own defer fix; the loop's **terminal finding** (R21) was a defect in
  round-20's fix.

Caveat, stated up front: **self-induced is not the same as worthless.** Completing a genuinely
incomplete fix is real progress — the reroll no-op (R7→R8) and the CSV-injection escalation to a
real blocking bug (R9→R10) were legitimate follow-ups. The problem is the *ratio*, and that by
R13–16 the follow-ups were hardening scaffolding for features that were never built.

### 3. Only 17% of confirmed findings were user-visible bugs

Re-bucketing all 75 confirmed findings by genuine engineering value:

| Bucket | Count | Note |
|---|---:|---|
| Consistency (copy/gauge contradictions, drift-prone duplication) | 31 | largest bucket; ~half invisible to users |
| Doc-hygiene (stale comments, dead code/exports) | 13 | |
| **Real user bug** (wrong output, no-op, hung UI) | **13** | 12 of them by round 8 |
| Latent robustness (hostile-input / resource hardening) | 11 | unreachable in ordinary use |
| Extensibility speculation (seams for unbuilt F8/F7) | 6 | |
| Test-infra (a self-inflicted flaky test) | 1 | |

**The value knee is round 8, not round 12.** Rounds 4–8 hold 12 of the 13 real bugs; rounds
9–21 produced 34 more confirmed findings and **exactly one** user-facing bug (a missing
`aria-pressed`, R16). The 13 real bugs collapse to ~6 distinct defects, all but one living on two
surfaces: **file import of hand-edited files** and the **reroll button**. Genuine value came
almost entirely from stress-testing the two input-taking features.

### 4. The ratchet locked cases, not themes

Every confirmed finding was ratcheted into a test. Of 92 findings, **87 wore distinct class
labels; only 4 ever literally recurred**, and **no ratcheted input ever re-broke across 18
rounds** — a genuine, durable anti-regression lock.

But it was a poor **anti-theme** barrier: the 92 findings collapse into ~12 themes, and **8 of
them recurred across ≥3 rounds under *new* class labels.** The reroll theme wore **11 distinct
labels** for one behavioral concern. The ratchet caught the exact tuple; the theme walked around
the point-test — reviewers said so in their own `testUpgrade` notes ("tests `\t`/`\r` only as
*leading* chars, so it cannot catch this," R10). Passing tests gave a false sense a *class* was
closed when only an *instance* was.

Representative chain (severity **escalated** as the theme moved):
`csv-formula-injection` R8 (plausible, CSV path) → `incomplete-formula-neutralization` R9
(plausible, the clipboard path R8 left unguarded) → `embedded-delimiter-formula-injection` R10
(**confirmed, blocking** — a tab inside a name defeats the leading-char guard).

### 5. An asymmetric instrument set determined the stopping point

| Critic | Confirmed | Sole-source blocking | Behavior |
|---|---:|---:|---|
| correctness | 15 | 3 (5 total) | steady — never decayed; owns the last blocking |
| security | 12 | 4 (5 total) | **extinct after R11** — finite surface, exhausted |
| solid | 16 | 1 | bimodal — one irreplaceable catch (R4 async race) |
| maintainability | 32 | **0** | never saturates — self-renewing surface |

- **Correctness + security caught 10 of 13 blocking bugs** (7 sole-source), then correctly went
  quiet. Security's surface here is small and enumerable (this app is local, offline, no
  network/auth); it capped essentially all of it by R11 and returned "nothing found" for **nine
  straight rounds**.
- **Maintainability filed 43% of all findings but zero sole-source blocking.** Its surface is
  effectively unbounded and self-renewing — every fix seeds a fresh stale comment or duplicated
  constant.
- **Convergence was gated by maintainability running out of nits, not by the app becoming correct
  and secure** — which had happened by ~round 12.

### 6. The stopping rule was severity-blind and grade-fragile

The rule was "a round reports zero *confirmed* findings."

- **It came one grading decision from stopping five rounds early.** R15 reported a single
  confirmed finding from a single critic; had it been graded *plausible*, the rule fires at R15 —
  a stop R16's spike-to-4-confirmed would immediately have falsified.
- **The confirmed curve was non-monotonic:** `1 → 3 → 1 → 4 → 3 → 3 → 3` across R13–19, then a
  cliff to 0. No leading indicator; the rule ran blind until a four-critic zero coincided — twice.
- **Zero-confirmed is a grading threshold, not an absence of observations.** Both converged
  rounds still surfaced a plausible, both pointing at the *same* soft spot (the App.tsx
  error-recovery branch). The two-round confirmation — not the zero itself — is what supplied
  robustness.

---

## Headline numbers

- **18 rounds captured** (4–21); the loop also ran rounds 2–3 (git-only, not in the structured
  dataset). **92 findings** — 75 confirmed, 13 blocking, 17 plausible.
- **~5.26 M subagent tokens**, **~140 min** wall-clock, **≈19 fix commits**, tests **68 → 136**
  (≈1 test per confirmed finding).
- Findings concentrated in `App.tsx` (18), `model.ts` (16), `importGraph.ts` (11) — the
  composition root and shared view-model absorbed most churn.
- First converged: **round 20**; confirmed: **round 21**. Last blocking: **round 12**. Value
  knee: **round 8**.

## Method & provenance

- **Quantitative facts** (counts, tokens, timing, churn, class frequency) are parsed
  deterministically from the 18 workflow output files and `git` history — reproducible from
  [`data/`](./data) (`rounds.json`, `perRound.json`, `findings_full.json`).
- **Interpretive layers** (value bucketing, self-induced attribution, theme clustering) were
  produced by five independent fresh-context analysis agents reading the finding text,
  cross-checked against findings that self-describe their cause. These are judgment calls; the
  boundaries between "consistency" and "real-bug," or "immediate" and "lagged" self-induction,
  carry ±1–2 findings of ambiguity and do not move any headline conclusion.
- The reviewed code lives on branch `claude/m2-xapjhu`; this analysis on
  `claude/critical-review-ouroboros`.

## Corrections (added 2026-07-24, after adversarial peer review)

Three adversarial reviewers stress-tested the proposal built on this run and found real problems
with how some of these conclusions were framed. Corrected here rather than quietly left standing:

- **"Two regimes" is partly true by construction.** The boundary was drawn at the last blocking
  finding, so "the tail had **0 blocking**" is definitionally true, and the near-equal token split
  (2.70M vs 2.57M) is a coincidence of that specific cut — move the line to round 8 and both the
  parity and the 3× ratio change. The durable observation is the **continuous decay in value per
  token** (~47 K → ~143 K per finding), not two tidy halves. Read the table as an illustration of
  that decay, not as evidence of a phase change.
- **There are two different "knees," and this document conflated them.** Round 8 is where
  *user-visible bugs* stopped arriving (12 of 13). Round 12 is where *blocking findings* stopped
  (10 of 13 blocking had landed by round 8; three more came in rounds 10–12). Both are real; they
  are not the same event and "the knee" should always be qualified.
- **"66.7% self-induced" mixes waste with progress.** It counts both *a fix that injected a new
  defect* and *a fix that was incomplete and got hardened next round*. Only the first is waste — the
  reroll and CSV chains were genuine incremental hardening. The figure is also a hand-label (there
  is no such field in the dataset) reported to three significant figures over a ±1–2-finding
  judgment call, and it was coded by the same agent that authored the fixes. Treat it as an upper
  bound on iatrogenesis, not a measurement; the honest split needs blind coding.
- **Token-per-finding figures carry false precision.** They follow directly from the cut point
  above; treat them as order-of-magnitude.

None of these corrections change the four conclusions the follow-up proposal is built on (cost per
finding rose sharply while blocking findings went to zero; the ratchet locked cases not themes; the
instrument set gated the stopping point; most late findings pointed at loop-authored code). They do
change how much confidence any single number deserves.

## What would change our mind

These conclusions are drawn from **one run on one app**. They would be revised by:

- **A different app surface.** This app is small, offline, client-side, no network/auth/server.
  The early saturation of the security lens is partly a property of that surface. A larger app
  with a genuinely deep security/correctness surface might keep the diagnostic lenses productive
  far longer, moving the knee right on its own.
- **Diff-scoped vs full-surface.** The 66.7% self-induced rate is partly a consequence of
  re-reviewing the *whole* surface every round after the original code was already combed. A
  review that scoped to the round's own diff would report a different iatrogenesis figure (and a
  different blind-spot profile) — untested here.
- **A different stop rule.** "Zero confirmed" is one of many. A severity-gated or value-gated
  rule would have registered "done" at ~R12 and never entered the tail; whether that under-stops
  (misses the R16 a11y bug, the only tail real-bug) is the open question.
- **Repeat runs.** N=1. The non-monotonic curve and the R15 near-miss suggest per-round yield is
  a noisy sample; the two-regime split and the iatrogenesis ratio would need a few more runs to
  be trusted as general rather than incidental.

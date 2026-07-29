# Critical review — experiments on the review process itself

Findings *about the review mechanism*, not about the code it reviews. The rest of
`docs/findings/` records what we learned about the graph algorithms; this subtree records what we
learned about **how we find things** — the adversarial-review loop as an object of study.

The motivating problem (the reviewer's own words):

> Both humans and LLM agents are prone to blind spots when implementing code, and to
> self-approval bias — the working solution is so much better than nothing that it is hard to see
> every introduced bug, over-complication, or banked tech debt. Code review is the standard
> mitigation; a fresh, context-free pair of eyes spots what the author cannot. But an *initial*
> review has blind spots too, seeing `m` issues and leaving `n − m`. Our approach: keep reviewing
> the full scope with fresh contexts, ratcheting fixes into tests each iteration, until reviews
> come back clean.

Each experiment here instruments one run of that approach (or a variant), reconstructs it from
its structured outputs, and reports what actually happened — quantitatively first.

## Convention

- **Experiments** get a date-prefixed directory with a memorable codename
  (`2026-07-24-ouroboros/`). A `README.md` is the durable, git-readable record (numbers over
  adjectives; state what would change the conclusion). Visual companions and the reproducible
  datasets live alongside it.
- **Proposals** get a date-prefixed file (`2026-07-24-external-oracle-review-proposal.md`). A
  proposal is not load-bearing until an experiment measures it; say so at the top.
- Date-prefixed because process experiments are *episodes* — unlike an algorithm finding, the run
  date is part of what the record means (which tooling, which protocol version, which app state).

## Experiments

- **[`2026-07-24-ouroboros/`](./2026-07-24-ouroboros/)** — the first run: full-surface, 4-critic
  adversarial review to zero-confirmed convergence with test-ratcheting, on `app/`. 18 rounds, 92
  findings. Signature result: the loop spent its second half reviewing its own output, at ~3× the
  cost per finding of the productive first half, with one user-visible bug to show for it.
  Established the value-decay curve, the case-vs-theme gap in the test ratchet, and the gap between
  the zero-confirmed stop signal and actual user value. Carries a corrections section from
  subsequent peer review — read it alongside the conclusions.
- **[`2026-07-25-sextant/`](./2026-07-25-sextant/)** — the successor run: the external-oracle
  proposal built and then measured, over **40 rounds** (20 on `lib/src`, 20 on `app/src`, 5 lenses
  across 3 models, 304 findings, 21.7 M subagent tokens) on M3. Signature result: **self-induction
  halved and convergence never fired.** 32.5% of classifiable findings pointed at the loop's own
  earlier code against a 23.2% chance base rate — a 1.40× lift where Ouroboros measured 3.37× — but
  51.9% of *blocking* findings were still self-induced, the per-round series plateaus rather than
  decaying, and cost per blocking finding rose faster than in Ouroboros. Adds what Ouroboros had no
  instrument for: a mechanical blame oracle, seeded-defect recall, and unseeded clean controls.
  [`analysis.html`](./2026-07-25-sextant/analysis.html) is the visual companion — what worked, what
  did not, and the open questions in the form a later run can attack.

## Proposals

- **[`2026-07-24-external-oracle-review-proposal.md`](./2026-07-24-external-oracle-review-proposal.md)**
  — what to change after Ouroboros, hardened against three adversarial peer reviews. Organizing
  principle: *every robust fix replaces agent judgment with an external oracle or is strictly
  subtractive; every fragile one asks an agent to grade its own work.* Two levers (shrink the junk
  denominator; find what prose critics can't), low-level changes to the critic/skill/workflow
  definitions, and three experiments with pre-registered success criteria — keystone first: build
  the seeded-defect recall harness before the improvements that claim "no loss of recall."
  **Measured by Sextant**: the organizing principle held, the levers were uneven, and the corpus
  never reached its pre-registered size.
- **[`2026-07-29-stopping-rule-proposal.md`](./2026-07-29-stopping-rule-proposal.md)** — what to
  change after Sextant, and unlike its predecessor it has had **no adversarial pass yet**. The open
  problem is no longer finding but *stopping*: neither prior run could separate "the loop creates its
  own residual" from "the critics sample stochastically from a large fixed space", because every
  round both reviewed and changed the tree. Keystone is a **frozen-tree arm** — N rounds against a
  byte-identical tree, fixing nothing — plus a mechanically-executable convergence gate, a 2×2 that
  breaks Sextant's lens/model confound, and effective-FP recorded at fix time.

## Companion documents

- `docs/REVIEW_PROTOCOL.md` — the authoritative process these experiments run.
- `.claude/workflows/adversarial-review.js` — the executable runner.

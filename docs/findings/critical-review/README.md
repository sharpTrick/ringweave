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

## Proposals

- **[`2026-07-24-external-oracle-review-proposal.md`](./2026-07-24-external-oracle-review-proposal.md)**
  — what to change after Ouroboros, hardened against three adversarial peer reviews. Organizing
  principle: *every robust fix replaces agent judgment with an external oracle or is strictly
  subtractive; every fragile one asks an agent to grade its own work.* Two levers (shrink the junk
  denominator; find what prose critics can't), low-level changes to the critic/skill/workflow
  definitions, and three experiments with pre-registered success criteria — keystone first: build
  the seeded-defect recall harness before the improvements that claim "no loss of recall."

## Companion documents

- `docs/REVIEW_PROTOCOL.md` — the authoritative process these experiments run.
- `.claude/workflows/adversarial-review.js` — the executable runner.

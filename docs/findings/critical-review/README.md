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

- One directory per experiment, with a memorable codename. A `README.md` is the durable,
  git-readable record (numbers over adjectives; state what would change the conclusion). Visual
  companions and the reproducible datasets live alongside it.

## Experiments

- **[`ouroboros/`](./ouroboros/)** — the first run: full-surface, 4-critic adversarial review to
  zero-confirmed convergence with test-ratcheting, on `app/`. 18 rounds, 92 findings. Signature
  result: the loop spent its second half (rounds 13–21) reviewing its own output — **66.7% of
  findings were self-induced**, at 3× the cost-per-finding of the productive first half and with
  a single user-facing bug to show for it. Established the "two-regime" shape and the gap between
  the zero-confirmed stop signal and actual user value.

## Companion documents

- `docs/REVIEW_PROTOCOL.md` — the authoritative process these experiments run.
- `.claude/workflows/adversarial-review.js` — the executable runner.

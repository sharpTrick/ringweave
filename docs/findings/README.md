# Findings

Research findings and hard-won knowledge — the *why* behind decisions, the empirical
results that settled them, and the gotchas that cost someone real time to learn.

This is the home for durable, load-bearing knowledge. It is deliberately distinct from
the other places the project remembers things:

- **`docs/findings/` (here)** — what we learned and why it's true: benchmark results,
  design decisions with their rationale, cost models, failure modes, "we tried X and it
  lost because Y." A future contributor should be able to *trust and act on* these.
- **`docs/journal/`** — testimony, not knowledge. What it was *like* to work here.
  Nothing there is load-bearing; no session should follow a journal entry as guidance.
- **`docs/` (proper)** — intent and plans: `PROJECT_PLAN.md`, `DESIGN_HANDOFF.md`,
  `HANDOFF.md`, `UPSTREAMING.md`, and provenance in `CONCEPT_LINEAGE.md`.
- **`lib/CLAUDE.md`** — the day-to-day working agreement for the core (commands,
  quality bar, review protocol) and its live list of *known limitations*.

## Convention

- One file per finding or topic. Descriptive names (`constrained-generation-cost-and-caps.md`),
  not dated filenames — a finding is about the knowledge, not the day.
- Say what you concluded, the evidence for it, and what would change your mind. Numbers
  beat adjectives; a measured 45 s beats "slow."
- When a finding stops being true, update it in place and note what changed. Findings are
  meant to stay consistent with the code — unlike the journal.

## Contents

- **`FINDINGS.md`** — the original algorithm bake-off: why ring-greedy + incremental cache
  is the default seed, and why swap-polish rides on top. ASPL-gap results per method/size.
- **`CONSTRAINT_FINDINGS.md`** — the constraint-architecture decision: constrained-greedy
  (B) + constraint-preserving polish, and the churn numbers that justified soft priors.
- **`constrained-generation-cost-and-caps.md`** — the cost model of constrained generation,
  the two safety caps that bound it, and how the naive cost metric was disproved by
  measurement.
- **`churn-priors-weight.md`** — the prior-weight sweep behind the honest F9 claim: how much
  of an existing buddy assignment survives a roster change, and at what ASPL cost.
- **`critical-review/`** — experiments on the *review mechanism itself* rather than on the
  graph algorithms: what the adversarial-review loop actually costs, what it finds, and what
  it manufactures. Has its own README and its own dating convention, because a process
  experiment is an episode.

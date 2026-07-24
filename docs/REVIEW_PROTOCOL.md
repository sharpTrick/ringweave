# Adversarial review protocol

The single source of truth for the adversarial critic review gate, governing **both** the
`ringweave` core (`lib/`) and the BuddyGraph app (`app/`). `lib/CLAUDE.md` and `app/CLAUDE.md`
reference this file. They may add component-specific *lenses*; this file governs the *process*.

## When it runs

Every non-trivial change gets an adversarial review before commit. "Non-trivial" is anything past a
typo or a one-line mechanical edit — new logic, a new module, a bug fix with reasoning, a refactor.

## The committed critics

Four adversarial sub-agents live in `.claude/agents/`: `critic-correctness`, `critic-solid`,
`critic-security`, `critic-maintainability`. They default to skepticism and try to *break* the
change. They run on `model: opus` at `effort: medium` (raise a critic's `effort` in its frontmatter
for a deeper pass when a change warrants it).

## The loop (non-negotiable)

1. **Full-surface, every round.** Point each critic at the *whole component under review* (e.g. all
   of `app/src`), never a diff. Critics anchor on the first/biggest issue they see; a diff-scoped
   review hides everything the anchor is sitting on top of.
2. **All four, every round, in parallel.** Correctness, SOLID, security, maintainability — every
   round. Not a subset.
3. **Verify each finding against the code before acting on it** — reproduce or trace it — to filter
   false positives. Fix confirmed blocking findings or justify them explicitly; log suggestions.
4. **Ratchet every confirmed finding into the suite before closing it.** Codify the *class* (a
   parameterized case or a widened property/fuzz generator), not the one input, so a future critic
   finds the class already guarded.
5. **Keep going until a round changes nothing substantive.** Convergence = a full round (all four,
   full surface) that yields **zero CONFIRMED findings**. Clearing an anchor frees critics to find
   the next layer, so a clean round only counts *after* the last round that changed code.

## Anti-patterns — proven failure modes, do NOT do these

- ❌ **Diff-scoping a follow-up round** to "only what changed since last round." A narrow round
  confirms your fix while missing what the earlier anchors sat on top of. *(This exact shortcut let
  a blocking pre-parse import DoS and a wrong-degree quality score survive a "round 2" in an earlier
  session — both were caught only when the next round went full-surface.)*
- ❌ **Running fewer than four critics** — especially skipping `critic-solid` because "it's a small
  change."
- ❌ **Treating a round that CHANGED code as the clean round.** A substantive fix *resets* the
  clean-round counter; you owe at least one more full round that changes nothing.
- ❌ **Stopping on "diminishing returns," a fixed round count, or "the fix is trivial."** Run until a
  round is genuinely clean, not until you feel done.

## Convergence is computed, not judged

Run the committed runner instead of orchestrating rounds by hand — it enforces all-four +
full-surface + structured output and computes convergence:

```
Workflow({ name: "adversarial-review", args: "app/src (the BuddyGraph app)" })
```

It spawns the four critics full-surface in parallel, collects structured findings, and returns
`converged` (**true iff zero CONFIRMED findings**), the confirmed/blocking/plausible counts, and the
findings. Re-run it after each fix batch. **You are done only when a run made *after* your last code
change reports `converged: true`.**

## Structured findings

Each critic emits findings in a shared shape so rounds are diffable and convergence is
machine-detectable:

| field | meaning |
| --- | --- |
| `severity` | `blocking` \| `suggestion` |
| `verdict` | `CONFIRMED` (traced/reproduced) \| `PLAUSIBLE` (needs human adjudication) |
| `class` | kebab slug of the finding *type* — ratchet the class, not the instance |
| `file`, `line` | anchor |
| `summary` | one-sentence defect |
| `failure` | concrete input → wrong output / hang |
| `remediation` | the fix |
| `testUpgrade` | the parameterized/fuzz test that guards the *class* |

**CONFIRMED** findings block convergence. **PLAUSIBLE** findings are surfaced for adjudication (fix,
or justify why not) but don't by themselves keep the loop open — use judgment.

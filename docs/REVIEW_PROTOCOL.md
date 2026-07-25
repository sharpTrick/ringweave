# Adversarial review protocol

The single source of truth for the adversarial critic review gate, governing **both** the
`ringweave` core (`lib/`) and the BuddyGraph app (`app/`). `lib/CLAUDE.md` and `app/CLAUDE.md`
reference this file. They may add component-specific *lenses*; this file governs the *process*.

This protocol was revised after its first run was measured end-to-end
([`findings/critical-review/2026-07-24-ouroboros/`](./findings/critical-review/2026-07-24-ouroboros/)).
Where a rule below exists because of a specific measured failure, it says so — the evidence is the
point, not the authority.

## When it runs

Every non-trivial change gets an adversarial review before commit. "Non-trivial" is anything past a
typo or a one-line mechanical edit — new logic, a new module, a bug fix with reasoning, a refactor.

## The lint gate runs first

`npm run lint` at the repo root (oxlint + knip + `scripts/hygiene/`) must be **clean before any
critic is spawned**. This is not a formality: it is what makes the critics' scope exclusions fair.

The lint gate owns these classes outright, and a critic filing one is **out of scope**: stale
comments naming symbols that no longer exist, unused exports and parameters, dead CSS hooks, a bare
literal mirroring an exported constant, committed scratch files, and a11y defects where an attribute
is **present but wrong** (`aria-hidden` on something focusable, a bad `role`, a label pointing
nowhere).

**A *missing* accessible attribute is NOT owned by the linter and stays in scope** for
`critic-interaction`. A linter cannot flag an absence: nothing tells it a `<button>` is a toggle that
ought to expose `aria-pressed`. This was measured rather than assumed — a seeded `aria-pressed`
removal passed the full lint gate cleanly, and only the test suite caught it. An earlier version of
this section excluded "statically-detectable a11y defects" wholesale, which was too broad and would
have left that class watched by nobody. That is the failure mode scope exclusions must never create. In the measured run these were among the most-repeated finding labels, and a ~150 K-token
round spent noticing a stale comment is the failure that experiment documented.

The gate **self-tests**: `scripts/hygiene/oracle-check.mjs` asserts every rule and custom check
still fires against a deliberate violation. oxlint silently ignores unknown rule names, so a
renamed or mistyped rule is otherwise indistinguishable from a clean tree — and these classes are
exactly the ones nobody else is watching.

## The committed lenses

Five adversarial sub-agents live in `.claude/agents/`: `critic-correctness`, `critic-solid`,
`critic-security`, `critic-maintainability`, `critic-interaction`.

They run on **different models on purpose**. Personas layered on one backbone buy far less
independence than they appear to: prompt-persona diversity measures at roughly a fifth the
error-decorrelation of different backbone models, and homogeneous ensembles saturate around four
agents. Correctness and security run on `opus` (between them they caught 10 of the first run's 13
blocking findings); solid and interaction on `sonnet`; maintainability on `haiku`.

`critic-interaction` is a deliberate late addition. The *only* user-visible bug the first run's
entire nine-round tail produced was an accessibility gap, and it was found by luck rather than by
anyone looking.

Each lens declares a `surface` and a `saturation_gate` in its frontmatter. The executable copy of
that config lives in the runner, because a workflow cannot read the agent files; the hygiene gate
fails on any drift between the two.

## The loop (non-negotiable)

1. **Full-surface, every round.** Point each lens at the *whole component under review* (e.g. all
   of `app/src`), never a diff. Critics anchor on the first/biggest issue they see; a diff-scoped
   review hides everything the anchor is sitting on top of.
2. **All non-saturated lenses, every round, in parallel.** A lens is skipped only when it has been
   quiet for its full `saturation_gate` **and** no changed path touches its surface. Every skip is
   logged with its reason and returned in the result — a skipped lens is a visible decision, never
   a silent gap. Quiet alone is not enough: a lens going quiet is consistent with *that lens*
   saturating, not with the *surface* being clean.
3. **Verify each finding against the code before acting on it** — reproduce or trace it. Fix
   confirmed gating findings or justify them explicitly; log the rest.
4. **Ratchet the invariant, not the case.** Every gating finding carries a machine-checkable
   `invariant` — a property that must hold for *all* inputs — and that is what goes into the suite.
   A case table ("parameterize over n in [1,4,50]") is not an invariant: a fix written for those
   cases passes it by construction.
5. **Fix under `fix-finding`, review the fix under `fix-review`.** The fix side has its own
   discipline and its own failure modes; see `.claude/skills/`.
6. **Keep going until a round changes nothing substantive**, then run one more. Convergence is
   defined below.

## Convergence

**Zero CONFIRMED gating findings, in a round made after the last code change, with all
non-saturated lenses run — plus one confirming round.**

A finding is **gating** unless it is a `deferral` (an abstraction with no caller in the current
tree — a logged decision, not open work) or `caseOnly` (no invariant could be stated, so there is
nothing durable to ratchet). Both are recorded, neither blocks.

That exclusion is deliberate and it is a **trade**. In the measured run, convergence was gated by
the maintainability lens running out of nits rather than by the code becoming correct — and that
lens is non-convergent *by construction*, because functional defects have an oracle and preferences
do not. Independent studies of real review data put maintainability at 50–81% of all review
comments, so this is the norm, not a local quirk. The consequence, stated plainly: **real
maintainability issues can now survive convergence as logged, non-gating findings.** That is
accepted in exchange for a stopping rule that tracks correctness.

**Zero-confirmed is a grading threshold, not proof of absence.** The first run came one severity
call away from stopping five rounds early, and both of its converged rounds still surfaced a
plausible finding. The confirming second round — not the zero itself — is what supplies the
robustness. Keep it.

## Anti-patterns — proven failure modes, do NOT do these

- ❌ **Diff-scoping a follow-up round** to "only what changed since last round." *(This exact
  shortcut let a blocking pre-parse import DoS and a wrong-degree quality score survive a "round 2"
  in an earlier session — both were caught only when the next round went full-surface.)*
- ❌ **Skipping a lens that is not saturated**, especially because "it's a small change."
- ❌ **Treating a round that CHANGED code as the clean round.** A substantive fix *resets* the
  clean-round counter; you owe at least one more full round that changes nothing.
- ❌ **Stopping on "diminishing returns," a fixed round count, or "the fix is trivial."**
- ❌ **Fixing the reported case and calling the theme closed.** Name the sibling — the same concern
  one delimiter, one boundary, one code path over — before you commit. The two longest chains in
  the measured run were both siblings left open by the first fix.
- ❌ **Building an extension seam for a deferred feature.** No caller in the tree, no code. ~9
  findings over 6 rounds went into hardening a seam for a layout mode that was never built.
- ❌ **Treating agreement between lenses as corroboration.** It is duplication, and the triage phase
  exists to collapse it. Ten agents once unanimously endorsed a non-existent OpenSSL vulnerability
  that a single empirical test killed. Confirmation routes to the invariant, the linter, the test
  suite, or the recall harness — never to a show of hands.

## Convergence is computed, not judged

Run the committed runner instead of orchestrating rounds by hand — it enforces full-surface,
the non-saturated lens set, and structured output, and it computes convergence:

```
Workflow({ name: "adversarial-review", args: "app/src (the BuddyGraph app)" })
Workflow({ name: "adversarial-review",
           args: { target: "app/src", changedPaths: [...], saturation: {...}, round: 7 } })
```

The string form is the simple case. The object form enables saturation gating, which needs the
previous round's state and the paths that changed since it. Workflow scripts have **no filesystem
access**, so the runner cannot read or write `.claude/review-state.json` itself: the caller passes
`saturation` in and persists the `saturation` object the runner returns. **You are done only when a
run made *after* your last code change reports `converged: true`, and the round after it agrees.**

## Structured findings

| field | meaning |
| --- | --- |
| `severity` | `blocking` \| `suggestion` \| `deferral` |
| `verdict` | `CONFIRMED` (traced/reproduced) \| `PLAUSIBLE` (needs adjudication) |
| `class` | kebab slug of the finding type — **a filing label only** |
| `theme` | the underlying concern in plain language, stable across labels |
| `file`, `line` | anchor |
| `summary` | one-sentence defect |
| `failure` | concrete input → wrong output / hang |
| `remediation` | the fix, closing the **theme**, by subtraction where possible |
| `invariant` | a machine-checkable property that must hold for ALL inputs |
| `caseOnly` | true iff no invariant could be stated |

**Class vs theme** — the distinction is load-bearing. The first run's ratchet locked *cases*
perfectly (no ratcheted input ever re-broke across 18 rounds) but was a poor anti-*theme* barrier:
92 findings collapsed to ~12 themes, and 8 of those recurred under fresh class labels. One
behavioural concern wore 11 different labels. Fix the theme; `class` is only how it was filed.

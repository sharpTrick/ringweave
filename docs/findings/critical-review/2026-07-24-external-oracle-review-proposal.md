# Proposal — external oracles and subtractive fixes for the review loop

**Status:** proposal, not adopted. Nothing here is load-bearing until an experiment measures it.
**Baseline:** [`2026-07-24-ouroboros/`](./2026-07-24-ouroboros/) (call it **E1**).
**Reviewed:** stress-tested by three adversarial peer reviewers (empirical-validity,
engineering-realism, clarity). All three returned *stands-with-revisions*; their objections are
folded in below and the ones that killed a proposal are recorded in §6 so we don't re-propose them.

---

## 1. The problem

Both humans and LLM agents have blind spots when writing code, and both suffer self-approval bias:
a working solution is so much better than nothing that introduced bugs, over-complication, and
banked tech debt are hard to see. Review is the standard mitigation — a fresh, context-free
reviewer sees what the author cannot. But one review has blind spots too: it finds some issues and
leaves the rest.

**E1's approach:** iterate. Re-review the whole surface with fresh contexts each round, lock every
confirmed finding into a test, repeat until a round comes back clean.

**Why this document exists.** In a human-cost regime you stop at the knee of the value curve —
diminishing returns aren't worth reviewer salary. With cheap automated reviewers the target moves:
we should try to *move* the knee, get more out of each round, and stop the loop from creating its
own work. E1 measured what the loop actually did. This proposes what to change, and — more
importantly — how we would **know** whether the change helped.

## 2. What E1 showed (short version)

Full numbers and provenance in [`2026-07-24-ouroboros/README.md`](./2026-07-24-ouroboros/README.md).
The four results this proposal is built on:

1. **Cost per finding tripled while value went to zero.** Findings arrived at ~47 K tokens each
   through round 12 and ~143 K each after; the later rounds produced **no blocking findings** and
   one user-visible bug. Two halves of near-identical compute, opposite value.
2. **Most later findings targeted the loop's own output.** By hand-attribution, roughly two-thirds
   of post-baseline findings pointed at code, constants, comments, or abstractions the loop's own
   fixes had introduced — and rounds 13–16 were entirely that. (This number is a judgment call and
   §5 explains how to measure it honestly instead.)
3. **The ratchet locked instances, not themes.** No ratcheted input ever re-broke across 18 rounds
   — a real, durable win. But ~8 of ~12 *themes* resurfaced under fresh labels, because each fix
   closed the reported case and left the sibling case open.
4. **The instrument set decided the stopping point.** Correctness and security caught 10 of 13
   blocking findings and then went quiet — a finite surface, exhausted. Maintainability filed the
   plurality of findings, zero of them sole-source blocking, and never saturated. Convergence was
   gated by the non-saturating lens running out of nits, not by the code becoming correct.

**One vocabulary fix before going further,** because E1's write-up used one word two ways:

| term | granularity | example |
| --- | --- | --- |
| **case** | one concrete input | a name containing `\t` |
| **class** | the label a critic files under | `embedded-delimiter-formula-injection` |
| **theme** | the underlying concern, across labels | "untrusted names reach a spreadsheet sink" |

The ratchet locked **cases**. What recurred were **themes**. So the rule below is *fix the theme*,
and "class" is only ever a filing label from here on.

## 3. The organizing principle

Sorting E1's findings by which proposed fixes survived adversarial review produced one clean split:

> **Every robust proposal replaces agent judgment with an external oracle, or is strictly
> subtractive. Every fragile proposal asks an agent to grade its own work.**

| Robust — external oracle or subtractive | Fragile — agent judges itself |
| --- | --- |
| a linter (fixed rules, no opinion) | "did my fix satisfy its own test-upgrade?" |
| a mutation corpus (known defects) | "is this abstraction speculative?" |
| a coverage map (measured, not guessed) | "is this finding important?" |
| "does this symbol have a caller?" (mechanical) | a critic reviewing another critic's fix |
| retiring a lens (removes work, can't add bugs) | a fix-review pass that proposes new work |

This is not a stylistic preference. E1's failure mode *was* self-reference — the loop consuming its
own output — and a fix that reintroduces self-reference one level down inherits the same failure.
Two of my three original Lever-1 gates did exactly that; the reviewers caught it (§6).

## 4. Two levers

E1's original write-up proposed three levers. The clarity reviewer showed two of them act on the
same findings at different times ("don't create junk" and "triage junk out" are one move — shrink
the junk denominator), so there are two:

### Lever A — Shrink the junk denominator

Most of what the loop found late was not defect signal. Reduce it at the source, mechanically.

- **A1 · Hygiene is a linter, not a critic.** Stale comments, unused exports, dead CSS hooks,
  magic numbers mirroring a constant — E1's recurring labels are precisely the lintable ones. A
  linter is a fixed external oracle with no self-grading problem. Move these off the critics' plate
  entirely; a critic that files a lint-class finding is out of scope.
- **A2 · Dedup by theme before fixing.** E1 round 4 had **four critics independently report one
  root cause**; it was fixed once but reported (and reasoned about) four times. Cluster findings by
  theme first, fix once per theme. Mechanical, no risk, best-supported proposal in the set.
- **A3 · Retire saturated lenses.** Security returned "nothing found" for nine consecutive rounds
  and its one late finding was a nitpick on code another critic had just flagged. Gate a lens on
  whether the diff touched its surface. Purely subtractive: it can remove cost, never add a bug.
- **A4 · Fix the theme, by subtraction.** A fix must close the theme, not the case — but *only* by
  removing a code path, tightening a boundary check, or unifying two call sites. **Never by adding
  an abstraction.** This precedence rule is load-bearing: without it "fix the theme" (broad diffs)
  and "don't over-build" (small diffs) contradict each other, and an agent can claim compliance
  either way.
- **A5 · Deferred features get deferrals, not seams.** E1 spent ~9 findings over 6 rounds
  hardening an extension seam for a layout mode that was never built. The test is **mechanical, not
  a judgment**: does a caller exist in the current tree? If no, the finding is filed as a deferral
  and not built.

### Lever B — Find what the prose critics can't

Four prose critics re-run 18 times share blind spots and saturate. Moving the knee means adding
instruments that fail *differently* — and being able to prove they did.

- **B1 · A ground-truth corpus (this is the keystone).** Without known defects, "we found more
  bugs" is unfalsifiable — every outcome has two readings. Seed known defects (mutation testing
  over `lib/` + `app/src`, plus a small hand-authored injected-bug set for defect classes mutation
  operators don't produce, e.g. a stale React effect dep) and score every configuration on
  **recall** (found / seeded) **and the round at which each was found.** This converts "did the
  knee move?" from a vibe into a curve. It is also the only way to detect the loop's true blind
  spots: a seeded defect that survives to convergence is a blind spot, by definition.
- **B2 · Property/invariant tests over input surfaces, aimed blind.** Not "fuzz import and reroll"
  — knowing those were the surfaces is hindsight, and E1's blocking findings actually spanned eight
  files. Aim by **measured coverage**: fuzz what a coverage map says is under-exercised. Then B1
  scores whether that beat the prose critics.
- **B3 · Specialist lens rotation.** Swap a saturated lens for a fresh dimension (error paths,
  focus order, reduced motion, races) rather than asking correctness for a fifteenth opinion.
- **B4 · Live-browser auditing — gated, not adopted.** Interaction/a11y/perf on the running app is
  a genuine uncovered dimension (E1's only late user-visible bug was an a11y gap it found by luck).
  But it is also the highest-variance instrument available, and E1's single late "blocking" finding
  was itself a flaky test. **Do not build this until B2 has shown, against B1, that new instruments
  move recall at all.**

## 5. Low-level changes

Concrete edits, so this is reviewable as an implementation rather than a direction.

### 5.1 `.claude/agents/critic-*.md` — four edits, applied to all four critics

**(a) Frontmatter: declare the lens's surface** so the runner can gate it (A3). Add one field;
existing fields unchanged.

```yaml
# .claude/agents/critic-security.md
---
name: critic-security
description: Adversarial robustness/DoS reviewer ...
tools: Read, Grep, Glob, Bash
model: opus
effort: medium
surface: ["**/io/**", "**/worker/**", "**/*parse*", "**/*import*", "**/*download*"]
saturation_gate: 2   # skip after N consecutive nothingFound rounds unless surface globs changed
---
```

**(b) Body: replace the `test-upgrade` instruction with an invariant requirement.** This is the
tautology fix. E1's `testUpgrade` fields were *input tables the same author already imagined*
("parameterize over {edges:[] with n in [1,4,50]}, {two disjoint components}…"), so a fix written
for disconnected graphs passes a test written for disconnected graphs by construction.

> **Remove:** "For `test-upgrade`, don't just give the one failing input — name the *class* it
> belongs to and how to cover it durably: a parameterized (table-driven) case or a widened
> property-test generator…"
>
> **Replace with:** "For `invariant`, state a **machine-checkable property that must hold for all
> inputs**, not a list of inputs to try. Good: `quality === 0 whenever aspl === null`; `for every
> exported name, some other file references it`; `no cell reaching a spreadsheet sink begins with
> =,+,-,@ after any embedded delimiter split`. Bad: 'parameterize over n in [1,4,50]' — that is a
> case table and a fix written for those cases passes it by construction. If you cannot state an
> invariant, say so; a finding without one is a case, and case-only findings are filed but do not
> gate convergence."

**(c) Body: add the two scope exclusions** (A1, A5), verbatim in each critic:

> "**Out of scope — do not file these.** (1) *Lint classes*: stale comments, unused exports/params,
> dead CSS hooks, a constant mirroring another constant, committed scratch files. These are covered
> by the hygiene linter; filing them wastes a round. (2) *Seams for unbuilt features*: if a
> proposed abstraction has **no caller in the current tree**, file it with `severity: deferral`,
> never `blocking`/`suggestion`. Extensibility for a feature that does not exist cannot be
> validated and did not, in the one run we measured, ever pay."

**(d) Body: require the theme.** Add: "Name the `theme` — the underlying concern in plain language,
stable across labels ('untrusted names reach a spreadsheet sink'). Two critics reporting one theme
must be fixed once; the runner clusters on this field."

### 5.2 `.claude/workflows/adversarial-review.js` — schema, triage phase, gating

**Schema** (add three fields, extend one enum):

```js
severity: { enum: ['blocking', 'suggestion', 'deferral'] },   // + deferral (A5)
theme:     { type: 'string', description: 'plain-language concern, stable across labels' },
invariant: { type: 'string', description: 'machine-checkable property that must hold for ALL inputs' },
caseOnly:  { type: 'boolean', description: 'true if no invariant could be stated' },
```
`required` becomes `['severity','verdict','class','theme','file','summary','failure','remediation']`
— `invariant` required unless `caseOnly` is true.

**A triage phase between review and return** (A2). Findings currently flow straight out; add one
clustering agent so duplicates are collapsed *before* anyone fixes them:

```js
phase('Triage')
const clustered = all.length < 2 ? { themes: all.map(f => ({ theme: f.theme, findings: [f] })) }
  : await agent(
      `Cluster these findings by THEME (underlying concern), not by class label. Findings that share
       a root cause must land in one cluster even when labels and files differ. For each cluster:
       theme, the findings in it, the single highest severity, and ONE remediation that closes the
       theme by subtraction (remove a path / tighten a boundary / unify call sites) — never by adding
       an abstraction. Return only the clustering; do not invent findings.`,
      { label: 'triage:theme-dedup', phase: 'Triage', schema: CLUSTER_SCHEMA },
    )
```
Return `{ ...counts, themes: clustered.themes, themeCount }`. **Convergence math changes to ignore
deferrals:** `confirmed.filter(f => f.severity !== 'deferral')` — a deferral is a logged decision,
not open work.

**Saturation gating** (A3), driven by a small run-history file the workflow reads and writes:

```js
// .claude/review-state.json  — { "critic-security": { nothingFoundStreak: 9, lastRound: 21 }, ... }
const state = readState()                       // {} on first run
const changed = args.changedPaths ?? []         // caller passes `git diff --name-only <last-round>`
const active = CRITICS.filter((c) => {
  const s = state[c.type]?.nothingFoundStreak ?? 0
  if (s < (c.saturationGate ?? 2)) return true
  const touched = changed.some((p) => c.surface.some((g) => minimatch(p, g)))
  if (!touched) log(`skipping ${c.type} — saturated (${s} quiet rounds), surface untouched`)
  return touched
})
```
Every skip is logged in the result, so a skipped lens is a visible decision, never a silent gap.

### 5.3 New: `.claude/workflows/mutation-recall.js` — the ground-truth harness (B1)

The keystone. Scores a review configuration against **seeded** defects so recall is measurable.

```js
export const meta = {
  name: 'mutation-recall',
  description: 'Score a review configuration on recall against a seeded-defect corpus.',
  phases: [{ title: 'Seed' }, { title: 'Review' }, { title: 'Score' }],
}
// args: { target, seeds: [{id, file, patch, class, note}], config: 'baseline'|'proposed' }

phase('Seed')
// Apply each seed patch on its own git worktree (isolation:'worktree'), one defect per worktree,
// so seeds can never interact and a failed run can't corrupt the tree.

phase('Review')
const runs = await pipeline(args.seeds,
  (s) => workflow('adversarial-review', { target: args.target, seedId: s.id }),
  (r, s) => ({ seed: s, found: r.themes.some(t => matchesSeed(t, s)), round: r.roundFound ?? null }),
)

phase('Score')
return {
  recall: runs.filter(r => r.found).length / runs.length,
  byClass: groupRecall(runs),                       // which defect classes the ensemble is blind to
  roundHistogram: runs.map(r => r.round),           // ← the knee, measured
  blindSpots: runs.filter(r => !r.found).map(r => r.seed),   // survived to convergence = blind spot
}
```

`matchesSeed` must be **mechanical** (does the reported `file` + `theme` overlap the seed's known
location and class?) — not an agent judging whether a finding "counts," which would put
self-grading back at the center.

### 5.4 New skills — the fix side of the loop

E1 had no skill governing *fixing*; the discipline lived in my head, which is exactly where it
failed. Two new skills, both invoked by the agent applying fixes.

**`.claude/skills/fix-finding/SKILL.md`**

```yaml
---
name: fix-finding
description: Apply a confirmed review finding without creating the next one. Use when fixing any
  finding from the adversarial-review workflow. Enforces invariant-first, subtraction-only,
  and the mechanical YAGNI test.
---
```
Body, in order:
1. **Invariant first.** Write the failing invariant test *before* the fix, from the finding's
   `invariant` field. If the finding is `caseOnly`, derive an invariant or say why none exists.
2. **Author it from the finding, not the fix.** The test must be derivable from the finding text
   alone. If it only passes because of how you chose to fix it, it is a case-lock, not a guard.
3. **Subtraction precedence** (A4): prefer, in order — delete a path; tighten a boundary check;
   unify two call sites; *then* add code. Adding an abstraction requires an existing caller.
4. **Mechanical YAGNI** (A5): before adding any seam, run the caller test (`grep` for a live
   reference). No caller → deferral, recorded in the component's `CLAUDE.md` known-follow-ons.
5. **Close the theme, not the case.** Ask explicitly: what is the *sibling* of this input — the
   same concern one delimiter, one boundary, one code path over? E1's two longest chains
   (`csv-formula-injection` → embedded-delimiter; reroll `n>120` → small-`n`) were both siblings
   left open by the first fix.
6. **Leave no residue.** A fix that falsifies a comment, orphans an export, or strands a constant
   must clean up in the same commit — E1's entire hygiene theme was fix residue.

**`.claude/skills/fix-review/SKILL.md`** — strictly subtractive, and that constraint *is* the
skill. A fix-review that may propose new work is just another review round with the same
self-induction risk.

```yaml
---
name: fix-review
description: Subtractive-only pre-commit check on a fix diff. Use after applying review fixes,
  before committing. May only shrink, revert, or add a guard test — never propose new features
  or abstractions.
---
```
Body: **allowed verdicts are exactly three** — `revert` (the fix is wrong or unnecessary), `shrink`
(same behavior, less surface: delete the abstraction, inline the indirection, drop the unused
parameter), `add-guard-test` (the invariant is missing or weaker than the finding). Anything of the
form *"also handle X"* or *"while you're here"* is **out of scope by construction** — file it as a
new finding for the next full round instead, where it competes with everything else on value.
Report `{verdict, target, why}` and nothing else.

### 5.5 `docs/REVIEW_PROTOCOL.md` — amendments

- **Convergence** becomes: zero CONFIRMED non-deferral findings, in a round after the last code
  change, **with all non-saturated lenses run**. Deferrals and case-only findings are logged, not
  gating.
- **New anti-pattern:** ❌ *Fixing the reported case and calling the theme closed.* Name the
  sibling before you commit.
- **New anti-pattern:** ❌ *Building an extension seam for a deferred feature.* No caller, no code.
- **Amend** "all four, every round" → "all **non-saturated** lenses, every round; a skip is logged
  with its reason." (E1's evidence: nine rounds of a saturated lens produced one manufactured
  finding.)
- **Add a stopping caveat:** zero-confirmed is a grading threshold, not proof of absence. E1 came
  one severity call away from stopping five rounds early; keep the confirming second round.

## 6. What the reviewers killed (do not re-propose)

Recorded so these don't come back as fresh ideas:

- **"A fix is done when it satisfies its own `testUpgrade`."** Tautological — the test and the fix
  come from the same author's imagination. Survives only as §5.1(b) + `fix-finding` step 2:
  invariants, derivable from the finding, not case tables.
- **"Adversarial fix-review" as a general review pass.** It generates findings → fixes → diffs:
  the loop one level down, with the same self-approval bias the whole exercise is about. Survives
  only as the three-verdict subtractive form in §5.4.
- **"Fuzz the two surfaces where the value was."** Hindsight, and factually wrong for E1 — the 13
  blocking findings spanned eight files, so import+reroll fuzzing would have missed two
  main-thread freezes and an async race. Replaced by coverage-aimed targeting (B2).
- **A live-browser auditor as an adopted improvement.** Highest-variance instrument, thin bounded
  yield on a small offline app, and the one class of finding that already backfired in E1 was a
  flaky test. Gated behind B1 evidence (B4).
- **"Three levers."** Two of them acted on the same findings at different times. Now two.

## 7. Experiments, with success criteria

Each states in advance what would count as failure, because E1's lesson is that an unfalsifiable
success metric will happily run for nine rounds.

| | **E2 · Fix hygiene** | **E3 · Recall harness** | **E4 · Lean ensemble** |
| --- | --- | --- | --- |
| **Tests** | Lever A4/A5 + the two fix skills | Lever B1/B2 — the keystone | Lever A1/A2/A3 |
| **Change** | `fix-finding`, `fix-review`, critic scope exclusions | `mutation-recall.js` + coverage-aimed property tests | hygiene linter, triage phase, saturation gating |
| **Primary metric** | self-induced findings, **blind-coded** by an agent that did not see the fixes | **recall** on the seeded corpus + round-at-discovery | tokens per non-deferral confirmed finding |
| **Pre-registered success** | injected-defect rate (not incomplete-fix rate) falls by ≥½ vs E1, with no loss of recall on E3's corpus | ≥1 seeded defect class found by property tests that the prose ensemble missed | ≥40% token reduction with **zero** loss of E3-corpus recall |
| **Counts as failure** | fewer findings but recall drops — we optimized the metric, not the code | prose critics match or beat the new instruments on every class | any dropped seeded defect |
| **Confound to control** | same agent fixes and grades → **blind-code the labels** | app has too few real defects → seeds supply the denominator | lint reclassification shortens rounds mechanically → hold lens set fixed |

**Order matters: E3 first.** E2 and E4 both claim "no loss of recall," which is unmeasurable until
the corpus exists. Building the measuring stick before the improvements is the one sequencing
decision in this document I'd defend hardest — E1's whole failure was optimizing a number that had
quietly stopped tracking value.

## 8. What would change our mind

- **E1 is N=1, on one small offline client-side app with ~6 real defects.** The security lens's
  early saturation is partly a property of that surface; an app with a genuine auth/network surface
  might keep the diagnostic lenses productive far longer and move the knee without any of this.
- **The two-regime split is partly definitional.** The boundary was drawn at the last blocking
  finding, so "the tail had zero blocking findings" is true by construction. The cost curve
  (~47 K → ~143 K tokens per finding) is the real observation; treat it as a continuous decay, not
  two tidy halves. E1's write-up now says so.
- **Self-induction conflates two things** — a fix that *injected* a new defect versus a fix that
  was *incomplete* and got hardened later. Only the first is waste; the second is progress. The
  reported ~two-thirds mixes them, which inflates the motivation for Lever A. E3's blind-coded
  split is the honest number, and it will probably be well below two-thirds.
- **If recall is already ~100% at the E1 knee**, then there is no `n − m` to find on this codebase,
  Lever B is unfalsifiable here, and the right conclusion is "stop at the knee after all" — the
  human-cost answer, reached for a different reason. That outcome would be a real result, not a
  failed experiment.

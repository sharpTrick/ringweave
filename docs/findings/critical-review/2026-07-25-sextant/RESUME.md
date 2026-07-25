# Resume notes — Sextant, Part 3 in flight

Written at 97% usage with a scoring run live, so that whoever picks this up (possibly a fresh
context) does not have to reconstruct state. Delete this file when Part 3 is scored and written up.

## Where things stand

Committed and pushed on `claude/m3-review-process-ykgoe2`; lint gate and both suites green.

- **Part 1 complete.** Hygiene linter (oxlint + knip + 3 self-testing custom checks), five
  model-diverse critics, reformed runner, the two fix skills, the recall harness, protocol sync.
- **Part 1.6 measured.** E1 self-induction **68%** of classifiable findings vs a **20%** chance base
  rate ⇒ **3.37× lift** (`data/e1-self-induction.json`); fix-churn **23.0%** (`data/e1-fix-churn.json`).
- **Part 3 corpus built and allocated pre-run.** 5 critic seeds, 2 oracle probes, 4 controls
  (`data/admission.json`, `data/allocation.json`). 7 candidates rejected because the existing suite
  already catches them; 1 because its line has no coverage.
- **Part 3 scoring: IN FLIGHT.** Model-diverse run over 5 seeds + 4 controls.
- **Parts 2 (M3) and 4 (review loop + E2/E4): not started.**

## The run in flight

```
Run ID:     wf_09929847-e79
scriptPath: /home/user/ringweave/.claude/workflows/mutation-recall.js
```

**If it completed:** its return value has `recall.{strict,loose}`, `byStratum`, `leaveOneOut`,
`blindSpots`, `controls`, `perSeed`. Save it to `data/recall-diverse.json` and fill in §4 of
`README.md`, which currently says the run is in progress.

**If it was cut off:**

```
Workflow({ scriptPath: "/home/user/ringweave/.claude/workflows/mutation-recall.js",
           resumeFromRunId: "wf_09929847-e79", args: <same args> })
```

Completed agents return cached results, so only the unfinished rounds re-run. **Before diagnosing an
empty or odd result, read `journal.jsonl` in the transcript dir** — it records each agent's actual
return value. Transcripts:
`/root/.claude/projects/-home-user-ringweave/*/subagents/workflows/wf_09929847-e79`

**The args are regenerable** — do not retype them:

```bash
node -e 'const a=require("./docs/findings/critical-review/2026-07-25-sextant/data/allocation.json");
console.log(JSON.stringify({config:"proposed-model-diverse",
  seeds:a.proseSubset.map(s=>({id:s.id,worktree:s.reviewTarget,file:s.file,line:s.line,stratum:s.stratum,class:s.class,theme:s.theme})),
  controls:a.controls.map(c=>({id:c.id,worktree:c.reviewTarget}))}))'
```

Pass that as an **actual JSON object**, not a string — passing a string is what killed the first
launch (the script now tolerates it, but don't).

## Container restart, 2026-07-25 — what actually survived

A restart happened mid-run. Recorded because the answer was better than the warning below suggested,
and the next person should not rebuild unnecessarily:

- `.sextant-worktrees/` **survived**, with seeds still applied and the `node_modules`/`lib/dist`
  symlinks intact. Verified by re-reading two seeded lines, not by assuming.
- `node_modules` in all three packages and `lib/dist` **survived**.
- The workflow's **resume cache survived** — it lives in `journal.jsonl` under the transcript dir in
  `/root/.claude/projects/`, not in the repo. 55 non-null agent results were still cached, which is
  most of a 9-round run (~6 agents per round).
- Only the *running processes* were killed.

So after a restart: **check before rebuilding.** `ls .sextant-worktrees/ | wc -l` and a `sed -n` on a
seeded line answer it in one command, versus ~15 minutes to rebuild.

## Also fixed since: a dead lens read as a clean one

The first scoring run lost 33 of 49 agents to a session limit and *still reported* `recall 0.8` and a
blind spot. `agent()` **returns null** on a terminal API error rather than throwing, so the runner's
`.catch` never fired and `(r && r.findings) || []` recorded each dead lens as
`findings: 0, nothingFound: false, errored: undefined` — which let a round in which every lens died
report `converged: true`. Now: null or malformed ⇒ `errored: true` with a reason, and
`mutation-recall` excludes any round containing a dead lens from the denominator. The void output is
kept as `data/VOID-recall-diverse-contaminated.json`. **Quote nothing from it.**

## If the worktrees ARE gone

`.sextant-worktrees/` is gitignored and lives only on this container's disk. If the container was
reclaimed, **every review target no longer exists** and a resume would review nothing. Check first:

```bash
ls .sextant-worktrees/ | wc -l      # expect 19
```

If missing or short, rebuild (~15 min) — it is deterministic from committed definitions:

```bash
node scripts/sextant/forge.mjs --build
node scripts/sextant/allocate.mjs
```

Rebuilding changes nothing about the corpus: `seed-defs.json` and the allocation rule are committed,
slots are assigned deterministically by index, and the gates are re-verified. Do **not** re-run
`--check` expecting the same slot numbering if `seed-defs.json` has been edited.

## Next steps, in order

1. **Score the homogeneous paired arm** — 3 seeds, all-opus, the pre-registered comparison that
   isolates model diversity from lens count. Same script, `modelOverride: "opus"`, no controls:
   ```bash
   node -e 'const a=require("./docs/findings/critical-review/2026-07-25-sextant/data/allocation.json");
   console.log(JSON.stringify({config:"baseline-all-opus",modelOverride:"opus",
     seeds:a.homogeneousArm.map(s=>({id:s.id,worktree:s.reviewTarget,file:s.file,line:s.line,stratum:s.stratum,class:s.class,theme:s.theme}))}))'
   ```
   Save to `data/recall-homogeneous.json`.
2. **Write up §4 of `README.md`** against the pre-registered criteria in `PRE-REGISTRATION.md`,
   including where they **failed**. The a11y probe already failed one and it is recorded.
3. **`node scripts/sextant/forge.mjs --clean`** once scoring is done — 19 worktrees are disk-heavy,
   and writable disk here is a fixed allowance.
4. **Part 2 (M3)**, starting at F7a. Read the two reconciliation blocks in the plan file first: the
   design was revised twice and several of its original decisions were reversed (no Python mirror, no
   focus/ego layout, `validateDetailed` instead of string rewriting, no `edgeKeys`, no
   `eccentricities`).
5. **Part 4**, then the findings doc, then the PR — PR only after convergence.

## Things not to re-derive

- `main` is squash-merged; the blame oracle must run against `claude/m2-xapjhu`. Tag push is blocked
  by the proxy (403); the commit manifest at `data/e1-commits.json` is the durable record.
- Workflow scripts have **no filesystem access** — the caller owns `review-state.json` and the
  worktrees.
- The workflow registry is snapshotted at session start, so a newly-added workflow must be invoked by
  `scriptPath`, not by `name`.
- `round-log.mjs` and `lever-a-savings.mjs` are **deliberately deferred** to Part 4, where their
  callers appear. That is the plan's own no-caller-means-deferral rule applied to itself.

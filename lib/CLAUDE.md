# ringweave core — working notes

Scope: the zero-dependency algorithm library in `lib/`. App conventions come later (M2).

Durable knowledge lives in **`../docs/findings/`** — research findings, cost models, and
hard-won lessons (the *why* behind decisions, with evidence). When a review or an
experiment teaches you something a future contributor should be able to trust and act on,
write it there, not only in a commit message. The *known limitations* below are the
lib-local, live version of that; the findings directory is where the reasoning and
measurements are recorded in full.

## Commands (run from `lib/`)

- `npm install` — deps (dev-only; the shipped core has no runtime deps)
- `npm test` — vitest; **must stay green** before any commit
- `npm run typecheck` — `tsc --noEmit`; must be clean
- `npm run build` — emit `dist/`

Fixtures/oracle workflow (from `reference-python/`): `python3 test_core.py`, then
`python3 gen_fixtures.py` to regenerate `test/fixtures/reference.json`.

## Architecture (respect)

- `lib/` is a **zero-runtime-dependency, framework-agnostic** core. It never adds runtime deps and
  never reaches into UI. The UI (future `app/`) consumes this library and never reimplements math.
- `reference-python/` is the **spec + oracle**. Core algorithms are validated against it on
  invariants and aggregate metrics (ASPL, diameter, degree spread), **not** byte-for-byte edges.
  If you change an algorithm, change the Python first, regenerate fixtures, then mirror the intent.
- **Determinism is a contract:** same inputs + settings ⇒ same output. Generators (`ringGreedy`,
  `repairDegrees`, `constrainedGreedy`) are RNG-free; polish uses the seeded `RNG` only. Never
  introduce `Math.random` or `Date.now` into the core.
- **Hard vs soft constraints:** required/prohibited are guaranteed by construction; priors are a
  soft polish penalty unless `Constraints.priorHard` promotes them to required. `validate` refuses
  genuinely-impossible inputs up front with plain-language reasons.

## Quality bar (tuned to this codebase — not applied dogmatically)

- **SOLID, scoped:** single-responsibility modules. The genuine open/closed seam is the tag policy
  in `constraints.ts` — add a `case`, don't edit callers. The edge-legality predicate (`legalEdge`)
  and polish objective (`constrainedMeasure`) are isolated as single-responsibility factory
  functions, so a new *tag policy* or *objective term* touches one function, not the greedy/polish
  loops; they are deliberately **not** caller-injectable (an arbitrary predicate/objective would
  undercut the determinism contract and the hard-constraint postconditions). (A genuinely new hard
  constraint *category* — one not reducible to required/prohibited pairs — is the exception: it must
  be kept in sync across `legalEdge`, `swapBreaksConstraint`, `assertHardConstraints`, and
  `buildReport`, as their comments note.) Do not force LSP/ISP or wrap free functions in classes for
  OO's sake.
- **Vocabulary:** core terms — `Graph`, `adj`, `degree`, `aspl`, `mind` (min separation; mirrors the
  Python kwarg). The constrained path's public option spells the same concept `minSeparation`; they
  are aliases, not different knobs.
- **Clean Code:** clear names, DRY, small public API. Code is self-documenting — the *what* is
  evident without comments; add a short comment only when the *why* is non-obvious. Prefer small
  extracted functions, but a hot loop may stay un-extracted when decomposition costs measurable
  performance — that is the only accepted reason not to extract.
- **YAGNI/KISS:** design patterns only at real ≥2-variant decision points; simplest correct form
  everywhere else.
- **Design by Contract:** dev-mode postcondition assertions back the hard-constraint guarantees
  (compiled out of production bundles where `process` is absent).
- **Functional core / imperative shell:** prefer pure functions over `Graph`; keep mutation local.
- **Tests:** every core change keeps `test/identity.test.ts` (regression oracle) green, and new
  algorithm code earns property-based invariants (`test/*.props.test.ts`) plus oracle-parity checks.

## Known limitations / tracked follow-ons

Surfaced by review, deliberately deferred (not silently ignored):
- **Generation cost scales as n²·min(k,n-1):** `constrainedGreedy` runs one BFS (~O(n)) per edge
  added and adds ~n·min(k,n-1)/2 edges (n=500,k=4 ≈ 120 ms; n=5000,k=4 ≈ 13 s; the dense corner
  n=500,k=499 ≈ 89 s). Two caps bound it, both in `graph.ts` and enforced as a refusal in `validate`
  + a throw in `constrainedGreedy`: `MAX_CONSTRAINED_N` (5000) bounds the n-only costs (the O(n²)
  baseline and validate's prohibited-pair connectivity walk); `MAX_CONSTRAINED_WORK` (1e8, compared
  against `constrainedWork(n,k)`) bounds the dense-k blow-up the n-cap misses. Wall-clock tracks
  n²·min(k,n-1) at ~7.5M units/s sparse, ~2.2M/s near-complete; the budget holds worst-case
  generation to ~13 s (sparse, n=5000,k=4) / ~46 s (deepest allowed corner n≈464,k=n-1). Lifting
  either needs an incremental single-source distance scheme (a follow-on) — lighter than
  `ringGreedy`'s all-pairs cache.
- **`fromTags` on a dominant tag** materializes O(n²) prohibited pairs — a degenerate imported tag
  column (thousands sharing one label) is slow/heap-heavy, and at tens of millions of pairs the
  `Set` construction itself throws before `validate` can refuse it. A `NaN` tag value never groups
  (`NaN !== NaN`), silently inverting `prohibit_same`. Sanitize + size-check tags when F6 lands.
- **Polish is O(n·m) per iteration** — `polish`/`polishConstrained` recompute the full all-pairs
  summary every swap, so they are impractical much past a few hundred vertices (why auto-polish is
  capped at n≤120 in `index.ts`). Needs incremental/sampled energy for larger n.
- **`girth` (and the other exported all-pairs metrics) are O(n²)** and uncapped — deliberately, since
  they are pure diagnostics run on a `Graph` the caller already built (n bounded by `MAX_ROSTER`), not
  generation entry points fed untrusted `(n,k,constraints)`. The generators that *are* the untrusted
  surface are capped (`MAX_CACHED_N`, `MAX_CONSTRAINED_N`, `MAX_CONSTRAINED_WORK`). `girth`'s only
  internal call is in `buildBuddyGraph` on the `ringGreedy` output (bounded by `MAX_CACHED_N`); the
  constrained path deliberately omits `girth`. Documented, not guarded, to avoid a contract change on
  every metric.
- **`aspl`/`girth` are `Infinity`** for n≤1 (no reachable pairs); `JSON.stringify` turns that into
  `null`. Normalize or special-case at the export boundary (F6).
- **`k ≥ n` is silently capped** at n-1 (feasible, no error). A soft "capped" note could help UX.

## Review (required before commit)

Non-trivial changes get **adversarial sub-agent review** using the committed critics in
`.claude/agents/` (correctness, SOLID, security, maintainability). The critics default to skepticism
and try to break the change.

**The authoritative, repo-wide process is [`../docs/REVIEW_PROTOCOL.md`](../docs/REVIEW_PROTOCOL.md)**
— full-surface every round, all four critics in parallel, verify each finding, ratchet the *class*
into the suite, and run until a round changes nothing substantive. Do not orchestrate rounds by
hand; run the committed runner, which enforces that and computes convergence:

```
Workflow({ name: "adversarial-review", args: "lib/src (the ringweave core)" })
```

Lib-specific lens the critics apply on top of that process:
- **Determinism** is a hard contract (RNG-free generators; seeded polish only) — any nondeterminism
  is a finding.
- **Oracle parity:** metrics must match `reference-python/`; regenerate fixtures
  (`python3 gen_fixtures.py`) if an algorithm changed, and keep `test/identity.test.ts` green.
- **Ratchet into property tests / oracle-parity checks**, and keep `npm test` green at the end of
  every round.

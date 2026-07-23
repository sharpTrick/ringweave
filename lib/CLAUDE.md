# ringweave core — working notes

Scope: the zero-dependency algorithm library in `lib/`. App conventions come later (M2).

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
- **Generation scales ~O(n²) even at small k:** `constrainedGreedy` runs one BFS per edge added,
  so cost grows quadratically in n regardless of k (n=500,k=4 ≈ 120 ms — within the n≤500 product
  target; n=4000 ≈ 7–13 s), and worse as k approaches n. The whole constrained path is now capped
  at `MAX_CONSTRAINED_N` (5000, in `graph.ts`) — enforced as a refusal in `validate` and a throw in
  `constrainedGreedy` — so a legal-but-huge roster is refused, not left to hang; raising that ceiling
  needs an incremental distance scheme first (a tracked follow-on). The constrained path only ever
  needs single-source distances, so it wants a lighter scheme than `ringGreedy`'s full all-pairs cache.
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
  surface are capped (`MAX_CACHED_N`, `MAX_CONSTRAINED_N`); `girth`'s sole internal use is on those
  already-bounded outputs. Documented, not guarded, to avoid a contract change on every metric.
- **`aspl`/`girth` are `Infinity`** for n≤1 (no reachable pairs); `JSON.stringify` turns that into
  `null`. Normalize or special-case at the export boundary (F6).
- **`k ≥ n` is silently capped** at n-1 (feasible, no error). A soft "capped" note could help UX.
- **Connected-fraction metric** (`largestComponentFraction`) is not implemented — the M2
  churn-resilience report will want it; it's a one-liner over `connectedComponents` (add with a test).

## Review (required before commit)

Non-trivial changes get **adversarial sub-agent review** using the committed critics in
`.claude/agents/` (correctness, SOLID, maintainability, security). The critics default to
skepticism and try to break the change.

Protocol (learned the hard way):
- **Unfocused, full-surface, every round.** Point critics at the whole component under review, not
  a diff. Critics anchor on the first/biggest issue they see; a diff-scoped review hides everything
  the anchor is sitting on top of.
- **Run all four critics each round**, in parallel. They run on `model: opus` at `effort: medium`
  (set in each `.claude/agents/critic-*.md` frontmatter) — a deliberate cost/thoroughness balance;
  raise a critic's effort in its frontmatter for a deeper pass when a change warrants it.
- **Verify each finding against the code before acting on it** — reproduce or trace it — to filter
  false positives (LLM negation-blindness). Fix confirmed blocking findings or justify them
  explicitly; log suggestions.
- **Keep going, round after round, until either the critics give a unanimous green light or it is
  clear they would give contradictory suggestions next round** — in which case use judgment and
  adjudicate. Do not stop at a fixed round count: clearing the anchor frees critics to find the
  next layer, so a clean round only counts after a round that changed nothing substantive.
- **Ratchet every confirmed finding into the suite before closing it.** Review is expensive,
  non-deterministic discovery; tests are cheap, deterministic regression — a class caught once
  should never need re-discovering. Codify the *class*, not the one input: prefer widening a
  property-test generator or adding a parameterized (table-driven) case over a bespoke `it()`, so
  the test also guards inputs the critic didn't try. Fight sprawl by consolidating near-duplicate
  cases into tables and widening generators — not by testing less; a parameterized suite is cheaper
  to read than a pile of examples. The payoff compounds: as the suite hardens, later rounds
  converge faster because the critics stop tripping over already-guarded ground.
- Keep tests green at the end of every round.

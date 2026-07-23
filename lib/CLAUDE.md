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
  and polish objective (`constrainedEnergy`) are isolated as single-responsibility factory
  functions, so changing a rule touches one function, not the greedy/polish loops; they are
  deliberately **not** caller-injectable (an arbitrary predicate/objective would undercut the
  determinism contract and the hard-constraint postconditions). Do not force LSP/ISP or wrap free
  functions in classes for OO's sake.
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
- **Large-k performance:** `constrainedGreedy` runs one BFS per edge added, so `k` near `n` (a
  near-complete graph) is O(n³)-ish — n=500,k=250 ≈ 15 s. Realistic buddy counts (k≈4) are fast.
  The fix is the incremental-distance cache already on the plan's follow-on list.
- **`fromTags` on a dominant tag** materializes O(n²) prohibited pairs — a degenerate imported tag
  column (thousands sharing one label) is slow/heap-heavy. Guard when the F6 import path lands.
- **`aspl`/`girth` are `Infinity`** for n≤1 (no reachable pairs); `JSON.stringify` turns that into
  `null`. Normalize or special-case at the export boundary (F6).
- **`k ≥ n` is silently capped** at n-1 (feasible, no error). A soft "capped" note could help UX.

## Review (required before commit)

Non-trivial changes get **adversarial sub-agent review** using the committed critics in
`.claude/agents/` (correctness, SOLID, maintainability, security). The critics default to
skepticism and try to break the change.

Protocol (learned the hard way):
- **Unfocused, full-surface, every round.** Point critics at the whole component under review, not
  a diff. Critics anchor on the first/biggest issue they see; a diff-scoped review hides everything
  the anchor is sitting on top of.
- **Run all four critics each round**, in parallel.
- **Verify each finding against the code before acting on it** — reproduce or trace it — to filter
  false positives (LLM negation-blindness). Fix confirmed blocking findings or justify them
  explicitly; log suggestions.
- **Keep going, round after round, until either the critics give a unanimous green light or it is
  clear they would give contradictory suggestions next round** — in which case use judgment and
  adjudicate. Do not stop at a fixed round count: clearing the anchor frees critics to find the
  next layer, so a clean round only counts after a round that changed nothing substantive.
- Keep tests green at the end of every round.

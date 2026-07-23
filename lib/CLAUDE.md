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

- **SOLID, scoped:** single-responsibility modules; open for extension at the real seams (tag
  policies in `constraints.ts`, the edge-legality predicate and polish objective in
  `constrainedGreedy.ts`) — add a case, don't edit callers; depend on injected predicate/objective
  abstractions. Do not force LSP/ISP or wrap free functions in classes for OO's sake.
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

## Review (required before commit)

Non-trivial changes get **adversarial sub-agent review** using the committed critics in
`.claude/agents/` (correctness, SOLID, maintainability, security). Run 2–3 rounds; the critics
default to skepticism and try to break the change. **Verify each finding against the code before
acting on it** (guards against false positives); fix blocking findings or justify them explicitly;
keep tests green at the end of every round.

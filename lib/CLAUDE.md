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
- **Clean Code:** clear names, DRY, small public API. Prefer small extracted functions, but a hot
  loop may stay un-extracted when decomposition costs measurable performance — that is the only
  accepted reason not to extract.
- **Comments:** [`../docs/COMMENT_STANDARD.md`](../docs/COMMENT_STANDARD.md) is the rule, and it is
  enforced by review rather than by a linter. A comment survives only in the shape *"<non-obvious
  fact> so that <consequence>"*. Rationale goes in the commit message; measurements and cost models
  go in `../docs/findings/`; limitations go in the *Known limitations* section below; invariants go
  in a test whose name states the claim. This file's own standard used to say the same thing in one
  clause and it did not hold: forty rounds of review took this package to 0.87 comment lines per
  line of code, with `budgets.ts` at 6.4, because fixes were written to be defended by the next
  round rather than read by the next contributor.
- **YAGNI/KISS:** design patterns only at real ≥2-variant decision points; simplest correct form
  everywhere else.
- **Design by Contract:** dev-mode postcondition assertions back the hard-constraint guarantees
  (compiled out of production bundles where `process` is absent).
- **Functional core / imperative shell:** prefer pure functions over `Graph`; keep mutation local.
- **Tests:** every core change keeps `test/identity.test.ts` (regression oracle) green, and new
  algorithm code earns property-based invariants (`test/*.props.test.ts`) plus oracle-parity checks.

## Known limitations / tracked follow-ons

Surfaced by review, deliberately deferred (not silently ignored):
- **`Constraints.fromTags` validates no `n` and materializes O(n²) pairs before any gate can run.**
  `degreeOf` in the same file, the `Graph` constructor and `validate` all guard `n`; `fromTags`
  takes it on faith and then builds one Set key per same-tag pair, so the cost is paid inside the
  constructor and `validate`'s `MAX_CONSTRAINED_N` refusal never gets a chance. Measured:
  `fromTags(3000, Array(3000).fill('A'))` spends 3.4 s building 4.5M keys, and
  `fromTags(1e15, [])` loops with no guard at all. **Deferred, not fixed:** `fromTags` has no
  caller outside `lib/test`, so nothing untrusted reaches it in the current tree — the same
  no-caller rule this repo applies to speculative code applies to speculative hardening. When the
  tag UI lands, guard `n` first and pre-count group sizes to refuse against a pair cap *before*
  the double loop.
- **The polish gate is still a discontinuity, just a better-placed one.** `MAX_POLISH_WORK` makes
  the auto-polish decision k-aware and bounds its cost, which is what fixed a 33 s default-path
  generation at (120, 12). But any on/off gate jumps from "the whole budget" to "nothing" at its
  boundary. Removing that means deriving the ITERATION COUNT from the budget instead of switching
  polish off — which changes every polished output and so has to go through `reference-python`
  and a fixture regeneration first.
- **`autoPolishEnabled` hard-codes `priorCount` to 0, and F9 is what makes that wrong.** The
  polish gate's cost model charges per *weighed* prior (`PRIOR_PROBE_COST`), but the gate is the
  question a UI asks about a roster it is offering a reroll for, and the app has no prior concept
  at all — a grep for `addPrior` across `app/src` returns nothing. An option with no caller is the
  speculative-seam anti-pattern, so the gate answers for the prior-free case. **Deferred, not
  fixed:** when F9 (priors in the UI) lands, `autoPolishEnabled` grows a `priorCount` parameter
  and passes it through, or the gate under-charges every prior-bearing roster the UI offers.
- **`shortestPath` / `eccentricity` are deliberately NOT mirrored in `reference-python/`,** and this
  is the one documented exception to the mirror rule above. The rule is conditional on changing an
  *algorithm*; these add none, they query `bfsDistances`, which is itself oracle-validated. More to
  the point, the oracle's stated contract is invariants and aggregate metrics **"not byte-for-byte
  edges"** — and a path is exactly a byte-for-byte artifact, the one category it does not validate.
  Mirroring would manufacture a *new* cross-language byte-identity obligation between runtimes whose
  set iteration orders differ, i.e. it would make the oracle claim less true, not more. The
  substitute is `paths.props.test.ts`'s `path.length - 1 === bfsDistances(g,s)[t]`, which checks the
  new code against the mirrored function rather than against another TS BFS. Revisit only if path
  choice ever feeds generation.
- **`minSeparation` on the constrained path is ACCEPTED AND IGNORED, and cannot be removed
  without a breaking change.** `ConstrainedGreedyOptions.minSeparation` /
  `ConstrainedBuddyOptions.minSeparation` change nothing about the output. `choosePartner` sorts
  candidates by farness DESCENDING with unreachable at the top (`INFINITE_DISTANCE`), so
  `candidates[0]` is always the farthest: a scan for "the first candidate at least
  `minSeparation` away, falling back to the best available" returned `candidates[0]` on every
  branch — if the maximum does not qualify, nothing else can. That dead scan is deleted rather
  than kept as decoration, which leaves the option a documented no-op. It stays on the public
  surface so the app's existing call site does not break, and both option types say they ignore
  it. **Deferred, not fixed:** removing it is a breaking public-API change, mirrored in
  `reference-python`, for a field no caller depends on for behaviour. Note the vocabulary trap —
  `minSeparation` is the constrained path's spelling of `mind`, so a reader may reasonably expect
  the unconstrained behaviour.
- **`ConstrainedBuddyResult` cannot be narrowed by the type system, and `edges.length` is the
  tempting wrong check.** On a refusal the shape is fully populated — `edges` empty, `buddies` one
  EMPTY list per person, metrics as placeholders — so `if (result.edges.length > 0)` silently
  mishandles a refused-but-well-formed input, while `buddies[i].length === 0` is indistinguishable
  from a person who genuinely has no buddies. The docblock says to read `report.refusals` first and
  every caller in this repo does. **Deferred, not fixed:** the only fix that makes the compiler
  enforce it is a discriminated union with a literal tag (e.g. `refused: true | false`), because
  `refusals.length === 0` is not a narrowing predicate — and that is a breaking change to the
  public API, mirrored in `reference-python`, for a misuse with no live instance. An exported
  `wasAccepted(result)` helper was considered and rejected: it renames the same check without
  making the type system enforce anything, which is indirection, not a guard. If the union is ever
  built, add the tag at `refusedResult` and the success return together, in one commit.
- **A polish swap trace would NOT reconstruct the graph polish returns, and F11 must not assume
  it does.** `PROJECT_PLAN.md`'s F11 (construction replay) is core work because `edgeList()` only
  gives a canonical sort, not a causal order. `ringGreedy` and `repairDegrees` are easy — they add
  edges in an order that IS the returned graph. `polish`/`polishConstrained` are not: the live
  graph `g` keeps advancing after `best` was last captured, because Metropolis accepts
  non-improving moves that mutate `g` and never touch `best`, and the functions return `best`.
  So replaying every applied swap in loop order rebuilds the FINAL `g`, which is a different graph
  — and `PolishResult.iters` is the total loop count, not the index at which `best` was taken, so
  nothing in the return value names the prefix that would rebuild it (`polishConstrained` returns a
  bare `Graph` and carries no run metrics at all). **Deferred, not fixed:** the fix is an integer
  already implicitly known at `best = g.copy()`, but F11 has no caller and adding a field for it now
  is the speculative-seam anti-pattern `REVIEW_PROTOCOL.md` lists. Record it here so whoever builds
  F11 adds `bestAtIter` (or truncates the trace) at that moment rather than discovering the
  divergence from a replay that silently produces the wrong graph.
- **Generation cost scales as n²·min(k,n-1) PLUS a charge per prohibited pair:** `constrainedGreedy` runs one BFS (~O(n)) per edge
  added and adds ~n·min(k,n-1)/2 edges (n=500,k=4 ≈ 120 ms; n=5000,k=4 ≈ 13 s; the dense corner
  n=500,k=499 ≈ 89 s). Two caps bound it, both in `graph.ts` and enforced as a refusal in `validate`
  + a throw in `constrainedGreedy`: `MAX_CONSTRAINED_N` (5000) bounds the n-only costs (the O(n²)
  baseline and validate's prohibited-pair connectivity walk); `MAX_CONSTRAINED_WORK` (1e8, compared
  against `constrainedWork(n, k, prohibitedCount)`) bounds the dense-k blow-up the n-cap misses —
  and, since round 18, the dense-PROHIBITION blow-up it also missed: the estimator was (n,k)-only
  while every legality decision in the generator probes the prohibited set, so a sparse roster
  (n=5000, k=4) sitting exactly on the budget measured 49 s with a million prohibited pairs
  against a documented ~13 s, with `validate` returning no refusal. The per-pair charge is a
  floor rather than a shape model (the marginal rate falls as pairs rise), and it binds only
  above n≈1500 with a large fraction of all pairs prohibited. Wall-clock tracks
  n²·min(k,n-1) at ~7.5M units/s sparse, ~2.2M/s near-complete; the budget holds worst-case
  generation to ~13 s (sparse, n=5000,k=4) / ~46 s (deepest allowed corner n≈464,k=n-1). Lifting
  either needs an incremental single-source distance scheme (a follow-on) — lighter than
  `ringGreedy`'s all-pairs cache.
- **`fromTags` on a dominant tag** materializes O(n²) prohibited pairs — a degenerate imported tag
  column (thousands sharing one label) is slow/heap-heavy, and at tens of millions of pairs the
  `Set` construction itself throws before `validate` can refuse it. A `NaN` tag value never groups
  (`NaN !== NaN`), silently inverting `prohibit_same`. Sanitize + size-check tags when F6 lands.
- **Polish is O(n·(n+m)) per iteration, plus one probe per weighed prior** — `polish` /
  `polishConstrained` recompute the full all-pairs summary every swap, so they are impractical much
  past a few hundred vertices (why auto-polish is gated by `MAX_POLISH_WORK` in `index.ts`). NOT
  O(n·m): `allPairsSummary` fills an `Int32Array(n)` and accumulates n-wide per source however few
  edges exist, so that reading under-charges a sparse graph by the whole n² term. The prior term is
  the third cost centre and was invisible to the budget until round 20 — `constrainedMeasure`
  re-counts every prior pair on every measurement, and `buildConstrainedBuddyGraph` turns that on by
  itself whenever any prior exists, which measured 3.99 s → 17.58 s at n=268 with no refusal.
  `polishIterationCost` is now the single definition all three gates share. Needs incremental /
  sampled energy for larger n.
- **`polish` deliberately carries NO dev-mode postconditions, unlike `polishConstrained` — read
  the asymmetry as a decision, not an oversight.** The unconstrained pass needs none by
  construction: swaps are structurally degree-preserving, and `best` is monotonically
  non-increasing on penalized ASPL, whose 10n disconnection term dominates any connected ASPL —
  so a connected input can never end disconnected. `polishConstrained` has the checks because it
  must also hold hard constraints it could break. If a future change makes `polish`'s swaps
  anything other than degree-preserving, or weakens the penalty's dominance, this argument lapses
  and the checks have to be added.
- **A residual class of avoidable fragmentation survives at k=2, and it needs a different fix.**
  `repairConnectivity` now rewires in two stages — a degree-preserving double edge swap, then a
  single-degree relocation (`stealSlot`) for a component a swap cannot reach. Exhaustively over
  every feasible prohibition set at small n, avoidable splits (ones where a connected graph exists
  at the same k under the same prohibitions) fell from 48/728 to **16/728** at n=5,k=2 and to zero
  at n=4,k=2, n=4,k=3 and n=5,k=3. What remains is the shape where the surviving component is a
  TREE: every edge is a bridge, so nothing is droppable, and no single rewiring merges anything.
  Witness: n=5, k=2, prohibiting (0,1),(1,3),(1,4),(3,4) — completion builds 0-2, 0-3, 1-2 and
  strands person 4, while the path 1-2-3-0-4 is legal. Reaching it means changing the COMPLETION
  ORDER (visiting deficient vertices by scarcity of legal partners rather than by degree), which
  changes every constrained output and so has to go through `reference-python` and a fixture
  regeneration first — the same reason the polish-gate discontinuity above is still open. Deferred
  rather than done inside a review round for that reason, not because the class is closed.
- **`girth` (and the other exported all-pairs metrics) are O(n²)** and uncapped — deliberately, since
  they are pure diagnostics run on a `Graph` the caller already built (n bounded by `MAX_ROSTER`), not
  generation entry points fed untrusted `(n,k,constraints)`. The generators that *are* the untrusted
  surface are capped (`MAX_CACHED_N` and `MAX_GREEDY_WORK` on the unconstrained path;
  `MAX_CONSTRAINED_N` and `MAX_CONSTRAINED_WORK` on the constrained one). Note the pairing: each
  path needs BOTH a size cap (memory) and a work cap (time), and for a while `ringGreedy` had only
  the first — which is how `(1000, 999)`, an input `validate` refuses outright, ran for over 22
  minutes. `girth`'s only
  internal call is in `buildBuddyGraph` on the `ringGreedy` output (bounded by `MAX_CACHED_N`); the
  constrained path deliberately omits `girth`. Documented, not guarded, to avoid a contract change on
  every metric.
- **`aspl`/`girth` are `Infinity`** for n≤1 (no reachable pairs); `JSON.stringify` turns that into
  `null`. Normalize or special-case at the export boundary (F6).
- **`k ≥ n` is silently capped** at n-1 (feasible, no error). A soft "capped" note could help UX.
- **`validate` does not consider `priorHard`, so it is the authoritative gate only for the safe
  entry point.** `buildConstrainedBuddyGraph` calls `withHardPriors` *before* validating, so that
  path is consistent; `validate`/`validateDetailed` called directly, and the `constrainedGreedy` /
  `polishConstrained` primitives, all ignore the flag and will accept an input that the builder
  would refuse after promotion. Deferred rather than fixed because the fix belongs inside the
  validator and `reference-python`'s `prior_hard` is declared but never used — so promoting in TS
  alone trades oracle parity for a consistency no live caller needs (nothing in the repo sets
  `priorHard`; F9 is the feature that would). When F9 lands, mirror the promotion into the Python
  validator first, then move `withHardPriors` into `validateDetailed` and regenerate fixtures.

## Review (required before commit)

Non-trivial changes get **adversarial sub-agent review** using the committed critics in
`.claude/agents/` (correctness, SOLID, security, maintainability). The critics default to skepticism
and try to break the change.

**The authoritative, repo-wide process is [`../docs/REVIEW_PROTOCOL.md`](../docs/REVIEW_PROTOCOL.md)**
— full-surface every round, **all non-saturated lenses** in parallel, verify each finding, ratchet
the **invariant** (a property that holds for all inputs, not a table of cases) into the suite, and
run until a round changes nothing substantive and then one more. **`npm run lint` at the repo root
must be clean before a critic is spawned** — it owns the lint classes the critics are told not to
file. Do not orchestrate rounds by hand; run the committed runner, which enforces that and computes
convergence:

```
Workflow({ name: "adversarial-review", args: "lib/src (the ringweave core)" })
```

Lib-specific lens the critics apply on top of that process:
- **Determinism** is a hard contract (RNG-free generators; seeded polish only) — any nondeterminism
  is a finding.
- **Oracle parity:** metrics must match `reference-python/`; regenerate fixtures
  (`python3 gen_fixtures.py`) if an algorithm changed, and keep `test/identity.test.ts` green.
- **Ratchet the invariant into property tests / oracle-parity checks** — `test/*.props.test.ts` is
  the natural home, since a property test *is* an invariant. Keep `npm test` green at the end of
  every round.

# BuddyGraph app — working notes

Scope: the `app/` front-end (BuddyGraph), the reference UI built on the `ringweave` core.
The algorithm library lives in `../lib` and is the source of truth for all graph math.

## Commands (run from `app/`)

- `npm run dev` — Vite dev server
- `npm run typecheck` — `tsc --noEmit`; must be clean
- `npm test` — Vitest (pure logic: parsing, export/import round-trip, layout determinism,
  quality, worker payload, a GraphCanvas SSR smoke)
- `npm run build` — `tsc --noEmit && vite build` → `dist/`
- `npm run e2e` (from the **repo root**) — builds, serves and drives the production build in
  Chromium. Needs a browser: it looks for `CHROMIUM_PATH`, then the usual install locations.

**Build order (non-negotiable):** the app consumes the core via `"ringweave": "file:../lib"`,
which resolves to `lib/dist`. `lib/dist` is gitignored and `lib` has no `prepare` script, so
**`lib` must be built before the app installs/builds**:

```bash
npm --prefix ../lib ci && npm --prefix ../lib run build   # produces ../lib/dist
npm ci && npm run build
```

CI (`.github/workflows/ci.yml` `app` job) and Pages (`.github/workflows/pages.yml`
`build_into`) both build the core first for this reason.

## Review (required before commit)

Non-trivial app changes get the same adversarial review as the core. The authoritative process is
[`../docs/REVIEW_PROTOCOL.md`](../docs/REVIEW_PROTOCOL.md) — full-surface every round, **all
non-saturated lenses** every round, ratchet the **invariant** (not the case), run until a round
changes nothing and then one more. **`npm run lint` at the repo root must be clean first** — it owns
the lint classes the critics are told not to file. Don't hand-orchestrate; run the committed runner:

```
Workflow({ name: "adversarial-review", args: "app/src (the BuddyGraph app)" })
```

App lens the critics apply: React state/effect bugs and StrictMode; numbers the UI *displays* vs the
core's actual output; size gates that must run *before* a read/parse (not after); and any uncapped
core metric / synchronous parse on the main thread. `critic-interaction` additionally covers what
the a11y linter cannot see statically — keyboard reachability *across* components, focus order and
dead ends, live-region announcement, reduced motion, and the error/empty paths. Keep `npm test`
green at the end of every round.

## Comments

[`../docs/COMMENT_STANDARD.md`](../docs/COMMENT_STANDARD.md) is the rule. A comment survives only in
the shape *"<non-obvious fact> so that <consequence>"* — a reader who would otherwise do harm. In
this package that is mostly the a11y mechanisms (a live region must pre-exist its content; the
setup dialog must be a sibling of `#app`, since `inert` cascades with no way to opt back in) and the
input-surface ordering rules (a size gate runs *before* a parse). Everything else goes elsewhere:
rationale to the commit message, measurements to `../docs/findings/` — this package's are in
[`app-performance-budgets.md`](../docs/findings/app-performance-budgets.md), which is where every
render budget, layout cap and input-size gate below is calibrated — limitations to the follow-ons
below, invariants to a test whose name states the claim.

## Architecture (respect)

- **The UI never reimplements math.** Every metric and every edge comes from `ringweave`
  (`buildBuddyGraph`, `allPairsSummary`, `girth`, `asplGap`, `Graph`). No shortest-path, ASPL or
  Moore-bound computation in `app/`. If a number is missing, add it to the core (lib-first), not
  here — `usePathFinder` uses the core's `shortestPath`, `PersonPanel` its `eccentricity`.
  **One stated exception:** `neighborhood.ts` derives the 1st/2nd-degree buckets with a local
  bounded-degree adjacency walk rather than a core BFS. It computes no metric, and the reason is
  measured: degree is capped at `BUDDY_MAX = 12`, so the walk is at most 144 set operations while
  `bfsDistances` is O(n+m) ≈ 7,000 at the roster ceiling — and the canvas runs it on every hover.
  The rule previously read as an absolute ("no BFS/ASPL/Moore code"), which this does not violate
  literally and does violate in spirit; stating the exception is more honest than either leaving
  the rule false or moving a hover-path optimisation into the core to satisfy its wording.
- **Names are positional.** The core works on vertex indices `0..n-1`; `names[i]` labels vertex
  `i` ("seated last"). The core never sees names.
- **Generation runs in a Web Worker** (`src/worker/generate.worker.ts`) — a thin shell around
  `buildBuddyGraph`, which THROWS on `k<2`/bad n,k, so the call is wrapped and errors return over
  the response channel. The worker hook (`state/useGenerationWorker.ts`) is **StrictMode-safe**
  (worker created/terminated in an effect) and drops stale responses by `id`.
- **Determinism is UX.** Same roster + settings ⇒ same graph. "Different arrangement" is an
  explicit `seed++`, never automatic. The force layout is settled synchronously with no
  `Math.random`, so it is deterministic too.
- **Privacy is literal.** Zero network calls with roster data; fonts are self-hosted
  (`@fontsource/*`), so the page makes no external requests at all. Don't add CDNs/telemetry.
- **The graph is a view, never the only interface.** Everything (roster, buddies, export) works
  from the panels; keyboard-navigable; reduced-motion honored; WCAG-AA contrast.
- **No panel offset is measured across another panel.** `<main>` is a column of `#upper` (the
  floating panels, absolutely positioned against *it*) over `#bottom` (search, hint and the quality
  strip, in normal flow), and the two right-hand panels share `#rightcol`. Both are structural, not
  cosmetic: a `bottom:` calibrated for the quality strip's minimum height had it covering the hover
  hint and the last rows of the buddy list once its disclosure lines wrapped, and a `right:` equal
  to the buddy panel's width put the person card at x = −174 on a phone. `responsiveCss.test.ts`
  pins every absolutely-positioned panel to rejoining the flow at phone width — a completeness
  claim about a list, which is what the shipped defect was; `npm run e2e` measures the geometry
  that results, at five viewports.
- **Some contracts have no oracle outside a real browser, and they run in CI for that reason.**
  jsdom computes no layout, implements neither `inert`'s focus effects nor print media, and
  `npm test` mocks the worker hook — so panel containment/overlap, the focus rescue, the modal's
  Tab cycle, and "nothing but the slips reaches paper" are all checked by `npm run e2e` (repo
  root), which builds both packages, serves the build, drives it with Chromium and tears the
  server down. It is a CI step in `ci.yml`'s `app` job, because a guarantee stated here and run
  nowhere is a claim.

## One view model

Both generation and import produce a single `GraphView` (`src/model.ts`) so the whole UI renders
from one shape. Import (`src/io/importGraph.ts`) rehydrates from the file's edges **without
regenerating** and recomputes metrics with the core's own functions — so it round-trips
identically with `exportGraph` and honestly re-measures hand-edited files.

## Scope

M2 shipped F1–F6 (roster import, generate+settings, buddy list+slips, ring/force graph, quality
panel, JSON export/import). **M3 adds F7 (constraints UI), F8 (fuzzy search + node explorer) and
F10 (path finder)** — all three are built and wired into `App.tsx`. Still deferred and
intentionally absent: the focus/ego layout, construction replay (F11), and the priors toggle (F9);
each is recorded with its reasons in the follow-ons below.

## Feature status

Colors are CSS custom properties (`src/styles/app.css`) so a **light theme** is a later
token-swap; M2 ships the mock-faithful dark theme only.

## Known follow-ons (surfaced by review, deferred — not silently ignored)

- **Import re-measures on the main thread**, so its size caps (`MAX_IMPORT_N` = `MAX_ROSTER_N` =
  1000, plus a density cap) match generation's ceiling — a re-rollable import shouldn't display
  more than the app can generate, and the equality keeps the synchronous re-measure to a few
  hundred ms. A larger/denser hand-made graph is refused with a plain-language error. Lifting this
  means routing import re-measurement through the worker — a clean follow-on.
- ~~**Generation pipeline models failure as a thrown error only.**~~ **Retired in M3.**
  `GenerateResponse` is now a three-way tagged union (`ok` / `error` / `refused`), and the refusal
  carries structured `Reason`s rather than prose so the UI can name people. Both builders normalize
  into one `GraphResult` payload instead of `viewFromResult` growing a constrained sibling — one
  producer, no branch on which generator ran.
- **F12 ("what-if resilience", `PROJECT_PLAN.md:143`, M4) has one trap, and the app already
  contains the pattern that walks into it.** `importGraph.ts` is the only precedent for computing
  connectivity app-side (`new Graph(n)` + `addEdge` + `allPairsSummary`/`largestComponentFraction`),
  so "simulate X leaving" will be written by copying it — and `Graph` has no vertex removal, so the
  natural move is to drop the leaver's edges and keep `n`. That answers a different question:
  `largestComponentFraction` divides by `g.n`, so an isolated vertex counts as a component of the
  population. Verified against `lib/dist` on a 5-ring, isolating person 2 in place reports
  `connected: false, largestComponentFraction: 0.8`; the real answer — do the four remaining people
  stay connected to each other — is `true, 1`, reproduced by remapping the survivors into a fresh
  `Graph(4)`. Build it that way: a new graph of size n-1 with survivors remapped to `0..n-2`.
- **`resolveNamedPairs`'s `dropped` counts more than its docblock claims.** The field is documented
  as "rows that produced no pair for any reason", and the arithmetic (`named.length - pairs.length`)
  also counts DUPLICATES — two rows naming the same pair yield `dropped: 1` although both resolved
  and the modal tells the user the rule "will only be applied once". No caller reads it today
  (`RosterModal` reports the causes separately), which is why this is deferred rather than fixed:
  the honest options are to compute `unmatched + selfPair + incomplete` or to delete the field, and
  picking between them wants a caller. Do not simply reword the doc to match the arithmetic — "rows
  that produced no pair" is what a caller would want; the number is what is wrong.

- **CSV constraint import is DEFERRED.** F7's acceptance names "import from JSON/CSV"
  (`PROJECT_PLAN.md:97`); JSON round-trips (rules are in the file schema, written on export and
  validated on import) and CSV is not built. Recorded here rather than dropped, per the rule that a
  cut item is cut as a deferral. There is no caller: the roster CSV path parses *names*, and a
  constraints CSV would need its own column contract, which nothing in the app or the file format
  currently defines.
- **`MAX_PARSE_CHARS` bounds the roster parse's INPUT, not its cost, and the two diverge by ~40x
  on a hostile paste.** `parseRoster` re-runs synchronously in `RosterModal`'s render on every
  keystroke, and its per-token `match[0].replace(NAME_HOSTILE_CHARS, " ")` costs one replacement
  per matching character — so cost tracks the number of *hostile* characters, not the character
  count the cap bounds. Measured at the cap (500,000 code points, node 24): 5.4 ms/keystroke for
  ordinary names, **165 ms** for a file of U+200B, **223 ms** for one of U+1F600 — the astral case
  also re-walking `clampToPoints`, whose UTF-16 fast path can never fire when `text.length` is
  twice the point count. On a phone that is roughly a second per character. **Deferred, not
  fixed:** the input is self-inflicted (dropping half a megabyte of zero-width spaces), the cap
  and its warning already bound the damage, and every behaviour-preserving fix rewrites the inner
  loop of the most heavily specified pure function in the package — normalizing in one pass first
  is NOT one of them, since `\n` is itself in the hostile class and doing it before tokenizing
  destroys the line splits the tokenizer needs. The fix that works is to skip leading
  hostile-or-blank characters and normalize only the `MAX_NAME_CHARS` that can survive truncation,
  which changes what a name containing them resolves to and so needs its own change with its own
  tests.
- **`neutralizeCell`'s formula-injection guard is narrower than the import refusal beside it.**
  `download.ts` neutralises a leading `= + - @ TAB CR`; it does not cover `\n`, `U+2028`, `U+2029`,
  or a space before a formula character. There is no live path today — `importGraph` refuses those
  characters in names outright, and `parseRoster` normalises them — so the two together are sound,
  and this is recorded rather than fixed because the guard is only reachable through data that has
  already passed the stricter gate. It becomes live the moment any export path stops going through
  that gate. Surfaced by the comment sweep, where it had no home outside a source comment.
- **`Metrics.girth` has no display, only an export slot and one derived consumer.** No panel renders
  it; it is carried so the exported file's `meta.metrics` snapshot (F6) stays a full
  characterization, and `separationShortfall` reads it to derive the *delivered* separation
  (`girth - 1`, the core's own postcondition — a second field would be a channel that could
  disagree). `null` means acyclic, i.e. separation is unbounded and nothing fell short; a consumer
  that reads `null` as zero would report a shortfall on a forest. Surfacing girth directly is a UI
  decision nobody has taken, not an oversight — but the field's own comment still says
  "not displayed in M2", which understates the derived use added in M3.
- **A constrained export records a `minSeparation` the graph can never meet.** `exportGraph` writes
  `settings.minSeparation` into the file whatever builder produced the graph, and the constrained
  path ignores that option entirely (`choosePartner` always takes the farthest legal partner), so a
  constrained file states a target its own edges do not and could not satisfy. Surfaced by the
  comment sweep, where it had been living only as a source comment. The fix is either to omit the
  field on the constrained path or to write the achieved separation instead; both change the file
  schema's meaning, so it is a deferral rather than a one-liner.
- **Buddy rules are not re-checked on import.** `importGraph` rehydrates edges rather than
  regenerating, so no builder runs and there is no `ConstraintReport`. `GraphView.report` is null on
  that path and the quality panel says "not re-checked on import" — deliberately NOT "satisfied",
  which would be the disconnected-reads-as-optimal failure in a new place. Closing it properly means
  verifying the rules against the imported edge set, which is a real (cheap) computation and a clean
  follow-on; asserting satisfaction without it is not. **One trap recorded with it, because the
  cheap path is the wrong one:** the canonical computation already exists as `buildReport` in
  `lib/src/core/index.ts`, and it is module-private — every primitive it uses (`Graph.hasEdge`,
  `Constraints.requiredPairs()`/`prohibitedPairs()`, `largestComponentFraction`) IS exported, so
  hand-rolling the two counting loops in `importGraph.ts` is the path of least resistance and would
  put a second copy of the predicate that decides what "all buddy rules satisfied" MEANS outside the
  core. A later change to that predicate would then update every generation-time report and silently
  leave the import-time one on the old definition. Do it lib-first: export `buildReport` (or a
  renamed public equivalent taking `(g, cons, connected)`) and call it. `importExport.roundtrip.test.ts`
  pins `report` to null on import today and changes in the same commit.
  **The fan-out is four files, not three** — a reviewer performed the wiring for real and traced
  what it strands: with `importGraph` populating `report`, `model.ts`'s `report === null` branch in
  `constraintSummary` becomes unreachable from live data and the docblock above it ("an imported
  constrained file has no report") becomes false. `lib/src/core/index.ts`, `app/src/io/importGraph.ts`,
  `app/test/importExport.roundtrip.test.ts` **and `app/src/model.ts`**, in one commit.
- **F9's worker-protocol groundwork is DEFERRED, and named here so it is not rediscovered.**
  `GenerateRequest.constraints` carries only `{required, prohibited}` and `GenerateOptions` has
  no `priorWeight`/`priorHard`; `ConstraintPair` has no `prior` concept. A grep for
  `priorWeight`/`priorHard`/`addPrior` across `app/src` returns nothing, so per the no-caller
  rule this is a deferral rather than a gap. Two things make building it early actively wrong:
  priors are not user-authored rules (they would be derived from the PREVIOUS view's edges and
  resolved by name against a possibly-changed roster, for which there is no analogue of
  `resolveNamedPairs`), and the toggle's home is undecided — `RosterModal` is the natural "Edit
  people" surface but does not receive the live view's edges. **One hazard is recorded with it,
  because it is a correctness trap rather than a design choice:** `buildConstrainedBuddyGraph`
  promotes hard priors to required *before* validating, so an app-side pre-check that validates
  the UN-promoted set would call a rule set feasible that the builder then refuses. The worker
  now checks `report.refusals` after building instead of trusting its pre-check to be
  equivalent, so that trap fails loudly rather than rendering an edgeless graph as satisfied.
  **A second hazard sits in the worker protocol's own shape:** `isConstrainedRequest` discriminates
  on fields that do not look like duplicates of each other, which is exactly what makes the next
  field easy to add to one request type and miss in the other. A priors-only request routed through
  `buildBuddyGraph` — which never sees priors — would preserve nothing and report success. Adding
  priors means widening the discriminator in the same change, not afterwards.
- **The tag UI and the priors/`priorHard` toggle stay deferred.** Tags are P2 in `PROJECT_PLAN.md`
  and `lib/CLAUDE.md` documents two unfixed hazards in them (a dominant tag materializes O(n²)
  prohibited pairs; a `NaN` tag silently never groups). Priors are F9/M4. Neither has a caller.
- **The focus/ego layout is DEFERRED PAST M3** (it was previously pencilled in as "F8, M3"). It is
  not in F8's acceptance criteria (`PROJECT_PLAN.md:107` is fuzzy search, clickable panel names, and
  a working back stack); it comes only from the mock and `DESIGN_HANDOFF.md`. The argument for
  building it anyway was that it would "retire" the extension seam E1 spent rounds hardening — but
  that is sunk cost, and the E1 record does not support it: the seam-specific findings are **8 across
  6 rounds, every one `suggestion`, zero blocking**. Building the feature to justify the seam would
  also reward the anti-pattern `REVIEW_PROTOCOL.md` now lists ("building an extension seam for a
  deferred feature") and would convert a clean negative result into an unfalsifiable one.
  If it is ever built, four things are unresolved and none are cosmetic: `GraphCanvas.tsx:177` uses
  `focus = hovered ?? selected`, so keying the *layout* on it re-lays-out on every mouse-over — and
  the animation effect only animates on `layoutChanged`, so it would **snap**; the mock's radii
  (0.52 / 1.02 / **1.32** × R) exceed the unit-circle frame `computeFit` builds from `FIT_MODES`
  alone, so the outer band **clips**; selecting focus with nothing selected is undefined (the mock
  silently focuses node 0); and `positionsFor` gains a parameter, touching every call site plus
  `graphCanvasFit.test.ts`. **One seam decision is settled in advance:** such a mode goes into
  `LAYOUT_MODES` and `positionsFor` but deliberately **not** into `FIT_MODES` — folding
  per-selection points into the frame would rescale the viewBox on every interaction, defeating the
  fixed-frame invariant `graphCanvasFit.test.ts` pins.
- **The force settle is synchronous and tick-scaled, not off-thread.** `forceLayout` runs a
  deterministic, n-scaled tick budget (`forceIters`) so the main-thread cost stays bounded
  (~200 ms at the n=1000 ceiling instead of ~1.5 s at a fixed 300 ticks), and `GraphCanvas`
  defers it to when force is actually selected. The robust fix — settling off the main thread
  (or incrementally) — is a clean follow-on if very large graphs in force mode become common.
- ~~**Hover highlight is O(n+m) per hover.**~~ **Corrected and partly retired in M3.** The note
  named the wrong term: the highlight recompute is the SMALLEST of three, since `neighborhood()`
  is bounded at ~144 set operations by the degree cap. The real cost was that `hovered` is
  App-level state and nothing below App was memoized, so every hover transition re-rendered
  `BuddyList` (n rows) and `Slips` (n print cards) — panels that read neither `hovered` nor
  `selected` — measured at ~70 ms and ~46 ms per transition at the import ceiling, on top of the
  canvas's own 168 ms. Both are now `React.memo`, and `setSelected` is a `useCallback` so the memo
  actually holds. What remains is `GraphCanvas`'s own re-render, which does read the state; gating
  that (or keeping `hovered` inside the canvas) is the clean follow-on if very large graphs become
  common.
- ~~**Generation connectivity is assumed, not measured.**~~ **Retired in M3.** `BuddyResult` now
  carries `connected` / `largestComponentFraction` (from the `allPairsSummary` the builder already
  ran), and `viewFromResult` reads them instead of hardcoding `true` / `1`. The fix was taken
  lib-first as recorded. It stopped being cosmetic the moment a second generator fed the same view.

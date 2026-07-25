# BuddyGraph app — working notes

Scope: the `app/` front-end (BuddyGraph), the reference UI built on the `ringweave` core.
The algorithm library lives in `../lib` and is the source of truth for all graph math.

## Commands (run from `app/`)

- `npm run dev` — Vite dev server
- `npm run typecheck` — `tsc --noEmit`; must be clean
- `npm test` — Vitest (pure logic: parsing, export/import round-trip, layout determinism,
  quality, worker payload, a GraphCanvas SSR smoke)
- `npm run build` — `tsc --noEmit && vite build` → `dist/`

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

## Architecture (respect)

- **The UI never reimplements math.** Every metric and every edge comes from `ringweave`
  (`buildBuddyGraph`, `allPairsSummary`, `girth`, `asplGap`, `Graph`). No BFS/ASPL/Moore code
  in `app/`. If a number is missing, add it to the core (lib-first), not here.
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

## One view model

Both generation and import produce a single `GraphView` (`src/model.ts`) so the whole UI renders
from one shape. Import (`src/io/importGraph.ts`) rehydrates from the file's edges **without
regenerating** and recomputes metrics with the core's own functions — so it round-trips
identically with `exportGraph` and honestly re-measures hand-edited files.

## Scope

M2 ships F1–F6 (roster import, generate+settings, buddy list+slips, ring/force graph, quality
panel, JSON export/import). Deferred to M3/M4 and intentionally absent: fuzzy search, node-detail
explorer, focus/ego layout, construction replay, constraints UI.

## Feature status

Colors are CSS custom properties (`src/styles/app.css`) so a **light theme** is a later
token-swap; M2 ships the mock-faithful dark theme only.

## Known follow-ons (surfaced by review, deferred — not silently ignored)

- **Import re-measures on the main thread**, so its size caps (`MAX_IMPORT_N` = `MAX_ROSTER_N` =
  1000, plus a density cap) match generation's ceiling — a re-rollable import shouldn't display
  more than the app can generate, and the equality keeps the synchronous re-measure to a few
  hundred ms. A larger/denser hand-made graph is refused with a plain-language error. Lifting this
  means routing import re-measurement through the worker — a clean follow-on.
- **Generation pipeline models failure as a thrown error only** (`worker/protocol.ts`
  `GenerateResponse`). The constraint-aware core (`buildConstrainedBuddyGraph`) instead *refuses on
  a successful return* via `report.refusals`. When constraints land (M3), the protocol needs a
  third notion (refused-with-reasons) and `viewFromResult` a constrained variant — don't build it
  now (YAGNI), but don't encode "failure == throw" as the only shape either.
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
  `graphCanvasFit.test.ts`.
- **The force settle is synchronous and tick-scaled, not off-thread.** `forceLayout` runs a
  deterministic, n-scaled tick budget (`forceIters`) so the main-thread cost stays bounded
  (~200 ms at the n=1000 ceiling instead of ~1.5 s at a fixed 300 ticks), and `GraphCanvas`
  defers it to when force is actually selected. The robust fix — settling off the main thread
  (or incrementally) — is a clean follow-on if very large graphs in force mode become common.
- **Hover highlight is O(n+m) per hover** (recomputes neighbor sets + node/edge classes). Fine at
  M2 sizes; memoize/gate it if very large graphs become common.
- **Generation connectivity is assumed, not measured.** `viewFromResult` sets `connected:true` /
  `largestComponentFraction:1` because `BuddyResult` carries no connectivity field and the ring
  seed guarantees connectivity by construction. The honest fix is lib-first: add `connected` /
  `largestComponentFraction` to `BuddyResult` (the worker already computes `allPairsSummary`, whose
  `Summary` has `connected`) and pass them through, so both view-model producers *measure* it.

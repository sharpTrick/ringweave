# BuddyGraph app — working notes

Scope: the `app/` front-end (BuddyGraph), the reference UI built on the `ringweave` core.
The algorithm library lives in `../lib` and is the source of truth for all graph math.

## Commands (run from `app/`)

- `npm run dev` — Vite dev server
- `npm run typecheck` — `tsc --noEmit`; must be clean
- `npm test` — Vitest (pure logic: parsing, export/import round-trip, layout determinism,
  quality, worker payload, a GraphView SSR smoke)
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

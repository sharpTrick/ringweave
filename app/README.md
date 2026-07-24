# BuddyGraph (app)

The reference web app for the [`ringweave`](../lib) core: paste a list of people, pick how many
buddies each person gets, and generate a fair, well-connected buddy system. Everyone gets an equal
number of buddies and any two people are only a few "friend of a friend" hops apart.

**Runs entirely in your browser — no accounts, no server, your roster never leaves the device.**

Built with Vite + React + TypeScript. The graph math is entirely in `ringweave`; the app never
reimplements it.

## Features (M2, F1–F6)

- **Roster import** — paste names (newline/comma) or drop a `.txt`/`.csv`; duplicates are flagged,
  not silently dropped.
- **Generate + settings** — buddies-per-person, minimum separation, polish, and a seed (Advanced);
  parity/feasibility notes before you run. Deterministic: same inputs ⇒ same result.
- **Buddy list + slips** — a Name → buddies table with copy, CSV export, and print-friendly slips.
- **Graph view** — ring and force layouts with an animated toggle, hover neighborhood glow, and
  pan/zoom.
- **Quality panel** — average hops, longest path, and a connection-quality score.
- **Export / import** — versioned JSON that round-trips the exact graph and metrics.

## Develop

The app depends on the core via `ringweave: file:../lib`, which resolves to `../lib/dist`. Because
`dist` is gitignored and has no `prepare` step, **build the core first**:

```bash
npm --prefix ../lib ci && npm --prefix ../lib run build
npm ci
npm run dev        # or: npm run typecheck && npm test && npm run build
```

## Deploy

Pushed to GitHub Pages by `.github/workflows/pages.yml`: production at
`https://sharptrick.github.io/ringweave/`, and a live preview per open PR at
`/ringweave/pr-preview/pr-N/`. Both build the core before the app.

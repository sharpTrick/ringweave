# ringweave

*Near-regular graph generation with minimal average shortest path length — plus hard/soft
constraints. Zero dependencies.*

**ringweave** is the project: a zero-dependency TypeScript library that generates
near-regular graphs with minimal **average shortest path length (ASPL)**. Start with a ring,
greedily weave in chords between the farthest, least-connected vertices, then optionally
polish with degree-preserving edge swaps. Hard constraints (required / prohibited edges) and
soft constraints (preserve prior edges) are supported. The library is the deliverable — the
goal is for these algorithms to outlive this repo and land in mainstream graph libraries
(see [`docs/UPSTREAMING.md`](docs/UPSTREAMING.md)).

**BuddyGraph** is a proof-of-concept built on ringweave and shipped in this same repo — both
a working demonstration of the library and a free client-side service for anyone who finds it
useful. Give it a group of people and a buddy count (say 3–4), and everyone gets an equal
number of buddies while the whole group stays as closely connected as possible — your likely
helper for any need is a buddy or a buddy-of-a-buddy. It runs entirely in the browser: **no
accounts, no backend, no roster ever leaves the device.**

The two names, one hierarchy: `ringweave` is the library that adopters depend on; BuddyGraph
is the reference application that shows what it's good for.

## Status

The algorithm is selected and validated. The TypeScript core lives in `lib/` with **38
passing tests**, including 26 byte-identity checks against the Python reference (the greedy
path is RNG-free, so this is a genuine cross-language correctness proof). The next milestone
(**M1**) is porting the constraint layer (`constraints.py` + `constrained_gen.py`) into
`lib/src/core`; the app (**M2**) turns the `mock/` prototype into a React app wired to the
real core. See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the full roadmap.

## Repository layout

| Path               | What it is |
| ------------------ | ---------- |
| `lib/`             | The `ringweave` TypeScript core — zero-dependency, framework-agnostic. Its own `README`, tests, and build. |
| `mock/`            | Interactive HTML/JS prototype of the target UI (Ring / Force / Focus layouts). Not yet wired to the core (M2). |
| `reference-python/`| The validated research code: unconstrained + constrained cores, benchmarks, and the fixture source for the identity tests. |
| `docs/`            | Findings, plans, attribution, and results CSVs (see below). |
| `design/`          | Rendered design directions and mock-state screenshots. |
| `HANDOFF.md`       | Implementation handoff — what exists, what's decided, what's next. |

Planned: `app/` (Vite + React 19 + TS) arrives in M2 as a sibling of `lib/`.

## Documentation

Start with [`HANDOFF.md`](HANDOFF.md), then:

1. [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — **source of truth** for features, priorities, milestones.
2. [`docs/findings/CONSTRAINT_FINDINGS.md`](docs/findings/CONSTRAINT_FINDINGS.md) — the constraint-architecture decision.
3. [`docs/findings/FINDINGS.md`](docs/findings/FINDINGS.md) — the original algorithm bake-off.
4. [`docs/CONCEPT_LINEAGE.md`](docs/CONCEPT_LINEAGE.md) — attribution and intellectual genealogy (notably Markus Meringer's GENREG).
5. [`docs/DESIGN_HANDOFF.md`](docs/DESIGN_HANDOFF.md) — visual direction.
6. [`docs/UPSTREAMING.md`](docs/UPSTREAMING.md) — post-launch plan to contribute the algorithms to major graph libraries.

## Developing the core

```bash
cd lib
npm install
npm test          # vitest: metrics, cross-language identity, pipeline (38 tests)
npm run typecheck # strict TS across src + tests
npm run build     # emits dist/ with .d.ts declarations
```

Continuous integration runs the same typecheck / test / build on every pull request (see
`.github/workflows/ci.yml`). The Pages deploy workflow is scaffolded but inert until the app
lands.

## License

MIT — see [`LICENSE`](LICENSE). Liberal reuse is an explicit goal. This project ships the
greedy synthesis and constraint system, not GENREG-derived code; see
[`docs/CONCEPT_LINEAGE.md`](docs/CONCEPT_LINEAGE.md) for provenance and acknowledgments.

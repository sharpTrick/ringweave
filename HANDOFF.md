# RINGWEAVE / BUDDYGRAPH — Implementation Handoff

**Owner:** Patrick Sharp (github: sharpTrick) · Prepared with Claude (Anthropic), July 2026.

This package contains everything needed to stand up the new repository and continue
implementation. Read this file first; it tells you what exists, what's decided, and what's next.

## Naming (settled)

- **Repository / npm package: `ringweave`** — the MIT-licensed algorithm library (ring seed +
  greedy chord weaving toward minimal ASPL, with constraints). Verified free on npm at time of
  writing; re-check with `npm view ringweave` immediately before first publish.
- **Product name: BuddyGraph** — the client-side web app built on ringweave (GitHub Pages).
- The old repo `sharpTrick/genreg_via_cycles` stays alive untouched; add one forward-link line
  to its README ("This exploration evolved into ringweave"). Do not overwrite its history.

## Package map

```
lib/                TypeScript core (rename applied). 38 tests passing incl. 26
                    byte-identity tests vs the Python reference. CI + Pages workflows included.
mock/               Interactive HTML/JS prototype of the target UI (index.html + app.js).
                    Three layouts (Ring / Force / Focus ego-view), hover glow, node detail,
                    fuzzy search, export, replay, responsive. NOT wired to the core (stand-in
                    generator) — that wiring is M2.
reference-python/   The validated research code: unconstrained core (core.py, generators.py,
                    gen_b.py, gen_c_cached.py), constraint core (constraints.py,
                    constrained_gen.py), benches, and reference.json (fixture source).
docs/               All findings and plans (reading order below) + results CSVs.
design/             Rendered design directions (1a/1b/1c) + mock state screenshots.
```

## Reading order

1. `docs/PROJECT_PLAN.md` — **source of truth** for features, priorities, milestones,
   non-functional requirements. Status banner at top reflects current state.
2. `docs/findings/CONSTRAINT_FINDINGS.md` — the constraint architecture decision (constrained-greedy
   backbone + constraint-preserving polish; seat and free-repair eliminated on data).
3. `docs/findings/FINDINGS.md` — the original algorithm bake-off (why ring-greedy + cache; why polish;
   the cached-greedy scaling addendum).
4. `docs/CONCEPT_LINEAGE.md` — attribution and intellectual genealogy. **Ship this in the
   repo**; the Meringer acknowledgment is a commitment, not decoration.
5. `docs/DESIGN_HANDOFF.md` + `design/` — visual direction. Chosen: 1a structure + 1c
   full-bleed/glass/sunburst; the mock embodies it.
6. `docs/UPSTREAMING.md` — post-launch plan to contribute the algorithms to major graph
   libraries.

## What is already validated (do not re-litigate without new data)

- **Pipeline:** cached ring-greedy as the deterministic backbone; degree repair; polish
  (degree-preserving swaps) as quality layer — auto at n ≤ ~120, capped by iterations not
  wall-clock, adopt-only-if-not-worse guard.
- **Constraints:** hard required/prohibited enforced by construction in constrained-greedy
  (required edges seeded first, never removed; prohibited never added; components
  force-connected). Tags compile to prohibited pairs. Priors soft via polish penalty
  (validated 47–81% preservation) with a hard toggle that promotes them to required.
  Up-front `validate()` refuses genuinely-impossible inputs with plain-language reasons.
- **Determinism:** same inputs + settings ⇒ same output. Greedy/repair are RNG-free; polish
  uses a fixed seed. "Different arrangement" = explicit seed change.

## Milestones (revised)

- **M1 (next): constrained core in TS.** Port `constraints.py` + `constrained_gen.py` into
  `lib/src/core` (constrainedGreedy, polishConstrained, validate, tag compilation). Extend
  `buildBuddyGraph` to accept constraints and return the report (satisfied, degree spread,
  priors kept, refusal reasons). Generate constrained fixtures from the Python (greedy path is
  RNG-free ⇒ byte-identity holds) and add them to `test/identity.test.ts`. Port the
  incremental-distance cache into constrainedGreedy for scale parity.
- **M1b: churn benchmark.** Small: measure preserved-edge fraction vs prior-weight at
  n ∈ {30, 60, 120} to pick the default weight and set the honest F9 claim.
- **M2: the app.** Vite + React 18 + TS under `app/`; port the mock's UI onto the real core;
  worker-wrap generation; flip `pages.yml` live (upload path → `app/dist`).
- **M3/M4:** per PROJECT_PLAN (constraints UI, explorer, recalc, replay, share links).

## Engineering ground rules (from the plan; non-negotiable)

- Privacy: zero network calls with roster data; the promise is stated in the UI.
- The graph is a view, never the only interface; full keyboard path; WCAG AA; reduced-motion.
- Core stays zero-dependency and framework-agnostic; UI never reimplements math.
- Every core change keeps the cross-language identity tests green or regenerates fixtures
  from the Python reference with the change mirrored there first.

## Licensing

MIT for ringweave (decided — liberal use is an explicit goal). The new code is the greedy
synthesis and constraint system, not GENREG-derived; the old port repo keeps its own
provenance. Ship `CONCEPT_LINEAGE.md` and its Acknowledgments in-repo.
